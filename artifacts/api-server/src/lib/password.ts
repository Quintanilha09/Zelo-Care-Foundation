/**
 * Hashing de senha com Argon2id — ZELO.
 *
 * Argon2id é o algoritmo recomendado pelo OWASP para armazenamento de senha
 * (resistente a GPU e side-channel attacks).
 *
 * Parâmetros seguros para produção (2024):
 *   memoryCost: 65536 KiB (64 MB) — custo de memória alto
 *   timeCost: 3 iterações
 *   parallelism: 1
 *   type: argon2id (híbrido, resistente a side-channel e GPU)
 */

import argon2 from "argon2";

const OPTIONS = {
  type: argon2.argon2id as number,
  memoryCost: 65536,   // 64 MiB
  timeCost: 3,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2.hash(password, OPTIONS as Parameters<typeof argon2.hash>[1]);
}

export async function verifyPassword(hash: string, password: string): Promise<boolean> {
  try {
    return await argon2.verify(hash, password);
  } catch {
    return false;
  }
}

/** Valida a complexidade da senha antes de fazer hash. */
export function validatePasswordStrength(password: string): { ok: boolean; error?: string } {
  if (password.length < 8) {
    return { ok: false, error: "A senha deve ter pelo menos 8 caracteres" };
  }
  if (password.length > 128) {
    return { ok: false, error: "A senha deve ter no máximo 128 caracteres" };
  }
  return { ok: true };
}
