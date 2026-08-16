/**
 * Matriz de papéis e capacidades — ZELO.
 *
 * Fonte única da verdade: mudar quem pode fazer o quê se faz só aqui.
 * Nenhum outro arquivo deve checar `role === "primary_caregiver"` diretamente
 * fora deste módulo e do middleware requireAuth.
 *
 * GAP CONHECIDO E DOCUMENTADO: o papel hoje é por FAMÍLIA (um valor por
 * cuidador, herdado da tabela `caregivers`), não por PACIENTE. A spec original
 * pede granularidade por paciente ("cuidador do pai, observador da mãe, mesma
 * conta"). Isso exigiria uma tabela de junção caregiver×patient e mudar o
 * modelo de autorização do JWT (que hoje carrega um `role` único por sessão)
 * para resolver o papel por requisição. É uma mudança de arquitetura maior,
 * registrada como pendência em planning/STATE.md — não implementada agora
 * para não bloquear o resto da Fase 03.
 */

import type { Response, NextFunction, Request } from "express";
import { eq, and, ne } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiversTable } from "@workspace/db";
import { getAuth } from "./auth-types.ts";

export type CaregiverRole =
  | "primary_caregiver"
  | "caregiver"
  | "hired_caregiver"
  | "observer";

export type Capability = "view" | "register_dose" | "edit_treatment" | "invite" | "billing";

const MATRIX: Record<CaregiverRole, Record<Capability, boolean>> = {
  primary_caregiver: { view: true, register_dose: true, edit_treatment: true, invite: true, billing: true },
  caregiver: { view: true, register_dose: true, edit_treatment: true, invite: false, billing: false },
  hired_caregiver: { view: true, register_dose: true, edit_treatment: false, invite: false, billing: false },
  observer: { view: true, register_dose: false, edit_treatment: false, invite: false, billing: false },
};

export function hasCapability(role: CaregiverRole, capability: Capability): boolean {
  return MATRIX[role][capability];
}

/** Middleware: exige que o cuidador autenticado tenha a capacidade dada. */
export function requireCapability(capability: Capability) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = getAuth(req);
    if (!hasCapability(auth.role, capability)) {
      res.status(403).json({
        error: "Seu papel não permite esta ação",
        code: "CAPABILITY_DENIED",
        capability,
      });
      return;
    }
    next();
  };
}

/** Conta quantos cuidadores principais restam numa família — para proteger
 *  contra remover ou rebaixar o último. */
export async function countPrimaryCaregivers(
  familyId: number,
  excludingCaregiverId?: number
): Promise<number> {
  const rows = await db
    .select({ id: caregiversTable.id })
    .from(caregiversTable)
    .where(
      and(
        eq(caregiversTable.familyId, familyId),
        eq(caregiversTable.role, "primary_caregiver"),
        excludingCaregiverId !== undefined
          ? ne(caregiversTable.id, excludingCaregiverId)
          : undefined
      )
    );
  return rows.length;
}
