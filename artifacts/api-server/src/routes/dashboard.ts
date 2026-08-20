import { getAuth } from "../lib/auth-types.ts";
/**
 * Dashboard — ZELO.
 * familyId vem do token JWT.
 */
import { Router } from "express";
import { eq, and, count, gte, lte, inArray, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable, caregiversTable, scheduledDosesTable, appointmentsTable, stockEntriesTable,
  treatmentsTable, medicationsTable, doseRecordsTable,
} from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { Clock } from "../lib/clock";
import { localDayBoundsUtc, toLocalDateTime } from "@workspace/scheduling";
import { computeDaysRemaining, loadActiveTreatmentSchedule } from "../lib/stock.ts";
import { getPlanLimits } from "../lib/plan-limits.ts";

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

  // Cada paciente pode ter fuso próprio (ZELO-19), então o "dia de hoje"
  // não é o mesmo intervalo pra todos. A janela consultada é a união dos
  // dias locais; o recorte exato por paciente é feito depois, em memória.
  const bounds = patients.map((p) => localDayBoundsUtc(Clock.todayInTimezone(p.timezone), p.timezone));
  const windowStart = new Date(Math.min(...bounds.map((b) => b.start.getTime())));
  const windowEnd = new Date(Math.max(...bounds.map((b) => b.end.getTime())));

  const doses = await db
    .select({
      patientId: scheduledDosesTable.patientId,
      scheduledAt: scheduledDosesTable.scheduledAt,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      status: scheduledDosesTable.status,
      medicationName: medicationsTable.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(and(
      inArray(scheduledDosesTable.patientId, patients.map((p) => p.id)),
      gte(scheduledDosesTable.scheduledAt, windowStart),
      lte(scheduledDosesTable.scheduledAt, windowEnd)
    ))
    .orderBy(scheduledDosesTable.scheduledAt);

  const now = Clock.now();
  const summaries = patients.map((patient, i) => {
    const { start, end } = bounds[i];
    const ofPatient = doses.filter((d) =>
      d.patientId === patient.id &&
      d.scheduledAt.getTime() >= start.getTime() &&
      d.scheduledAt.getTime() <= end.getTime()
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

  res.json({ patients: summaries });
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

  // ZELO-22 (tela inicial): junta o nome do medicamento (via treatment) e,
  // pra doses já registradas, quem registrou — "✓ Losartana 08:00 — Ana" é
  // o diferencial do produto, não dá pra montar isso com 3 chamadas separadas.
  const doses = await db
    .select({
      id: scheduledDosesTable.id,
      treatmentId: scheduledDosesTable.treatmentId,
      scheduledAt: scheduledDosesTable.scheduledAt,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      status: scheduledDosesTable.status,
      dose: scheduledDosesTable.dose,
      medicationName: medicationsTable.name,
      registeredAt: doseRecordsTable.takenAt,
      registeredByCaregiverId: doseRecordsTable.caregiverId,
      registeredByCaregiverName: caregiversTable.name,
      registeredViaElderMode: doseRecordsTable.registeredViaElderMode,
      recordId: doseRecordsTable.id,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .leftJoin(doseRecordsTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .where(and(
      eq(scheduledDosesTable.patientId, patientId),
      gte(scheduledDosesTable.scheduledAt, todayStart),
      lte(scheduledDosesTable.scheduledAt, todayEnd)
    ))
    .orderBy(scheduledDosesTable.scheduledAt);

  // ZELO-40: quando o registro veio do modo idoso, o nome exibido é o do
  // PRÓPRIO paciente ("✓ 08:00 — Dona Maria"), não o do cuidador cuja
  // sessão o aparelho travado estava usando — o caregiverId real (auditoria)
  // não muda, só este rótulo.
  const dosesWithDisplayName = doses.map((d) => ({
    ...d,
    registeredByCaregiverName: d.registeredViaElderMode ? patient.name : d.registeredByCaregiverName,
  }));

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
    totalDoses: doses.length,
    takenDoses: doses.filter((d) => d.status === "taken").length,
    pendingDoses: doses.filter((d) => d.status === "pending").length,
    lateDoses: doses.filter((d) => d.status === "late").length,
    doses: dosesWithDisplayName,
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
    colors: { zeloCalmGreen: "#659A76", zeloAmber: "#E9AD51", zeloBackground: "#F8F7F5", zeloSurface: "#FFFFFF", zeloText: "#2D2D2B", zeloTextMuted: "#6B6B6B" },
    typography: { baseSize: "18px", headingFont: "DM Sans, system-ui, sans-serif" },
    spacing: { touchTarget: "48px" },
  });
});

export default router;
