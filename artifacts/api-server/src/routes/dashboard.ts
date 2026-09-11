import { getAuth } from "../lib/auth-types.ts";
/**
 * Dashboard — ZELO.
 * familyId vem do token JWT.
 */
import { Router } from "express";
import { eq, and, count, gte, lte, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable, caregiversTable, scheduledDosesTable, appointmentsTable, stockEntriesTable,
  medicationsTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { Clock } from "../lib/clock";
import { localDayBoundsUtc, toLocalDateTime } from "@workspace/scheduling";
import { computeDaysRemaining, loadActiveTreatmentSchedule } from "../lib/stock.ts";
import { getPlanLimits } from "../lib/plan-limits.ts";
import { dosesDoDia, janelaDoDia } from "../lib/doses-do-dia.ts";

const router = Router();

router.get("/dashboard", requireAuth, async (req, res): Promise<void> => {
  const familyId = getAuth(req).familyId;

  const [[patientRow], [caregiverRow]] = await Promise.all([
    db.select({ count: count() }).from(patientsTable).where(eq(patientsTable.familyId, familyId)),
    db.select({ count: count() }).from(caregiversTable).where(eq(caregiversTable.familyId, familyId)),
  ]);

  const todayStart = new Date(Clock.now());
  todayStart.setUTCHours(0, 0, 0, 0);
  const todayEnd = new Date(Clock.now());
  todayEnd.setUTCHours(23, 59, 59, 999);

  const familyPatients = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(eq(patientsTable.familyId, familyId));

  let pendingDoses = 0, takenDoses = 0, lateDoses = 0;

  if (familyPatients.length > 0) {
    const doses = await db
      .select({ status: scheduledDosesTable.status })
      .from(scheduledDosesTable)
      .where(and(
        gte(scheduledDosesTable.scheduledAt, todayStart),
        lte(scheduledDosesTable.scheduledAt, todayEnd)
      ));
    for (const d of doses) {
      if (d.status === "pending") pendingDoses++;
      else if (d.status === "taken") takenDoses++;
      else if (d.status === "late") lateDoses++;
    }
  }

  const [apptRow] = await db
    .select({ count: count() })
    .from(appointmentsTable)
    .where(and(gte(appointmentsTable.scheduledAt, Clock.now()), eq(appointmentsTable.status, "scheduled")));

  // ZELO-34: mesma definição de "baixo" (dias restantes por posologia) do
  // resto do app. Corrigido no caminho: esta consulta nunca filtrava por
  // família (contava estoque de TODAS as famílias no total) — join por
  // patientsTable pra escopar corretamente, igual todo outro dado aqui.
  const stockItems = await db
    .select({
      patientId: stockEntriesTable.patientId, medicationId: stockEntriesTable.medicationId,
      quantityRemaining: stockEntriesTable.quantityRemaining, unit: stockEntriesTable.unit,
      prescriptionExpiresAt: stockEntriesTable.prescriptionExpiresAt, patientTimezone: patientsTable.timezone,
    })
    .from(stockEntriesTable)
    .innerJoin(patientsTable, eq(stockEntriesTable.patientId, patientsTable.id))
    .where(eq(patientsTable.familyId, familyId));
  const lowStockFlags = await Promise.all(
    stockItems.map(async (s) => {
      const activeTreatment = await loadActiveTreatmentSchedule(s.patientId, s.medicationId);
      return computeDaysRemaining(s, activeTreatment, s.patientTimezone).isLow;
    })
  );
  const lowStock = lowStockFlags.filter(Boolean).length;

  res.json({
    familyId,
    patientCount: patientRow?.count ?? 0,
    caregiverCount: caregiverRow?.count ?? 0,
    pendingDosesToday: pendingDoses,
    takenDosesToday: takenDoses,
    lateDoses,
    upcomingAppointments: apptRow?.count ?? 0,
    lowStockItems: lowStock,
  });
});

/**
 * Painel do dia consolidado — ZELO-57.
 *
 * A tela inicial responde "está tudo em dia?" para UM paciente por vez.
 * Quem cuida de 8, 12 ou 15 pessoas teria que trocar de paciente uma a
 * uma pra descobrir o que está pendente agora — e é justamente essa
 * pessoa que mais esquece alguém.
 *
 * DUAS CONSULTAS, INDEPENDENTE DA QUANTIDADE DE PACIENTES: uma pega os
 * pacientes ativos da família, a outra pega as doses de hoje de todos
 * eles de uma vez (`inArray`). Nunca uma consulta por paciente — mesmo
 * cuidado do calendário de adesão (ZELO-33), pelo mesmo motivo: com 15
 * pacientes, N+1 vira tela lenta na hora em que ela mais importa.
 *
 * Sem percentual de adesão e sem ranking entre pacientes, de propósito:
 * isso viraria um placar de quem "está indo pior", o oposto do produto
 * (CON-012). A ordenação é por URGÊNCIA (o que precisa de olho agora),
 * não por desempenho.
 */
// Caminho sob /dashboard, não sob /patients: `GET /patients/:patientId`
// (patients.ts) casaria com "/patients/today-summary" tratando
// "today-summary" como id, e a resposta viraria 400 de ID inválido —
// dependente da ordem de montagem dos routers, que é frágil demais pra se
// apoiar. Um prefixo sem parâmetro elimina a ambiguidade por construção.
router.get("/dashboard/today-summary", requireAuth, async (req, res): Promise<void> => {
  const familyId = getAuth(req).familyId;

  const patients = await db
    .select({ id: patientsTable.id, name: patientsTable.name, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.familyId, familyId), eq(patientsTable.archived, false)))
    .orderBy(patientsTable.createdAt);

  if (patients.length === 0) { res.json({ patients: [] }); return; }

  /**
   * Cada paciente pode ter fuso próprio (ZELO-19), então o "dia de hoje" não
   * é o mesmo intervalo para todos — e nem a madrugada (#154), que começa às
   * 18:00 no relógio de cada um.
   *
   * A consulta usa a UNIÃO das janelas, numa ida só ao banco. O recorte
   * exato de cada paciente é feito depois, em memória: uma consulta por
   * paciente seria N idas para responder uma pergunta só.
   */
  const agora = Clock.now();
  const janelas = patients.map((p) => janelaDoDia(p.timezone, agora));
  const windowStart = new Date(Math.min(...janelas.map((j) => j.inicioDoDia.getTime())));
  const windowEnd = new Date(Math.max(...janelas.map((j) => j.fimDaBusca.getTime())));

  /**
   * Issue #178 — as doses INTEIRAS, e não só a contagem delas.
   *
   * Esta rota já buscava as doses de todos os pacientes da família e as
   * jogava fora, devolvendo números. A tela inicial, que precisava delas,
   * pedia `today-doses` para UM paciente — e era por isso que ela mostrava
   * um enquanto o cuidador tinha quatro.
   *
   * Devolver as doses é abrir a mão que já estava cheia: a consulta custa o
   * mesmo, e é literalmente a mesma de `today-doses` (ver
   * `lib/doses-do-dia.ts`, que passou a ser o dono do dia).
   */
  const doses = await dosesDoDia(patients, { de: windowStart, ate: windowEnd });

  const now = agora;
  const summaries = patients.map((patient, i) => {
    const { inicioDoDia, fimDoDia } = janelas[i];
    // As contagens são do DIA. A madrugada de amanhã não entra: sem isso, a
    // faixa "Tudo em dia hoje" sumiria numa noite em que o dia ESTÁ em dia,
    // só porque há remédio às 03:00 (#154).
    const ofPatient = doses.filter((d) =>
      d.patientId === patient.id &&
      d.scheduledAt.getTime() >= inicioDoDia.getTime() &&
      d.scheduledAt.getTime() <= fimDoDia.getTime()
    );

    const pending = ofPatient.filter((d) => d.status === "pending");
    // "Sem registro" é o pior estado possível aqui — e nunca é vermelho na
    // tela, nem chamado de falha de ninguém.
    const missed = ofPatient.filter((d) => d.status === "late");
    const dueNow = pending.filter((d) => d.scheduledAt.getTime() <= now.getTime());
    const upcoming = pending.filter((d) => d.scheduledAt.getTime() > now.getTime());
    const next = upcoming[0] ?? null;

    return {
      patientId: patient.id,
      patientName: patient.name,
      totalDoses: ofPatient.length,
      missedDoses: missed.length,
      dueNowDoses: dueNow.length,
      upcomingDoses: upcoming.length,
      takenDoses: ofPatient.filter((d) => d.status === "taken").length,
      nextDose: next ? { medicationName: next.medicationName, scheduledLocalTime: next.scheduledLocalTime } : null,
    };
  });

  // Ordem por urgência: quem tem dose sem registro primeiro, depois quem
  // tem dose para agora, depois o resto. Nunca alfabética — a lista existe
  // pra dizer "olhe para cá primeiro".
  summaries.sort((a, b) =>
    b.missedDoses - a.missedDoses ||
    b.dueNowDoses - a.dueNowDoses ||
    a.patientName.localeCompare(b.patientName, "pt-BR")
  );

  /**
   * As doses do dia de cada paciente, numa lista só.
   *
   * ── Por que uma lista só, e não agrupada por paciente ─────────────────
   *
   * Porque a pergunta do cuidador é "o que precisa de mim agora", e não
   * "como vai o paciente número três". Agrupar por pessoa faria ler quatro
   * blocos para achar as duas coisas que precisam dele. O nome do paciente
   * vai em cada dose, e a tela o mostra quando há mais de um.
   *
   * O recorte é feito AQUI, e não na consulta: cada paciente pode ter fuso
   * próprio (ZELO-19), então "hoje" não é o mesmo intervalo para todos —
   * `bounds[i]` é o dia civil de cada um.
   */
  const doDia = patients.flatMap((patient, i) => {
    const { inicioDoDia, fimDoDia } = janelas[i];
    return doses.filter(
      (d) =>
        d.patientId === patient.id &&
        d.scheduledAt.getTime() >= inicioDoDia.getTime() &&
        d.scheduledAt.getTime() <= fimDoDia.getTime(),
    );
  });
  doDia.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  /**
   * A madrugada de amanhã — Issue #154, agora de todos os pacientes.
   *
   * Vazia durante o dia, porque a janela nem foi buscar tão longe. Lista à
   * parte, e nunca misturada em `doses`: a tela responde "está tudo em dia
   * hoje?", e uma dose de amanhã no meio das de hoje mudaria a pergunta.
   */
  const daMadrugada = patients.flatMap((patient, i) => {
    const { fimDoDia } = janelas[i];
    return doses.filter(
      (d) => d.patientId === patient.id && d.scheduledAt.getTime() > fimDoDia.getTime(),
    );
  });
  daMadrugada.sort((a, b) => a.scheduledAt.getTime() - b.scheduledAt.getTime());

  /**
   * ── O estoque acabando e a próxima consulta, de TODOS ──────────────────
   *
   * Estavam só no `today-doses`, de um paciente. A tela inicial passou a ser
   * de todos, e deixá-los para trás seria trocar um defeito por outro: o
   * cuidador veria o dia inteiro e perderia o aviso de que a Losartana do
   * José está acabando.
   *
   * O nome do paciente vai junto, pelo mesmo motivo das doses: numa lista de
   * várias pessoas, "Losartana — 3 dias" sem dizer de quem não serve.
   */
  const planLimits = await getPlanLimits(familyId);
  const nomePorPaciente = new Map(patients.map((p) => [p.id, p.name]));
  const fusoPorPaciente = new Map(patients.map((p) => [p.id, p.timezone]));

  const stockRows = await db
    .select({
      patientId: stockEntriesTable.patientId,
      medicationId: stockEntriesTable.medicationId,
      medicationName: medicationsTable.name,
      quantityRemaining: stockEntriesTable.quantityRemaining,
      unit: stockEntriesTable.unit,
      prescriptionExpiresAt: stockEntriesTable.prescriptionExpiresAt,
    })
    .from(stockEntriesTable)
    .innerJoin(medicationsTable, eq(stockEntriesTable.medicationId, medicationsTable.id))
    .where(inArray(stockEntriesTable.patientId, patients.map((p) => p.id)));

  /**
   * ZELO-38: o ALERTA de estoque baixo é do plano Família; o controle em si
   * (registrar e ajustar quantidade) continua liberado no gratuito. Calcular
   * sempre e filtrar a resposta evita reimplementar a conta em dois lugares.
   */
  const lowStockItems = planLimits.stockLowAlert
    ? (
        await Promise.all(
          stockRows.map(async (item) => {
            const tratamento = await loadActiveTreatmentSchedule(item.patientId, item.medicationId);
            const dias = computeDaysRemaining(
              item,
              tratamento,
              fusoPorPaciente.get(item.patientId) ?? "America/Sao_Paulo",
            );
            return { ...item, ...dias, patientName: nomePorPaciente.get(item.patientId) ?? "" };
          }),
        )
      )
        .filter((item) => item.isLow)
        .map(({ patientId, patientName, medicationId, medicationName, quantityRemaining, unit, effectiveDaysRemaining }) => ({
          patientId, patientName, medicationId, medicationName, quantityRemaining, unit, effectiveDaysRemaining,
        }))
    : [];

  // A próxima consulta da família inteira — uma só, a mais próxima. A lista
  // completa é da tela de consultas; aqui é lembrete, não agenda.
  const [nextAppointment] = await db
    .select({
      patientId: appointmentsTable.patientId,
      specialty: appointmentsTable.specialty,
      doctorName: appointmentsTable.doctorName,
      scheduledAt: appointmentsTable.scheduledAt,
    })
    .from(appointmentsTable)
    .where(and(
      inArray(appointmentsTable.patientId, patients.map((p) => p.id)),
      eq(appointmentsTable.status, "scheduled"),
      gte(appointmentsTable.scheduledAt, agora),
    ))
    .orderBy(appointmentsTable.scheduledAt)
    .limit(1);

  res.json({
    patients: summaries,
    doses: doDia,
    madrugada: daMadrugada,
    lowStockItems,
    nextAppointment: nextAppointment
      ? {
          ...nextAppointment,
          patientName: nomePorPaciente.get(nextAppointment.patientId) ?? "",
          ...toLocalDateTime(
            nextAppointment.scheduledAt,
            fusoPorPaciente.get(nextAppointment.patientId) ?? "America/Sao_Paulo",
          ),
        }
      : null,
  });
});

