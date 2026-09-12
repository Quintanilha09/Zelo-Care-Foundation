/**
 * O remédio "se necessário" — Issue #169.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO EXISTE PORQUE "TOMAR SE PRECISAR" NÃO É UM HORÁRIO.
 *
 * Dipirona para dor, bombinha de resgate, remédio de enjoo, laxante,
 * antitérmico. Os cinco padrões de posologia respondem *quando tomar*; este
 * responde *tomar se*. Até a #169 não cabia, e o contorno — inventar um
 * horário e pular todo dia — fazia o relatório do médico dizer que o paciente
 * NÃO TOMA o remédio que ele só devia tomar quando precisasse.
 *
 * E é justamente onde registrar importa mais: quantas vezes a bombinha de
 * resgate foi usada nesta semana é sinal clínico.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que se grava, e por que na mesma tabela de sempre ──────────────────
 *
 * Um uso vira uma `scheduled_doses` **já tomada** mais o `dose_records` dela.
 * Tabela nova seria mais "limpa" no diagrama e mais pobre no app: desfazer
 * (#136), corrigir o horário (#162), acrescentar o motivo (#166), o rastro de
 * auditoria e o histórico da ficha são todos amarrados a `scheduledDoseId`.
 * Uma tabela paralela obrigaria a reescrever cada um deles — e quem registra
 * um "se necessário" erra o horário exatamente como erra o de horário fixo.
 *
 * O que separa os dois é o `scheduleType` do tratamento, e é por ele que a
 * geração não agenda nada (lib/dose-generation.ts) e o relatório não conta na
 * adesão (lib/adherence-report.ts).
 *
 * ── O que este arquivo NÃO faz, e não pode passar a fazer ────────────────
 *
 * `intervaloMinimoHoras` e `tetoDiario` vêm da receita e são **mostrados**.
 * A resposta traz "a última foi às 14:20" e "já foram 2 hoje" porque isso é
 * registro. Dizer "ainda não pode dar" seria prescrição, e o invariante 4
 * proíbe. Não há 409, não há bloqueio, não há aviso: o cuidador está com a
 * pessoa na frente dele e o médico é quem interpreta.
 */
import { Router } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  doseRecordsTable, scheduledDosesTable, treatmentsTable,
  medicationsTable, patientsTable, caregiversTable,
} from "@workspace/db";
import { toLocalDateTime, localDayBoundsUtc } from "@workspace/scheduling";
import { requireAuth } from "../middleware/require-auth";
import { requireCapability } from "../lib/capabilities.ts";
import { getAuth } from "../lib/auth-types.ts";
import { mensagemDeValidacao } from "../lib/erro-de-validacao.ts";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { publishPatientEvent } from "../lib/realtime.ts";

const router = Router();

/**
 * O mesmo respiro de relógio das doses de horário fixo.
 *
 * O relógio do celular adianta alguns segundos o tempo todo, e recusar um
 * registro legítimo por isso já travou o "Tomei" do modo idoso num aparelho
 * de verdade.
 */
const TOLERANCIA_DE_RELOGIO_MS = 2 * 60 * 1000;

/**
 * Quanto para trás dá para registrar um uso.
 *
 * Trinta dias não é regra clínica — é a borda do erro de digitação. Quem
 * escreve o ano errado numa data cai aqui em vez de criar um uso em 2019 no
 * meio do relatório do médico. Registro retroativo de verdade ("dei ontem à
 * noite e esqueci de marcar") é o caso comum e passa sem perguntar nada: sem
 * hora marcada não há atraso contra o qual se justificar.
 */
const DIAS_PARA_TRAS = 30;

const UsoBody = z.object({
  /** Ausente = agora, pelo relógio do SERVIDOR (nunca o do cliente). */
  takenAt: z.string().datetime().optional(),
  /** Por que precisou. Texto livre e opcional — nunca uma lista que julgue. */
  justification: z.string().trim().min(1).max(500).optional(),
});

