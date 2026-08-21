/**
 * Middleware de acesso do PACIENTE — ZELO-58.
 *
 * Deliberadamente separado de requireAuth (cuidador). São dois mundos que
 * nunca se cruzam:
 *   - Cuidador: JWT assinado, carrega familyId/caregiverId/role, governa
 *     requireCapability e a matriz de papéis inteira.
 *   - Paciente: token opaco de dispositivo, escopo de DUAS rotas, sem papel
 *     nenhum na matriz.
 *
 * Um token de cuidador não abre rota de paciente e vice-versa — não por
 * checagem extra, mas por construção: cada middleware lê um header
 * diferente e valida contra um mecanismo diferente.
 *
 * O token viaja em `X-Patient-Access` e não em `Authorization: Bearer`,
 * justamente pra ser impossível confundir os dois na leitura do código ou
 * num log de requisição.
 */
import type { Request, Response, NextFunction } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientAccessTokensTable } from "@workspace/db";
import { hashToken } from "../lib/tokens";
import { Clock } from "../lib/clock";

export interface PatientAccess {
  tokenId: number;
  patientId: number;
  familyId: number;
  /** Cuidador que gerou o acesso — é ele o responsável nos registros de
   *  dose feitos por este aparelho (dose_records.caregiverId). */
  createdByCaregiverId: number;
}

type PatientAccessReq = Request & { patientAccess?: PatientAccess };

export function getPatientAccess(req: Request): PatientAccess {
  const access = (req as PatientAccessReq).patientAccess;
  if (!access) throw new Error("getPatientAccess chamado fora de requirePatientAccess");
  return access;
}

export async function requirePatientAccess(req: Request, res: Response, next: NextFunction): Promise<void> {
  const raw = req.headers["x-patient-access"];
  const token = Array.isArray(raw) ? raw[0] : raw;
  if (!token) {
    res.status(401).json({ error: "Acesso não configurado neste aparelho.", code: "PATIENT_ACCESS_MISSING" });
    return;
  }

  const [row] = await db
    .select({
      id: patientAccessTokensTable.id,
      patientId: patientAccessTokensTable.patientId,
      familyId: patientAccessTokensTable.familyId,
      status: patientAccessTokensTable.status,
      createdByCaregiverId: patientAccessTokensTable.createdByCaregiverId,
    })
    .from(patientAccessTokensTable)
    .where(eq(patientAccessTokensTable.tokenHash, hashToken(token)))
    .limit(1);

  // Só `active` passa: `pending` é um link ainda não ativado (não serve como
  // credencial) e `revoked` é o cuidador tendo derrubado o aparelho — a
  // revogação vale já na requisição seguinte, sem esperar expirar nada.
  if (!row || row.status !== "active") {
    res.status(401).json({
      error: "Este acesso não vale mais. Peça um novo para quem cuida de você.",
      code: "PATIENT_ACCESS_INVALID",
    });
    return;
  }

  // Só pra o cuidador ver "usado pela última vez" — nunca bloqueia nada, e
  // uma falha aqui não pode impedir o paciente de registrar o remédio.
  void db
    .update(patientAccessTokensTable)
    .set({ lastUsedAt: Clock.now() })
    .where(eq(patientAccessTokensTable.id, row.id))
    .catch(() => {});

  (req as PatientAccessReq).patientAccess = {
    tokenId: row.id,
    patientId: row.patientId,
    familyId: row.familyId,
    createdByCaregiverId: row.createdByCaregiverId,
  };
  next();
}
