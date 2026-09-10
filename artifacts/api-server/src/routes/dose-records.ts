import { mensagemDeValidacao } from "../lib/erro-de-validacao.ts";
import { getAuth } from "../lib/auth-types.ts";
/**
 * Registros de dose — ZELO (ZELO-23, ZELO-24).
 *
 * O PRIMEIRO REGISTRO VENCE, garantido pelo banco, não por lógica de
 * aplicação: UNIQUE(scheduled_dose_id) + INSERT ... ON CONFLICT DO NOTHING.
 * Uma corrida perdida nunca vira erro feio — devolve 200 com o registro
 * vencedor e uma mensagem simpática ("Bruno já registrou às 8:02"), nunca
 * 409. É esse desenho que faz 20 requisições simultâneas produzirem
 * exatamente 1 registro sem nenhuma delas quebrar.
 *
 * ZELO-24 — registro retroativo: takenAt (quando aconteceu, segundo o
 * cuidador) e createdAt (quando foi registrado no sistema) já eram dois
 * campos separados desde sempre — o relatório médico usa takenAt, a
 * auditoria usa createdAt. Dentro da janela configurável da família
 * (padrão 24h) entre os dois, registra sem perguntar mais nada. Fora dela,
 * pede uma justificativa curta — texto livre, neutro, sem lista de motivos
 * pré-definidos que julgue o cuidador. Dose no futuro é sempre rejeitada.
 *
 * REGISTRAR DOSE NUNCA É BLOQUEADO POR PLANO (revisão da ZELO-38, feita
 * depois de um teste ao vivo): a ZELO-38 aplicava aqui a regra de
 * "paciente excedente vira somente-leitura", e o efeito prático foi um
 * idoso, no modo idoso (ZELO-40), apertando "Tomei" e recebendo um aviso
 * de limite de plano — ele não tem nada a ver com a assinatura de quem
 * cuida dele. Mais grave: registrar a dose é o dado vital do produto, e a
 * própria spec já fixa o princípio em ZELO-39 ("o app continua
 * funcionando na falha de pagamento; lembrete de remédio nunca é cortado
 * por cartão recusado"). O paywall legítimo é sobre CRESCER (paciente
 * novo, cuidador novo, tratamento/medicamento novo) e sobre recurso extra
 * (relatório, consultas, alerta de estoque, histórico longo) — nunca
 * sobre registrar o que já foi prescrito. `isPatientEditable` continua
 * valendo em treatments.ts, que é exatamente "crescer".
 */
