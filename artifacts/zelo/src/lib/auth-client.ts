/**
 * Gerenciamento de sessão no cliente — ZELO.
 *
 * SEGURANÇA:
 * - Access token: variável em memória (não localStorage) — protege de XSS
 * - Refresh token: localStorage — necessário para sobreviver a reload de página
 * - O access token nunca toca o disco/storage
 *
 * AUTO-REFRESH:
 * - Antes de cada requisição, verifica se o access token expira em < 60s
 * - Se sim, chama refresh e obtém novo par de tokens
 */

const REFRESH_TOKEN_KEY = "zelo_refresh_token";
const USER_ID_KEY = "zelo_user_id";

let _accessToken: string | null = null;
let _accessTokenExp: number = 0; // Unix seconds

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  userId?: number;
}

export function setTokens(tokens: AuthTokens): void {
  _accessToken = tokens.accessToken;
  _accessTokenExp = Math.floor(Date.now() / 1000) + tokens.expiresIn;
  localStorage.setItem(REFRESH_TOKEN_KEY, tokens.refreshToken);
  if (tokens.userId) localStorage.setItem(USER_ID_KEY, String(tokens.userId));
}

export function clearTokens(): void {
  _accessToken = null;
  _accessTokenExp = 0;
  localStorage.removeItem(REFRESH_TOKEN_KEY);
  localStorage.removeItem(USER_ID_KEY);
}

export function getStoredRefreshToken(): string | null {
  return localStorage.getItem(REFRESH_TOKEN_KEY);
}

export function isAccessTokenValid(): boolean {
  return !!_accessToken && Date.now() / 1000 < _accessTokenExp - 60;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Caminho da API pronto para ir num atributo do HTML.
 *
 * `authFetch` já prefixa a base sozinho, mas `<img src>` não passa por ele —
 * e não passaria mesmo se quisesse, porque tag de imagem não manda header
 * Authorization. É o caso do link assinado de mídia (QUI-5): a credencial
 * viaja na própria URL, e a URL precisa da base na frente.
 */
export function apiUrl(path: string): string {
  return `${BASE}${path}`;
}

/** Tenta renovar o access token usando o refresh token em localStorage. */
export async function refreshSession(): Promise<boolean> {
  const refreshToken = getStoredRefreshToken();
  if (!refreshToken) return false;

  try {
    const res = await fetch(`${BASE}/api/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken }),
    });
    if (!res.ok) {
      clearTokens();
      return false;
    }
    const data = (await res.json()) as AuthTokens;
    setTokens(data);
    return true;
  } catch {
    return false;
  }
}

/**
 * Faz uma requisição autenticada, renovando o token se necessário.
 * Use em vez de fetch() direto para rotas autenticadas.
 */
export async function authFetch(
  path: string,
  init: RequestInit = {}
): Promise<Response> {
  if (!isAccessTokenValid()) {
    const ok = await refreshSession();
    if (!ok) {
      // Dispara evento para o AuthContext redirecionar para login
      window.dispatchEvent(new CustomEvent("zelo:session-expired"));
      throw new Error("Sessão expirada. Faça login novamente.");
    }
  }

  // FormData (upload de arquivo) precisa que o navegador defina o
  // Content-Type sozinho, com o boundary certo — nunca fixar "application/json"
  // nesse caso, ou o multipart quebra.
  const isFormData = init.body instanceof FormData;

  return fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(isFormData ? {} : { "Content-Type": "application/json" }),
      Authorization: `Bearer ${_accessToken}`,
      ...(init.headers ?? {}),
    },
  });
}
