import { Router } from "express";
import healthRouter from "./health";
import adminRouter from "./admin";
import authRouter from "./auth";
import googleAuthRouter from "./google-auth";
import consentRouter from "./consent";
import invitesRouter from "./invites";
import accountRouter from "./account";
import activityRouter from "./activity";
import exportRouter from "./export";
import patientsRouter from "./patients";
import caregiversRouter from "./caregivers";
import medicationsRouter from "./medications";
import medicationPhotosRouter from "./medication-photos";
import treatmentsRouter from "./treatments";
import doseRecordsRouter from "./dose-records";
import notificationsRouter from "./notifications";
import auditRouter from "./audit";
import dashboardRouter from "./dashboard";
import adherenceCalendarRouter from "./adherence-calendar";
import adherenceReportRouter from "./adherence-report";
import stockRouter from "./stock";
import appointmentsRouter from "./appointments";
import healthMeasurementsRouter from "./health-measurements";
import activitiesRouter from "./activities";
import realtimeRouter from "./realtime";
import pushRouter from "./push";
import notificationPreferencesRouter from "./notification-preferences";
import patientAccessRouter from "./patient-access";

const router = Router();

// Sem autenticação
router.use(healthRouter);
// ZELO-32: mistura rota pública (/status) com rotas de admin (auth própria,
// requireAdminAuth — nunca requireAuth) — mesmo padrão de consent.ts.
router.use(adminRouter);
router.use(authRouter);
router.use(googleAuthRouter);
router.use(consentRouter);

// Com autenticação (requireAuth em cada rota)
router.use(invitesRouter);
router.use(accountRouter);
router.use(activityRouter);
router.use(exportRouter);
router.use(patientsRouter);
router.use(caregiversRouter);
router.use(medicationsRouter);
router.use(medicationPhotosRouter);
router.use(treatmentsRouter);
router.use(doseRecordsRouter);
router.use(notificationsRouter);
router.use(auditRouter);
router.use(dashboardRouter);
router.use(adherenceCalendarRouter);
// ZELO-35: mistura POST protegido (requireAuth) com GET /reports/:token
// público (o link em si é a credencial) — mesmo padrão de admin.ts.
router.use(adherenceReportRouter);
router.use(stockRouter);
router.use(appointmentsRouter);
router.use(healthMeasurementsRouter);
router.use(activitiesRouter);
router.use(realtimeRouter);
router.use(pushRouter);
router.use(notificationPreferencesRouter);
// ZELO-58: mistura três autenticações de propósito — gestão pelo cuidador
// principal (requirePrimaryCaregiver), ativação pública (o token do link é
// a credencial, como em adherence-report.ts) e as duas rotas do paciente
// (requirePatientAccess, mecanismo próprio que nunca vira sessão de cuidador).
router.use(patientAccessRouter);

// Rotas de controle do relógio — APENAS fora de produção
if (process.env.NODE_ENV !== "production") {
  const { default: devClockRouter } = await import("./dev-clock.js");
  router.use(devClockRouter);
}

export default router;
