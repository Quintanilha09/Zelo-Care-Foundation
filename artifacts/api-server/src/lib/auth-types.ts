/**
 * Tipos de autenticação — ZELO.
 *
 * Não usa module augmentation (incompatível com isolatedModules: true).
 * Em vez disso, usa o helper `getAuth(req)` que retorna o usuário autenticado
 * com tipagem completa. Requer que requireAuth tenha sido aplicado antes.
 */

import type { Request } from "express";

export interface ZeloUser {
  userId: number;
  familyId: number;
  caregiverId: number;
  role: "primary_caregiver" | "caregiver" | "hired_caregiver" | "observer";
  jti: string;
}

/** Acessa o usuário autenticado com tipagem completa. Lança se não autenticado. */
export function getAuth(req: Request): ZeloUser {
  const user = (req as Request & { user?: ZeloUser }).user;
  if (!user) {
    throw new Error("requireAuth middleware não foi aplicado antes de getAuth()");
  }
  return user;
}

/** Versão nullable para endpoints opcionalmente autenticados. */
export function tryGetAuth(req: Request): ZeloUser | undefined {
  return (req as Request & { user?: ZeloUser }).user;
}
