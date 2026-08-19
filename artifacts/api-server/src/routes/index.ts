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
import stockRouter from "./stock";
import realtimeRouter from "./realtime";
import pushRouter from "./push";
import notificationPreferencesRouter from "./notification-preferences";

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
router.use(stockRouter);
router.use(realtimeRouter);
router.use(pushRouter);
router.use(notificationPreferencesRouter);

// Rotas de controle do relógio — APENAS fora de produção
if (process.env.NODE_ENV !== "production") {
  const { default: devClockRouter } = await import("./dev-clock.js");
  router.use(devClockRouter);
}

export default router;
