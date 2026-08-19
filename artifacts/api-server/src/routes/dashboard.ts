import { getAuth } from "../lib/auth-types.ts";
/**
 * Dashboard — ZELO.
 * familyId vem do token JWT.
 */
import { Router } from "express";
import { eq, and, count, gte, lte } from "drizzle-orm";
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
