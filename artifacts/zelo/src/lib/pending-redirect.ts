/**
 * Preserva o destino pretendido através da ida/volta REAL de página do
 * OAuth do Google — não é navegação de SPA (o navegador sai pra
 * accounts.google.com e volta), então só sessionStorage sobrevive.
 * Usado pelo fluxo de aceitar convite (ver AcceptInvitePage e AuthContext).
 */
const KEY = "zelo:pending_redirect";

export function setPendingRedirect(path: string): void {
  sessionStorage.setItem(KEY, path);
}

export function consumePendingRedirect(): string | null {
  const path = sessionStorage.getItem(KEY);
  if (path) sessionStorage.removeItem(KEY);
  return path;
}
