/**
 * Middleware de autenticação — ZELO.
 *
 * Valida o JWT do header Authorization: Bearer <token>.
 * Em caso de sucesso, popula (req as AuthedReq).user com:
 *   { userId, familyId, caregiverId, role, jti }
 *
 * O familyId vem do token — NUNCA de req.params, req.body ou req.query.
 */

import type { Request, Response, NextFunction } from "express";
import { verifyAccessToken } from "../lib/tokens";
import type { ZeloUser } from "../lib/auth-types";

// Tipo interno para atribuir user sem augmentation global
type AuthedReq = Request & { user?: ZeloUser };

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Autenticação necessária" });
    return;
  }

  const token = header.slice(7);
  const payload = verifyAccessToken(token);
  if (!payload) {
    res.status(401).json({ error: "Token inválido ou expirado" });
    return;
  }

  (req as AuthedReq).user = {
    userId: payload.userId,
    familyId: payload.familyId,
    caregiverId: payload.caregiverId,
    role: payload.role,
    jti: payload.jti,
  };
  next();
}

/** Variante que exige papel de primary_caregiver. */
export function requirePrimaryCaregiver(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  requireAuth(req, res, () => {
    const auth = (req as AuthedReq).user;
    if (auth?.role !== "primary_caregiver") {
      res.status(403).json({ error: "Apenas o cuidador principal pode fazer isso" });
      return;
    }
    next();
  });
}