/** Um uso já registrado, do jeito que a tela mostra. */
interface UsoRegistrado {
  recordId: number;
  scheduledDoseId: number;
  takenAt: string;
  localDate: string;
  localTime: string;
  justification: string | null;
  caregiverName: string | null;
}

/**
 * Registra que o remédio "se necessário" foi dado.
 *
 * Devolve, junto, o retrato do dia — a última vez e quantas já foram. Vem na
 * mesma resposta porque é o que a tela precisa mostrar logo depois, e uma
 * segunda ida ao servidor deixaria a contagem piscar.
 */
router.post(
  "/patients/:patientId/treatments/:treatmentId/uso",
  requireAuth,
  requireCapability("register_dose"),
  async (req, res): Promise<void> => {
    const patientId = Number(req.params.patientId);
    const treatmentId = Number(req.params.treatmentId);
    if (isNaN(patientId) || isNaN(treatmentId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const body = UsoBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: mensagemDeValidacao(body.error) });
      return;
    }

    // Isolamento: o vínculo familiar vem do JWT, nunca da URL. Paciente de
    // outra família responde 404, e não 403 — 403 confirmaria que ele existe.
    const [patient] = await db
      .select({ id: patientsTable.id, timezone: patientsTable.timezone })
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
      .limit(1);
    if (!patient) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    const [tratamento] = await db
      .select({
        id: treatmentsTable.id,
        patientId: treatmentsTable.patientId,
        scheduleType: treatmentsTable.scheduleType,
        status: treatmentsTable.status,
        dose: treatmentsTable.dose,
        medicationId: treatmentsTable.medicationId,
        medicationName: medicationsTable.name,
      })
      .from(treatmentsTable)
      .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
      .where(eq(treatmentsTable.id, treatmentId))
      .limit(1);

    if (!tratamento || tratamento.patientId !== patientId) {
      res.status(404).json({ error: "Tratamento não encontrado" });
      return;
    }
    if (tratamento.scheduleType !== "se_necessario") {
      // Um tratamento de horário fixo tem dose agendada, e registrar por aqui
      // criaria uma dose fora da agenda dele — duas verdades sobre o mesmo
      // remédio no mesmo dia.
      res.status(400).json({
        error: "Este remédio tem horário marcado. Registre pela dose do dia.",
        code: "NAO_E_SE_NECESSARIO",
      });
      return;
    }
    if (tratamento.status !== "active") {
      res.status(400).json({ error: "Este tratamento não está ativo.", code: "TRATAMENTO_INATIVO" });
      return;
    }

    const agora = Clock.now();
    let quando = body.data.takenAt ? new Date(body.data.takenAt) : agora;
    if (Number.isNaN(quando.getTime())) {
      res.status(400).json({ error: "Horário inválido." });
      return;
    }

    const noFuturo = quando.getTime() - agora.getTime();
    if (noFuturo > TOLERANCIA_DE_RELOGIO_MS) {
      res.status(400).json({ error: "Não é possível registrar um uso no futuro." });
      return;
    }
    if (noFuturo > 0) quando = agora;

    if (agora.getTime() - quando.getTime() > DIAS_PARA_TRAS * 86_400_000) {
      res.status(400).json({
        error: `Esse horário é de mais de ${DIAS_PARA_TRAS} dias atrás. Confira a data.`,
        code: "MUITO_ANTIGO",
      });
      return;
    }

    const [caregiver] = await db
      .select({ id: caregiversTable.id, name: caregiversTable.name })
      .from(caregiversTable)
      .where(eq(caregiversTable.id, getAuth(req).caregiverId))
      .limit(1);
    if (!caregiver) {
      res.status(404).json({ error: "Cuidador não encontrado" });
      return;
    }

    // O retrato ANTES deste uso: é o que a tela vai dizer que aconteceu até
    // agora, e medi-lo depois somaria o uso que acabou de entrar.
    const antes = await retratoDoDia(patientId, treatmentId, patient.timezone, quando);

    let criado: { recordId: number; scheduledDoseId: number };
    try {
      criado = await gravarOUso({
        patientId,
        treatmentId,
        caregiverId: caregiver.id,
        timezone: patient.timezone,
        quando,
        dose: tratamento.dose,
        justification: body.data.justification ?? null,
      });
    } catch (err) {
      safeLog.error({ err, patientId, treatmentId }, "Falha ao registrar uso se necessário");
      res.status(500).json({ error: "Não foi possível registrar. Tente de novo." });
      return;
    }

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "dose_record",
      entityId: String(criado.recordId),
      action: "created",
      actorId: String(caregiver.id),
      actorType: "caregiver",
      ipAddress: req.ip,
      // Nunca o nome do medicamento nem o motivo — o diff do audit é
      // metadado, e o motivo é texto que a pessoa escreveu sobre saúde.
      diff: JSON.stringify({ seNecessario: true, retroativo: quando.getTime() < agora.getTime() - 60_000 }),
    });

    const { localTime } = toLocalDateTime(quando, patient.timezone);
    publishPatientEvent(patientId, {
      type: "dose_registered",
      scheduledDoseId: criado.scheduledDoseId,
      medicationName: tratamento.medicationName,
      scheduledLocalTime: localTime,
      caregiverName: caregiver.name,
      status: "taken",
    });

    res.status(201).json({
      recordId: criado.recordId,
      scheduledDoseId: criado.scheduledDoseId,
      takenAt: quando.toISOString(),
      /**
       * O retrato que a tela MOSTRA — e nada além disso.
       *
       * "A última foi às 14:20" e "já foram 2 hoje" são fatos registrados.
       * O app não compara com `intervaloMinimoHoras` nem com `tetoDiario`,
       * não conclui e não avisa: quem interpreta é o médico (invariante 4).
       */
      ultimoUsoAntesDeste: antes.ultimo,
      usosHojeAntesDeste: antes.hoje,
    });
  }
);

