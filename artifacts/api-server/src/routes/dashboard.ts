import { Router, type IRouter } from "express";
import { eq, and, count, gte, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  patientsTable,
  caregiversTable,
  scheduledDosesTable,
  appointmentsTable,
  stockEntriesTable,
} from "@workspace/db";
import { verifyPatientBelongsToFamily } from "../lib/family-access";
import { Clock } from "../lib/clock";

const router: IRouter = Router();

// Resumo do painel da família
router.get(
  "/families/:familyId/dashboard",
  async (req, res): Promise<void> => {
    const familyIdRaw = Array.isArray(req.params.familyId)
      ? req.params.familyId[0]
      : req.params.familyId;
    const familyId = parseInt(familyIdRaw, 10);
    if (isNaN(familyId)) {
      res.status(400).json({ error: "familyId inválido" });
      return;
    }

    // Conta pacientes e cuidadores da família
    const [[patientRow], [caregiverRow]] = await Promise.all([
      db
        .select({ count: count() })
        .from(patientsTable)
        .where(eq(patientsTable.familyId, familyId)),
      db
        .select({ count: count() })
        .from(caregiversTable)
        .where(eq(caregiversTable.familyId, familyId)),
    ]);

    // Doses de hoje (baseado no relógio controlável)
    const todayStart = new Date(Clock.now());
    todayStart.setUTCHours(0, 0, 0, 0);
    const todayEnd = new Date(Clock.now());
    todayEnd.setUTCHours(23, 59, 59, 999);

    // Busca pacientes da família para filtrar doses
    const familyPatients = await db
      .select({ id: patientsTable.id })
      .from(patientsTable)
      .where(eq(patientsTable.familyId, familyId));

    const patientIds = familyPatients.map((p) => p.id);

    let pendingDoses = 0;
    let takenDoses = 0;
    let lateDoses = 0;

    if (patientIds.length > 0) {
      const doses = await db
        .select({ status: scheduledDosesTable.status })
        .from(scheduledDosesTable)
        .where(
          and(
            gte(scheduledDosesTable.scheduledAt, todayStart),
            lte(scheduledDosesTable.scheduledAt, todayEnd)
          )
        );

      for (const d of doses) {
        if (d.status === "pending") pendingDoses++;
        else if (d.status === "taken") takenDoses++;
        else if (d.status === "late") lateDoses++;
      }
    }

    // Consultas futuras
    const [apptRow] = await db
      .select({ count: count() })
      .from(appointmentsTable)
      .where(
        and(
          gte(appointmentsTable.scheduledAt, Clock.now()),
          eq(appointmentsTable.status, "scheduled")
        )
      );

    // Estoque baixo
    const stockItems = await db
      .select({
        qty: stockEntriesTable.quantityRemaining,
        threshold: stockEntriesTable.lowStockThreshold,
      })
      .from(stockEntriesTable);

    const lowStock = stockItems.filter(
      (s) =>
        s.threshold !== null &&
        s.threshold !== undefined &&
        s.qty <= (s.threshold ?? 0)
    ).length;

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
  }
);

// Doses de hoje do paciente (no fuso do paciente)
router.get(
  "/families/:familyId/patients/:patientId/today-doses",
  async (req, res): Promise<void> => {
    const familyIdRaw = Array.isArray(req.params.familyId)
      ? req.params.familyId[0]
      : req.params.familyId;
    const patientIdRaw = Array.isArray(req.params.patientId)
      ? req.params.patientId[0]
      : req.params.patientId;
    const familyId = parseInt(familyIdRaw, 10);
    const patientId = parseInt(patientIdRaw, 10);

    if (isNaN(familyId) || isNaN(patientId)) {
      res.status(400).json({ error: "IDs inválidos" });
      return;
    }

    const belongs = await verifyPatientBelongsToFamily(patientId, familyId);
    if (!belongs) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    const [patient] = await db
      .select({ timezone: patientsTable.timezone })
      .from(patientsTable)
      .where(eq(patientsTable.id, patientId))
      .limit(1);

    if (!patient) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    // Data de hoje no fuso do paciente
    const todayInPatientTz = Clock.todayInTimezone(patient.timezone);
    const todayStart = new Date(`${todayInPatientTz}T00:00:00`);
    const todayEnd = new Date(`${todayInPatientTz}T23:59:59`);

    const doses = await db
      .select()
      .from(scheduledDosesTable)
      .where(
        and(
          eq(scheduledDosesTable.patientId, patientId),
          gte(scheduledDosesTable.scheduledAt, todayStart),
          lte(scheduledDosesTable.scheduledAt, todayEnd)
        )
      )
      .orderBy(scheduledDosesTable.scheduledAt);

    const total = doses.length;
    const taken = doses.filter((d) => d.status === "taken").length;
    const pending = doses.filter((d) => d.status === "pending").length;
    const late = doses.filter((d) => d.status === "late").length;

    res.json({
      date: todayInPatientTz,
      patientTimezone: patient.timezone,
      totalDoses: total,
      takenDoses: taken,
      pendingDoses: pending,
      lateDoses: late,
      doses,
    });
  }
);

// Estatísticas de adesão
router.get(
  "/families/:familyId/patients/:patientId/adherence-stats",
  async (req, res): Promise<void> => {
    const familyIdRaw = Array.isArray(req.params.familyId)
      ? req.params.familyId[0]
      : req.params.familyId;
    const patientIdRaw = Array.isArray(req.params.patientId)
      ? req.params.patientId[0]
      : req.params.patientId;
    const familyId = parseInt(familyIdRaw, 10);
    const patientId = parseInt(patientIdRaw, 10);
    const days = parseInt(String(req.query.days ?? "30"), 10) || 30;

    if (isNaN(familyId) || isNaN(patientId)) {
      res.status(400).json({ error: "IDs inválidos" });
      return;
    }

    const belongs = await verifyPatientBelongsToFamily(patientId, familyId);
    if (!belongs) {
      res.status(404).json({ error: "Paciente não encontrado" });
      return;
    }

    const from = new Date(Clock.now());
    from.setDate(from.getDate() - days);

    const doses = await db
      .select({ status: scheduledDosesTable.status })
      .from(scheduledDosesTable)
      .where(
        and(
          eq(scheduledDosesTable.patientId, patientId),
          gte(scheduledDosesTable.scheduledAt, from)
        )
      );

    const total = doses.length;
    const taken = doses.filter((d) => d.status === "taken").length;
    const skipped = doses.filter((d) => d.status === "skipped").length;
    const late = doses.filter((d) => d.status === "late").length;

    res.json({
      patientId,
      periodDays: days,
      totalScheduled: total,
      totalTaken: taken,
      totalSkipped: skipped,
      totalLate: late,
      adherenceRate: total > 0 ? taken / total : 0,
    });
  }
);

// Tokens do sistema de design
router.get("/design-tokens", async (_req, res): Promise<void> => {
  res.json({
    colors: {
      zeloCalmGreen: "#6B9E78",
      zeloAmber: "#D4864A",
      zeloBackground: "#F8F7F5",
      zeloSurface: "#FFFFFF",
      zeloText: "#2D2D2B",
      zeloTextMuted: "#6B6B6B",
    },
    typography: {
      baseSize: "18px",
      bodySize: "17px",
      headingFont: "DM Sans, system-ui, sans-serif",
      bodyFont: "DM Sans, system-ui, sans-serif",
    },
    spacing: {
      touchTarget: "48px",
      sectionGap: "32px",
    },
  });
});

export default router;