router.get("/patients/:patientId/today-doses", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id, name: patientsTable.name, timezone: patientsTable.timezone, familyId: patientsTable.familyId, elderModeEnabled: patientsTable.elderModeEnabled })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const todayInPatientTz = Clock.todayInTimezone(patient.timezone);
  // ZELO-19: nunca `new Date(`${data}T00:00:00`)` — sem offset, isso é
  // interpretado no fuso do PROCESSO, não no do paciente. localDayBoundsUtc
  // delimita o dia civil corretamente, independente do TZ do servidor.
  const { start: todayStart, end: todayEnd } = localDayBoundsUtc(todayInPatientTz, patient.timezone);

  /**
   * ── A madrugada seguinte — Issue #154 ────────────────────────────────────
   *
   * O fundador perguntou: *"e se eu tiver que tomar um remédio de madrugada?
   * Essa pendência será listada? Pois se não for, é capaz que eu esqueça."*
   *
   * Não era. A tela recorta pelo dia civil, então **às 22:00 a dose das 03:00
   * de amanhã não aparecia em lugar nenhum**. Quem ia dormir não sabia que
   * precisava acordar, e de manhã ela surgia como "Perdida" — descoberta
   * depois do fato, que é o que este produto existe para evitar.
   *
   * ── Não é sobre o aviso, é sobre poder se PLANEJAR ──────────────────────
   *
   * O lembrete de madrugada **já funciona**: o silêncio noturno só cala o
   * broadcast de nível 2, nunca o primeiro aviso a quem é responsável (ver
   * `lib/dose-reminders.ts`). Ninguém deixa de ser acordado.
   *
   * O que faltava era saber **antes**: ajustar o despertador, combinar quem
   * acorda, deixar o remédio separado. Por isso a janela aparece à noite, e
   * não é alarme nenhum.
   *
   * ── Por que o SERVIDOR decide a hora, e não a tela ──────────────────────
   *
   * "Depois das 18:00" tem de ser 18:00 **no relógio do paciente**. Um filho
   * em Portugal olhando a mãe em São Paulo tem outro relógio no navegador —
   * deixar a tela decidir mostraria a madrugada na hora errada para ele. É a
   * mesma regra do ZELO-19, e o servidor é quem sabe o fuso.
   */
  // Issue #178: a regra saiu daqui para `lib/doses-do-dia.ts`. A tela
  // inicial de vários pacientes precisa da MESMA resposta para "já é
  // noite?", e copiá-la criaria duas.
  const { fimDaBusca } = janelaDoDia(patient.timezone, Clock.now());

  // ZELO-22 (tela inicial): junta o nome do medicamento e, pra doses já
  // registradas, quem registrou — "✓ Losartana 08:00 — Ana" é o diferencial
  // do produto, e não dá pra montar isso com 3 chamadas separadas.
  //
  // Issue #178: a consulta e o mapeamento saíram daqui para
  // `lib/doses-do-dia.ts`. Eles estavam duplicados com a `today-summary`,
  // que buscava as doses de todos os pacientes e devolvia só a contagem —
  // e era por isso que a tela inicial mostrava um paciente enquanto o
  // cuidador tinha quatro. Duas verdades sobre o mesmo dia é o defeito que
  // a #162 acabou de consertar na tela; aqui seria o mesmo, no servidor.
  const dosesWithDisplayName = await dosesDoDia(
    [{ id: patient.id, name: patient.name }],
    { de: todayStart, ate: fimDaBusca },
  );

  // Issue #154: duas listas, e o corte e o fim do dia civil do paciente.
  // O que vem depois e madrugada de amanha — so existe aqui quando ja e
  // noite, porque so entao a consulta foi buscar tao longe.
  const doDia = dosesWithDisplayName.filter((d) => d.scheduledAt <= todayEnd);
  const daMadrugada = dosesWithDisplayName.filter((d) => d.scheduledAt > todayEnd);

  // ZELO-34: "baixo" é dias restantes (a partir da posologia prescrita),
  // não uma quantidade absoluta — a mesma definição usada em GET /stock e
  // no worker de decremento (lib/stock.ts), nunca reimplementada aqui.
  const stockRows = await db
    .select({
      medicationId: stockEntriesTable.medicationId,
      medicationName: medicationsTable.name,
      quantityRemaining: stockEntriesTable.quantityRemaining,
      unit: stockEntriesTable.unit,
      prescriptionExpiresAt: stockEntriesTable.prescriptionExpiresAt,
    })
    .from(stockEntriesTable)
    .innerJoin(medicationsTable, eq(stockEntriesTable.medicationId, medicationsTable.id))
    .where(eq(stockEntriesTable.patientId, patientId));
  // ZELO-38: "alerta de estoque baixo" é recurso do plano Família — o
  // CONTROLE de estoque em si (registrar/ajustar quantidade) continua
  // liberado no gratuito, só o alerta calmo é que é gated. Rastrear tudo
  // normalmente e só filtrar a resposta evita reimplementar a conta em
  // dois lugares.
  const planLimits = await getPlanLimits(getAuth(req).familyId);
  const lowStockItems = planLimits.stockLowAlert ? (
    await Promise.all(
      stockRows.map(async (s) => {
        const activeTreatment = await loadActiveTreatmentSchedule(patientId, s.medicationId);
        const days = computeDaysRemaining(s, activeTreatment, patient.timezone);
        return { ...s, ...days };
      })
    )
  ).filter((s) => s.isLow) : [];

  const [nextAppointment] = await db
    .select({ specialty: appointmentsTable.specialty, doctorName: appointmentsTable.doctorName, scheduledAt: appointmentsTable.scheduledAt })
    .from(appointmentsTable)
    .where(and(eq(appointmentsTable.patientId, patientId), eq(appointmentsTable.status, "scheduled"), gte(appointmentsTable.scheduledAt, Clock.now())))
    .orderBy(appointmentsTable.scheduledAt)
    .limit(1);

  res.json({
    date: todayInPatientTz,
    patientTimezone: patient.timezone,
    elderModeEnabled: patient.elderModeEnabled,
    // Issue #154 — as contagens são do DIA, e por isso saem de `doDia`.
    //
    // Antes saíam de `doses`, o resultado cru da consulta. Depois que ela
    // passou a buscar até as 06:00 de amanhã nas noites com dose de
    // madrugada, usar o cru faria `pendingDoses` contar amanhã junto — e a
    // faixa "Tudo em dia hoje" deixaria de aparecer numa noite em que o dia
    // ESTÁ em dia, só porque há remédio às 03:00.
    totalDoses: doDia.length,
    takenDoses: doDia.filter((d) => d.status === "taken").length,
    pendingDoses: doDia.filter((d) => d.status === "pending").length,
    lateDoses: doDia.filter((d) => d.status === "late").length,
    doses: doDia,
    /**
     * As doses da madrugada seguinte — Issue #154.
     *
     * Vazio durante o dia e sempre que não houver nenhuma. À noite traz as de
     * amanhã até as 06:00, para quem está se organizando para dormir poder se
     * planejar: ajustar o despertador, combinar quem acorda, separar o
     * remédio.
     *
     * **Lista à parte, e não misturada em `doses`.** A tela responde "está
     * tudo em dia hoje?", e uma dose de amanhã no meio das de hoje mudaria a
     * pergunta — além de entrar nas contas de `pendingDoses` e `lateDoses`,
     * que são sobre o dia de hoje.
     */
    madrugada: daMadrugada,
    lowStockItems: lowStockItems.map(({ medicationId, medicationName, quantityRemaining, unit, effectiveDaysRemaining }) => ({
      medicationId, medicationName, quantityRemaining, unit, effectiveDaysRemaining,
    })),
    // ZELO-36: resolvido no fuso do PACIENTE aqui — mesmo cuidado da
    // ZELO-19, nunca deixar o cliente reconverter o instante UTC sozinho.
    nextAppointment: nextAppointment ? { ...nextAppointment, ...toLocalDateTime(nextAppointment.scheduledAt, patient.timezone) } : null,
  });
});

