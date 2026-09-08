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

/**
 * O token que diz que ESTE aparelho já foi verificado — Issue #79.
 *
 * ── Por que ele sobrevive ao logout ──────────────────────────────────────
 *
 * `clearTokens()` de propósito NÃO apaga esta chave. Sair da conta é dizer
 * "terminei por agora", não "este computador não é mais meu" — e apagar aqui
 * faria toda entrada seguinte, no mesmo aparelho de sempre, pedir um código
 * por e-mail. Num público que sai da conta por hábito, isso viraria um código
 * por dia, e o segundo fator passaria a ser aquilo que atrapalha.
 *
 * Quem quer o outro significado tem o botão "desligar todos os aparelhos", em
 * Ajustes, que revoga no servidor e chama `esquecerTokenDeAparelho()`.
 *
 * ── Por que localStorage, e por que isso é aceitável ─────────────────────
 *
 * O token de acesso mora em memória justamente para não ficar ao alcance de
 * XSS. Este fica no disco porque precisa sobreviver a fechar o navegador —
 * é a sua função inteira. O que limita o estrago é ele **não abrir nada**:
 * sem a senha, quem o roubar não entra. Ele só dispensa o código.
 */
const DEVICE_TOKEN_KEY = "zelo_device_token";

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
  // DEVICE_TOKEN_KEY fica. Ver o comentário na declaração dela.
}

/** O token deste aparelho, se ele já foi verificado alguma vez. */
export function lerTokenDeAparelho(): string | null {
  return localStorage.getItem(DEVICE_TOKEN_KEY);
}

/** Guarda o token que o servidor acabou de emitir para este aparelho. */
export function guardarTokenDeAparelho(raw: string): void {
  localStorage.setItem(DEVICE_TOKEN_KEY, raw);
}

/**
 * Esquece este aparelho. Só o "desligar todos" chama isto: guardar um token
 * que o servidor já revogou faria a tela prometer uma entrada sem código que
 * o servidor não vai honrar.
 */
export function esquecerTokenDeAparelho(): void {
  localStorage.removeItem(DEVICE_TOKEN_KEY);
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