/**
 * Os usos de um "se necessário" — para a seção "Se precisar" e para o
 * histórico da ficha.
 */
router.get(
  "/patients/:patientId/treatments/:treatmentId/usos",
  requireAuth,
  async (req, res): Promise<void> => {
    const patientId = Number(req.params.patientId);
    const treatmentId = Number(req.params.treatmentId);
    if (isNaN(patientId) || isNaN(treatmentId)) {
      res.status(400).json({ error: "ID inválido" });
      return;
    }

    const [patient] = await db
      .select({ id: patientsTable.id, timezone: patientsTable.timezone })
      .from(patientsTable)
      .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
      .limit(1);
    if (!patient) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    const [tratamento] = await db
      .select({ id: treatmentsTable.id, patientId: treatmentsTable.patientId })
      .from(treatmentsTable)
      .where(eq(treatmentsTable.id, treatmentId))
      .limit(1);
    if (!tratamento || tratamento.patientId !== patientId) {
      res.status(404).json({ error: "Tratamento não encontrado" });
      return;
    }

    const usos = await listarUsos(patientId, treatmentId, patient.timezone, 50);
    res.json({ usos });
  }
);

/**
 * Grava o uso: a dose já tomada e o registro dela, numa transação.
 *
 * ── Por que a dose nasce com `scheduledAt` igual ao horário do uso ──────
 *
 * Porque é ele que agrupa o dia, e é ele que o relatório e o histórico leem.
 * Guardar o instante do REGISTRO ali faria um uso das 23:50 lançado às 00:10
 * cair no dia seguinte — e "quantas foram ontem" é a pergunta que este
 * recurso existe para responder.
 *
 * ── O empurrãozinho de um segundo ───────────────────────────────────────
 *
 * `UNIQUE(treatment_id, scheduled_at)` existe para a agenda não duplicar
 * dose. Aqui ele encontra um caso que a agenda não tem: dois usos no mesmo
 * minuto exato do mesmo remédio, que acontece quando alguém digita o mesmo
 * horário duas vezes. Recusar seria dizer ao cuidador que ele não pode
 * registrar uma coisa que ele fez; empurrar um segundo guarda os dois e não
 * muda nada que alguém leia (a tela mostra HH:mm).
 */