import { Router } from "express";
import { eq, and, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { doseRecordsTable, scheduledDosesTable, treatmentsTable, medicationsTable, caregiversTable, patientsTable, familiesTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { requireCapability } from "../lib/capabilities.ts";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { boss, QUEUE_DOSE_TAKEN, QUEUE_DOSE_REMINDER, ensureQueueStarted } from "../lib/queue.ts";
import { ESCALATION_LEVEL_SNOOZE } from "../lib/dose-reminders.ts";
import { publishPatientEvent } from "../lib/realtime.ts";

const router = Router();

/**
 * Quanto tempo depois de registrar ainda dá para **apagar** o registro.
 *
 * ── Desfazer e corrigir não são a mesma coisa ────────────────────────────
 *
 * Este minuto é para o toque errado que ainda é o "agora" da pessoa. Passado
 * ele, um registro de dose é registro clínico: apagar destrói informação —
 * some quem registrou, some quando, some que houve um engano. O caminho
 * depois do prazo é **emendar com rastro**, e é a Issue #136.
 *
 * Exportado a partir da #135 porque o `today-doses` precisa dizer à tela até
 * quando o botão vale. A tela **não** conhece este número: ela recebe um
 * instante pronto (`desfazerAte`) e só compara com o relógio dela.
 */
export const UNDO_WINDOW_MS = 60_000;

// Margem para relógios fora de sincronia entre o aparelho e o servidor.
// 5 minutos cobre com folga o drift típico de um celular/PC sem NTP e a
// latência de rede, e continua muito abaixo do menor intervalo real entre
// doses — ou seja, nunca faz uma dose ser confundida com a seguinte.
const CLOCK_SKEW_TOLERANCE_MS = 5 * 60_000;

/**
 * Quanto ANTES do horário agendado uma dose pode ser registrada sem o app
 * perguntar se é isso mesmo — Issue #134.
 *
 * ── O buraco que isto tapa ───────────────────────────────────────────────
 *
 * Até 10/09/2026 esta rota fazia duas checagens de tempo, e **nenhuma
 * comparava `takenAt` com `scheduledAt`**: só recusava `takenAt` no futuro
 * (tolerância de relógio) e pedia justificativa para `takenAt` velho demais.
 *
 * Resultado medido pelo fundador: às 00:49 dava para marcar como tomada a
 * dose agendada para as **23:00 do mesmo dia**. `takenAt` era *agora*, o
 * futuro era zero, o passado era zero — e as ~22 horas de distância até o
 * horário agendado não eram olhadas por ninguém.
 *
 * O dano é silencioso e é sobre remédio: a dose sai da lista de pendentes,
 * o lembrete não dispara, e ninguém mais é avisado de que ela existe.
 *
 * ── Por que uma HORA, e por que é constante ──────────────────────────────
 *
 * Uma hora cobre com folga o caso real ("dei vinte minutos antes de sair") e
 * é muito menor que o menor intervalo praticado entre duas doses do mesmo
 * medicamento — ou seja, nunca faz uma dose ser confundida com a seguinte.
 *
 * **Não é configurável por família, de propósito.** Uma família que pudesse
 * esticar isto para 24 h recriaria o defeito inteiro, e o precedente já
 * existe: a #123 fixou o prazo dela em constante pelo mesmo motivo. O eixo
 * retroativo é configurável (`retroactiveWindowHours`) porque lá a variação
 * é legítima — cada família tem um ritmo de anotar o que já aconteceu.
 * Antecipar é outra coisa: é o futuro, e o futuro não tem ritmo.
 *
 * ── O que ela NÃO faz ────────────────────────────────────────────────────
 *
 * Não bloqueia. Fora da janela a rota devolve `ANTECIPACAO_REQUERIDA`, e o
 * mesmo pedido com `confirmarAntecipacao: true` passa. Quem realmente deu o
 * remédio adiantado **precisa** conseguir registrar — registrar dose é o
 * dado vital do produto, e já sobrevive a paywall e a pagamento atrasado
 * (revisão da ZELO-38). O que não pode é ser um toque acidental.
 */
export const JANELA_DE_ANTECIPACAO_MS = 60 * 60_000;

/**
 * A dose já chegou perto o bastante para ser resolvida sem perguntar?
 *
 * Exportada porque **existem dois caminhos de registro**, e os dois precisam
 * da mesma régua: esta rota (cuidador) e `POST /patient-access/taken` (o
 * aparelho do próprio paciente, ZELO-40). O segundo é um `insert` separado —
 * fechar só este deixaria aberta justamente a superfície mais frágil, a do
 * botão gigante na frente de quem está sendo cuidado.
 */
export function doseJaChegou(scheduledAt: Date, quando: Date): boolean {
  return scheduledAt.getTime() - quando.getTime() <= JANELA_DE_ANTECIPACAO_MS;
}

const ListQuery = z.object({
  from: z.string().optional(),
  to: z.string().optional(),
});

const CreateDoseRecordBody = z.object({
  scheduledDoseId: z.number().int().positive(),
  // patientId vem de req.params — não aceitar do body evita confusão
  // OPCIONAL de propósito: ausente = "agora, segundo o relógio do
  // servidor". Só o registro retroativo (ZELO-24) manda um instante
  // explícito — ver a explicação no handler.
  takenAt: z.string().optional(),
  outcome: z.enum(["taken", "skipped", "postponed"]),
  postponedTo: z.string().optional().nullable(),
  // ZELO-24: só exigida pelo servidor quando takenAt cai fora da janela
  // retroativa da família — texto curto e neutro, nunca uma escolha numa
  // lista de motivos.
  justification: z.string().trim().max(500).optional().nullable(),
  notes: z.string().optional().nullable(),
  // ZELO-40: enviado pela tela do modo idoso — muda só o rótulo exibido
  // ("Dona Maria" em vez do cuidador logado no aparelho), nunca quem é o
  // caregiverId responsável de verdade (isso continua vindo do token).
  viaElderMode: z.boolean().optional(),
  // Issue #134: "sim, é esta dose mesmo, e sei que ela é de mais tarde".
  // Só é olhado quando a dose está além da janela de antecipação — dentro
  // dela o campo é irrelevante e ninguém precisa mandá-lo.
  //
  // É um booleano e não um texto de propósito. No eixo retroativo a
  // justificativa ACRESCENTA informação, porque o servidor não sabe quando a
  // dose foi dada de verdade. Aqui ele sabe: é agora. O que falta é só a
  // intenção, e pedir prosa para isso seria mandar o cuidador se explicar —
  // o que este produto não faz (invariante 4).
  confirmarAntecipacao: z.boolean().optional(),
}).refine((b) => b.outcome !== "postponed" || !!b.postponedTo, {
  message: "postponedTo é obrigatório quando outcome é 'postponed'",
});

/** ZELO-19: nunca formatar horário sem fuso explícito — "8:02" tem que ser 8:02 no relógio do paciente. */
function formatTimeShort(d: Date, timezone: string): string {
  return d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: timezone });
}

