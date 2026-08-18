/**
 * Sessão do painel operacional — ZELO (ZELO-32).
 *
 * Deliberadamente SEPARADO de lib/auth-client.ts: o token de admin nunca
 * pode se misturar com o de cuidador (nem no armazenamento, nem no envio).
 * sessionStorage (não localStorage) — a sessão de admin não deveria
 * sobreviver o navegador fechar, é uma ferramenta operacional, não a conta
 * de uma família. Sem refresh: o token dura 8h (ver lib/admin-auth.ts no
 * servidor); expirando, a resposta 401 já é o suficiente pra pedir a senha
 * de novo — não precisa da complexidade de refresh token pra um único
 * operador.
 */

const ADMIN_TOKEN_KEY = "zelo_admin_token";

export function getAdminToken(): string | null {
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function setAdminToken(token: string): void {
  sessionStorage.setItem(ADMIN_TOKEN_KEY, token);
}

export function clearAdminToken(): void {
  sessionStorage.removeItem(ADMIN_TOKEN_KEY);
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/** Requisição autenticada como admin. Nunca usa o token de cuidador. */
export async function adminFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const token = getAdminToken();
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (res.status === 401) clearAdminToken();
  return res;
}