router.get("/patients/:patientId/adherence-stats", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const days = parseInt(String(req.query.days ?? "30"), 10) || 30;
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const from = new Date(Clock.now());
  from.setDate(from.getDate() - days);

  const doses = await db
    .select({ status: scheduledDosesTable.status })
    .from(scheduledDosesTable)
    .where(and(eq(scheduledDosesTable.patientId, patientId), gte(scheduledDosesTable.scheduledAt, from)));

  const total = doses.length;
  const taken = doses.filter((d) => d.status === "taken").length;

  res.json({
    patientId, periodDays: days,
    totalScheduled: total, totalTaken: taken,
    totalSkipped: doses.filter((d) => d.status === "skipped").length,
    totalLate: doses.filter((d) => d.status === "late").length,
    adherenceRate: total > 0 ? taken / total : 0,
  });
});

router.get("/design-tokens", async (_req, res): Promise<void> => {
  res.json({
    colors: { zeloCalmGreen: "#517B5F", zeloAmber: "#E9AD51", zeloBackground: "#F8F7F5", zeloSurface: "#FFFFFF", zeloText: "#2D2D2B", zeloTextMuted: "#6B6B6B" },
    typography: { baseSize: "18px", headingFont: "DM Sans, system-ui, sans-serif" },
    spacing: { touchTarget: "48px" },
  });
});

export default router;