// ── Listar registros de dose de um paciente ───────────────────────────────

router.get("/patients/:patientId/dose-records", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Verifica isolamento: paciente pertence à família do token
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const query = ListQuery.safeParse(req.query);
  const conditions = [eq(doseRecordsTable.patientId, patientId)];
  if (query.success && query.data.from) conditions.push(gte(doseRecordsTable.takenAt, new Date(query.data.from)));
  if (query.success && query.data.to) conditions.push(lte(doseRecordsTable.takenAt, new Date(query.data.to)));

  const records = await db
    .select({
      id: doseRecordsTable.id,
      scheduledDoseId: doseRecordsTable.scheduledDoseId,
      patientId: doseRecordsTable.patientId,
      caregiverId: doseRecordsTable.caregiverId,
      caregiverName: caregiversTable.name,
      takenAt: doseRecordsTable.takenAt,
      outcome: doseRecordsTable.outcome,
      postponedTo: doseRecordsTable.postponedTo,
      justification: doseRecordsTable.justification,
      notes: doseRecordsTable.notes,
      createdAt: doseRecordsTable.createdAt,
    })
    .from(doseRecordsTable)
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(and(...conditions))
    .orderBy(doseRecordsTable.takenAt);

  res.json(records);
});

// ── Registrar dose ────────────────────────────────────────────────────────

