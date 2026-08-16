import { Router, type IRouter } from "express";
import healthRouter from "./health";
import familiesRouter from "./families";
import patientsRouter from "./patients";
import caregiversRouter from "./caregivers";
import medicationsRouter from "./medications";
import doseRecordsRouter from "./dose-records";
import notificationsRouter from "./notifications";
import auditRouter from "./audit";
import dashboardRouter from "./dashboard";

const router: IRouter = Router();

router.use(healthRouter);
router.use(familiesRouter);
router.use(patientsRouter);
router.use(caregiversRouter);
router.use(medicationsRouter);
router.use(doseRecordsRouter);
router.use(notificationsRouter);
router.use(auditRouter);
router.use(dashboardRouter);

export default router;
