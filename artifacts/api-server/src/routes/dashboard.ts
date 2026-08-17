import { getAuth } from "../lib/auth-types.ts";
/**
 * Dashboard — ZELO.
 * familyId vem do token JWT.
 */
import { Router } from "express";
import { eq, and, count, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, caregiversTable, scheduledDosesTable, appointmentsTable, stockEntriesTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { Clock } from "../lib/clock";
import { localDayBoundsUtc } from "@workspace/scheduling";

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

  const stockItems = await db
    .select({ qty: stockEntriesTable.quantityRemaining, threshold: stockEntriesTable.lowStockThreshold })
    .from(stockEntriesTable);
  const lowStock = stockItems.filter((s) => s.threshold != null && s.qty <= (s.threshold ?? 0)).length;

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
    .select({ id: patientsTable.id, timezone: patientsTable.timezone, familyId: patientsTable.familyId })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const todayInPatientTz = Clock.todayInTimezone(patient.timezone);
  // ZELO-19: nunca `new Date(`${data}T00:00:00`)` — sem offset, isso é
  // interpretado no fuso do PROCESSO, não no do paciente. localDayBoundsUtc
  // delimita o dia civil corretamente, independente do TZ do servidor.
  const { start: todayStart, end: todayEnd } = localDayBoundsUtc(todayInPatientTz, patient.timezone);

  const doses = await db
    .select()
    .from(scheduledDosesTable)
    .where(and(
      eq(scheduledDosesTable.patientId, patientId),
      gte(scheduledDosesTable.scheduledAt, todayStart),
      lte(scheduledDosesTable.scheduledAt, todayEnd)
    ))
    .orderBy(scheduledDosesTable.scheduledAt);

  res.json({
    date: todayInPatientTz,
    patientTimezone: patient.timezone,
    totalDoses: doses.length,
    takenDoses: doses.filter((d) => d.status === "taken").length,
    pendingDoses: doses.filter((d) => d.status === "pending").length,
    lateDoses: doses.filter((d) => d.status === "late").length,
    doses,
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