router.post("/patients/:patientId/dose-records", requireAuth, requireCapability("register_dose"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = CreateDoseRecordBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: mensagemDeValidacao(body.error) }); return; }

  // Verifica isolamento
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // NÃO existe checagem de limite de plano aqui, de propósito — ver a
  // regra logo abaixo. Registrar que a dose foi tomada é a função vital do
  // produto e nunca é bloqueada por plano.

  // Verifica que a dose agendada pertence ao paciente, e pega o medicationId
  // (via treatment) pro evento DoseTaken e o nome do medicamento pro evento
  // de sincronização em tempo real (ZELO-25).
  const [scheduled] = await db
    .select({
      id: scheduledDosesTable.id, patientId: scheduledDosesTable.patientId,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      // Issue #134: o instante agendado, para saber o quanto este registro
      // está adiantado. `scheduledLocalTime` é só a etiqueta que a tela
      // mostra ("23:00") e não serve para conta nenhuma.
      scheduledAt: scheduledDosesTable.scheduledAt,
      medicationId: treatmentsTable.medicationId, medicationName: medicationsTable.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId))
    .limit(1);

  if (!scheduled || scheduled.patientId !== patientId) {
    res.status(404).json({ error: "Dose agendada não encontrada" });
    return;
  }

  // "Agora" é resolvido pelo relógio do SERVIDOR, não pelo do cliente.
  //
  // Antes, o cliente sempre mandava `new Date().toISOString()` pra dizer
  // "acabei de tomar", e o servidor comparava esse instante com o relógio
  // DELE sem tolerância nenhuma. Bastavam alguns segundos de dessincronia
  // entre os dois relógios (comum, e fora do controle de qualquer um dos
  // lados) pra um registro legítimo ser recusado com "não é possível
  // registrar uma dose no futuro" — foi exatamente o que travou o "Tomei"
  // do modo idoso num aparelho real.
  //
  // Agora `takenAt` é opcional: ausente significa "agora, segundo o
  // servidor", que é a única fonte confiável. O registro retroativo
  // (ZELO-24) continua mandando o instante explicitamente, que é o caso em
  // que a intenção do cuidador sobre o horário realmente importa.
  const now = Clock.now();
  let takenAt = body.data.takenAt ? new Date(body.data.takenAt) : now;

  if (Number.isNaN(takenAt.getTime())) {
    res.status(400).json({ error: "Horário inválido." });
    return;
  }

  // ZELO-24: dose no futuro continua proibida — mas só quando é intenção
  // de verdade (registrar a dose de amanhã). Um futuro de poucos minutos é
  // relógio fora de sincronia, não intenção: aceita e ancora no relógio do
  // servidor, em vez de recusar um registro legítimo.
  const futureMs = takenAt.getTime() - now.getTime();
  if (futureMs > CLOCK_SKEW_TOLERANCE_MS) {
    res.status(400).json({ error: "Não é possível registrar uma dose no futuro." });
    return;
  }
  if (futureMs > 0) takenAt = now;

  // ── Issue #134: e a dose, é para agora? ─────────────────────────────────
  //
  // As duas checagens acima olham `takenAt` contra o relógio. Nenhuma delas
  // olha a única coisa que importa aqui: **o quanto esta dose ainda vai
  // demorar**. Sem este bloco, marcar às 00:49 a dose das 23:00 passava
  // limpo — foi o defeito relatado.
  //
  // O 400 não é o fim do caminho: o mesmo pedido com `confirmarAntecipacao`
  // entra. O que a recusa compra é que **um toque acidental não resolve uma
  // dose que ainda vai demorar horas**.
  //
  // ── E a comparação é com AGORA, não com `takenAt` ──────────────────────
  //
  // Errei isto na primeira versão e o CI cobrou: comparar com `takenAt`
  // fazia todo **registro retroativo** cair aqui. Registrar hoje, às 10h,
  // uma dose que foi dada ontem às 9h dá uma distância de 25 h — e a rota
  // respondia `ANTECIPACAO_REQUERIDA` para o que é exatamente o oposto de
  // uma antecipação.
  //
  // A pergunta desta regra é *"esta dose já chegou?"*, e isso é sobre o
  // agendamento contra o **presente**. O que o cuidador diz sobre a hora em
  // que deu o remédio é assunto do eixo retroativo, logo abaixo.
  if (!doseJaChegou(scheduled.scheduledAt, now) && !body.data.confirmarAntecipacao) {
    res.status(400).json({
      // O horário vem no fuso do PACIENTE, não no de quem registra — a
      // armadilha da ZELO-19. `scheduledLocalTime` já é essa etiqueta.
      error: `Esta dose é das ${scheduled.scheduledLocalTime}. Confirme que quer registrá-la agora.`,
      code: "ANTECIPACAO_REQUERIDA",
      scheduledLocalTime: scheduled.scheduledLocalTime,
    });
    return;
  }

  // ZELO-24: fora da janela retroativa da família, exige justificativa —
  // dentro dela, só confirmar o horário real já basta.
  const [family] = await db
    .select({ retroactiveWindowHours: familiesTable.retroactiveWindowHours })
    .from(familiesTable)
    .where(eq(familiesTable.id, getAuth(req).familyId))
    .limit(1);
  const windowMs = (family?.retroactiveWindowHours ?? 24) * 3_600_000;
  const gapMs = Clock.now().getTime() - takenAt.getTime();
  if (gapMs > windowMs && !body.data.justification?.trim()) {
    res.status(400).json({
      error: `Esse registro é de mais de ${family?.retroactiveWindowHours ?? 24}h atrás — adicione uma breve justificativa pra confirmar.`,
      code: "JUSTIFICATION_REQUIRED",
    });
    return;
  }

  // O PRIMEIRO REGISTRO VENCE — garantido pela constraint UNIQUE do banco,
  // não por uma checagem "SELECT antes de INSERT" (que teria uma janela de
  // corrida). onConflictDoNothing() faz o segundo INSERT simultâneo virar
  // um no-op silencioso em vez de um erro.
  const [inserted] = await db
    .insert(doseRecordsTable)
    .values({
      scheduledDoseId: body.data.scheduledDoseId,
      patientId,
      caregiverId: getAuth(req).caregiverId,
      takenAt,
      outcome: body.data.outcome,
      postponedTo: body.data.postponedTo ? new Date(body.data.postponedTo) : null,
      justification: body.data.justification?.trim() || null,
      notes: body.data.notes ?? null,
      registeredViaElderMode: body.data.viaElderMode ?? false,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await db
      .update(scheduledDosesTable)
      .set({ status: inserted.outcome, updatedAt: Clock.now() })
      .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId));

    safeLog.info({
      action: "created", entityType: "dose_record",
      familyId: getAuth(req).familyId,
      scheduledDoseId: inserted.scheduledDoseId,
      outcome: inserted.outcome,
    }, "Dose registrada");

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "dose_record",
      entityId: String(inserted.id),
      action: "created",
      actorId: String(getAuth(req).caregiverId),
      actorType: "caregiver",
      ipAddress: req.ip,
    });

    if (inserted.outcome === "taken") {
      // Decrementar estoque é reação a este evento, não parte deste
      // fluxo — dose-records.ts não conhece stock.ts, só publica.
      await ensureQueueStarted();
      await boss.send(QUEUE_DOSE_TAKEN, { patientId, medicationId: scheduled.medicationId });
    }

    // ZELO-25: quem mais estiver com este paciente aberto vê a mudança em
    // tempo real, sem dar refresh — "o irmão registrou e você vê na hora".
    const [actingCaregiver] = await db.select({ name: caregiversTable.name }).from(caregiversTable).where(eq(caregiversTable.id, getAuth(req).caregiverId)).limit(1);
    publishPatientEvent(patientId, {
      type: "dose_registered",
      scheduledDoseId: inserted.scheduledDoseId,
      medicationName: scheduled.medicationName,
      scheduledLocalTime: scheduled.scheduledLocalTime,
      caregiverName: actingCaregiver?.name ?? "Um cuidador",
      status: inserted.outcome,
    });

    res.status(201).json({ ...inserted, wonRace: true });
    return;
  }

  // Perdeu a corrida — devolve o registro vencedor com 200, nunca um erro.
  const [winner] = await db
    .select({
      id: doseRecordsTable.id, scheduledDoseId: doseRecordsTable.scheduledDoseId, patientId: doseRecordsTable.patientId,
      caregiverId: doseRecordsTable.caregiverId, caregiverName: caregiversTable.name,
      takenAt: doseRecordsTable.takenAt, outcome: doseRecordsTable.outcome, postponedTo: doseRecordsTable.postponedTo,
      notes: doseRecordsTable.notes, createdAt: doseRecordsTable.createdAt,
    })
    .from(doseRecordsTable)
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(eq(doseRecordsTable.scheduledDoseId, body.data.scheduledDoseId))
    .limit(1);

  res.status(200).json({
    ...winner,
    wonRace: false,
    message: winner ? `${winner.caregiverName ?? "Outro cuidador"} já registrou às ${formatTimeShort(winner.takenAt, patient.timezone)}` : "Essa dose já foi registrada",
  });
});