async function gravarOUso(entrada: {
  patientId: number;
  treatmentId: number;
  caregiverId: number;
  timezone: string;
  quando: Date;
  dose: string | null;
  justification: string | null;
}): Promise<{ recordId: number; scheduledDoseId: number }> {
  const TENTATIVAS = 5;
  let quando = entrada.quando;

  for (let i = 0; i < TENTATIVAS; i++) {
    try {
      return await db.transaction(async (tx) => {
        const { localDate, localTime } = toLocalDateTime(quando, entrada.timezone);
        const [dose] = await tx
          .insert(scheduledDosesTable)
          .values({
            treatmentId: entrada.treatmentId,
            patientId: entrada.patientId,
            scheduledAt: quando,
            scheduledLocalDate: localDate,
            scheduledLocalTime: localTime,
            // Nasce TOMADA. Nunca existiu como pendente, e por isso nunca
            // pode virar "atrasada" — não havia hora marcada para perder.
            status: "taken",
            dose: entrada.dose,
          })
          .returning({ id: scheduledDosesTable.id });

        const [record] = await tx
          .insert(doseRecordsTable)
          .values({
            scheduledDoseId: dose.id,
            patientId: entrada.patientId,
            caregiverId: entrada.caregiverId,
            takenAt: quando,
            outcome: "taken",
            justification: entrada.justification,
          })
          .returning({ id: doseRecordsTable.id });

        return { recordId: record.id, scheduledDoseId: dose.id };
      });
    } catch (err) {
      const code = (err as { cause?: { code?: string }; code?: string }).cause?.code
        ?? (err as { code?: string }).code;
      if (code === "23505" && i < TENTATIVAS - 1) {
        quando = new Date(quando.getTime() + 1000);
        continue;
      }
      throw err;
    }
  }
  throw new Error("não foi possível gravar o uso");
}

/** A última vez e quantas foram hoje, no fuso do paciente. */
export async function retratoDoDia(
  patientId: number,
  treatmentId: number,
  timezone: string,
  referencia: Date
): Promise<{ ultimo: string | null; hoje: number }> {
  const { localDate } = toLocalDateTime(referencia, timezone);
  const { start, end } = localDayBoundsUtc(localDate, timezone);

  const doDia = await db
    .select({ id: scheduledDosesTable.id })
    .from(scheduledDosesTable)
    .where(and(
      eq(scheduledDosesTable.treatmentId, treatmentId),
      eq(scheduledDosesTable.patientId, patientId),
      gte(scheduledDosesTable.scheduledAt, start),
      lte(scheduledDosesTable.scheduledAt, end),
    ));

  const [ultimo] = await db
    .select({ takenAt: doseRecordsTable.takenAt })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .where(eq(scheduledDosesTable.treatmentId, treatmentId))
    .orderBy(desc(doseRecordsTable.takenAt))
    .limit(1);

  return {
    ultimo: ultimo?.takenAt ? ultimo.takenAt.toISOString() : null,
    hoje: doDia.length,
  };
}

/** Os últimos usos, do mais recente para o mais antigo. */
export async function listarUsos(
  patientId: number,
  treatmentId: number,
  timezone: string,
  limite: number
): Promise<UsoRegistrado[]> {
  const linhas = await db
    .select({
      recordId: doseRecordsTable.id,
      scheduledDoseId: scheduledDosesTable.id,
      takenAt: doseRecordsTable.takenAt,
      justification: doseRecordsTable.justification,
      caregiverName: caregiversTable.name,
    })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(and(
      eq(scheduledDosesTable.treatmentId, treatmentId),
      eq(scheduledDosesTable.patientId, patientId),
    ))
    .orderBy(desc(doseRecordsTable.takenAt))
    .limit(limite);

  return linhas.map((l) => {
    const { localDate, localTime } = toLocalDateTime(l.takenAt, timezone);
    return {
      recordId: l.recordId,
      scheduledDoseId: l.scheduledDoseId,
      takenAt: l.takenAt.toISOString(),
      localDate,
      localTime,
      justification: l.justification,
      caregiverName: l.caregiverName,
    };
  });
}

export default router;