// ── Adiar lembrete em 15min (ZELO-28) ───────────────────────────────────────
// Botão "Adiar 15 min" da notificação — nunca cria dose_record, só reagenda
// um segundo lembrete (nível 1) pra daqui a 15 minutos.
//
// ZELO-30: o nível 1 já tem um job agendado desde a criação da dose (T+15
// upfront, às vezes só disparando horas depois) — a policy "exclusive"
// (queue.ts) rejeita em silêncio (ON CONFLICT DO NOTHING) qualquer segundo
// job com a mesma singletonKey enquanto o primeiro não chegar a um estado
// terminal, então só mandar um job novo não bastaria: precisa apagar
// qualquer job pendente desse nível ANTES de recriar — inclusive um "Adiar"
// anterior, que assim vira "adiar de novo a partir de agora" em vez de
// travar. Idempotência de verdade continua vindo de outro lugar (UNIQUE em
// notifications, dose-reminders.ts): se o nível 1 já foi enviado de fato,
// recriar o job não reenvia nada.
router.post("/patients/:patientId/dose-records/:scheduledDoseId/snooze", requireAuth, requireCapability("register_dose"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const scheduledDoseId = Number(req.params.scheduledDoseId);
  if (isNaN(patientId) || isNaN(scheduledDoseId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [dose] = await db
    .select({ id: scheduledDosesTable.id, status: scheduledDosesTable.status })
    .from(scheduledDosesTable)
    .where(and(eq(scheduledDosesTable.id, scheduledDoseId), eq(scheduledDosesTable.patientId, patientId)))
    .limit(1);
  if (!dose) { res.status(404).json({ error: "Dose agendada não encontrada" }); return; }
  if (dose.status !== "pending") { res.status(409).json({ error: "Essa dose já foi registrada, não há o que adiar" }); return; }

  await ensureQueueStarted();
  const snoozedUntil = new Date(Clock.now().getTime() + 15 * 60_000);
  const singletonKey = `reminder:${scheduledDoseId}:${ESCALATION_LEVEL_SNOOZE}`;
  const existing = await boss.findJobs(QUEUE_DOSE_REMINDER, { key: singletonKey });
  if (existing.length > 0) {
    await boss.deleteJob(QUEUE_DOSE_REMINDER, existing.map((j) => j.id));
  }
  await boss.send(
    QUEUE_DOSE_REMINDER,
    { scheduledDoseId, level: ESCALATION_LEVEL_SNOOZE },
    { singletonKey, startAfter: snoozedUntil }
  );

  res.json({ scheduledDoseId, snoozedUntil: snoozedUntil.toISOString() });
});

/**
 * ── Desfazer (até 60 s depois de registrar) ───────────────────────────────
 *
 * QUEM PODE: qualquer cuidador da família com `register_dose` — **não só
 * quem registrou**. Isto sempre foi assim no servidor, e é deliberado: quem
 * está junto no quarto vê o engano tanto quanto quem tocou no botão, e
 * obrigar a chamar a outra pessoa para desfazer um toque acidental seria
 * transformar um segundo de descuido num problema de logística.
 *
 * Até a #135 a tela não deixava isso acontecer: o botão dependia de um
 * `undoableRecordId` guardado na memória da aba de quem tinha **vencido a
 * corrida**, com um `setTimeout` de 60 s. Recarregar a página perdia o
 * desfazer mesmo dentro do prazo, e a ficha do paciente não oferecia nenhum.
 * O remédio existia e não estava ao alcance.
 */
router.post("/patients/:patientId/dose-records/:recordId/undo", requireAuth, requireCapability("register_dose"), async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const recordId = Number(req.params.recordId);
  if (isNaN(patientId) || isNaN(recordId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const [record] = await db
    .select()
    .from(doseRecordsTable)
    .where(and(eq(doseRecordsTable.id, recordId), eq(doseRecordsTable.patientId, patientId)))
    .limit(1);
  if (!record) { res.status(404).json({ error: "Registro não encontrado" }); return; }

  const ageMs = Clock.now().getTime() - record.createdAt.getTime();
  if (ageMs > UNDO_WINDOW_MS) {
    // Mensagem que a tela mostra como está. A anterior ("Prazo para desfazer
    // expirou (60 segundos)") descrevia a regra e não dizia o que fazer —
    // quem lê quer saber qual é a saída, não qual foi o prazo.
    res.status(409).json({
      error: "Passou o tempo de desfazer. Este registro agora só pode ser corrigido.",
      code: "PRAZO_DE_DESFAZER_EXPIROU",
    });
    return;
  }

  await db.delete(doseRecordsTable).where(eq(doseRecordsTable.id, recordId));
  await db
    .update(scheduledDosesTable)
    .set({ status: "pending", updatedAt: Clock.now() })
    .where(eq(scheduledDosesTable.id, record.scheduledDoseId));

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "dose_record",
    entityId: String(recordId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
    diff: JSON.stringify({ undone: { outcome: record.outcome } }),
  });

  publishPatientEvent(patientId, { type: "dose_undone", scheduledDoseId: record.scheduledDoseId });

  res.json({ scheduledDoseId: record.scheduledDoseId, status: "pending" });
});

export default router;
