/**
 * Serviço de e-mail — ZELO.
 *
 * Em desenvolvimento: imprime o link no console (não envia e-mail real).
 * Em produção: substituir pelo provedor real (Resend, SendGrid, etc.).
 *
 * Nunca logar o token cru — apenas o link completo, que já inclui o token.
 * O link aparece nos logs de desenvolvimento mas não em produção.
 *
 * CAMPOS NUNCA LOGADOS: e-mail do destinatário, nome do paciente.
 */

import { logger } from "./logger";

import { IS_PRODUCTION as isProduction } from "./environment.ts";
const BASE_URL = process.env.APP_URL ?? "http://localhost:5173";

/**
 * Existe provedor de e-mail configurado?
 *
 * Mesmo padrão do `isConfigured()` do Google (ver routes/google-auth.ts): uma
 * capacidade que pode faltar, declarada em vez de suposta.
 *
 * **Por que isto existe.** A auditoria §10 (23/08/2026) encontrou que nenhum
 * e-mail é enviado em produção — as funções abaixo só registram um aviso. Como
 * o login exige `emailVerified` e a auto-verificação só roda em
 * desenvolvimento, quem se cadastrava por e-mail e senha ficava preso para
 * sempre, sem nenhum sinal para ninguém.
 *
 * Com esta função, o servidor para de criar contas que jamais poderão ser
 * verificadas: ele diz, antes de criar, que o caminho é o Google.
 *
 * O provedor escolhido é o Resend (ver planning/decisoes/PLATFORM_DECISIONS.md
 * §11). Enquanto `RESEND_API_KEY` não existir, não há provedor.
 */
export function hasEmailProvider(): boolean {
  const chave = process.env.RESEND_API_KEY;
  return typeof chave === "string" && chave.length > 0;
}

function devLog(label: string, link: string): void {
  // O link CARREGA o token (verificação, reset de senha, convite) — quem lê
  // o log assume a conta. Por isso só é impresso quando o ambiente está
  // EXPLICITAMENTE marcado como desenvolvimento: antes, um ambiente sem
  // NODE_ENV definido (o deploy do Replit) escrevia estes links no log de
  // produção. Ver lib/environment.ts.
  if (!isProduction) {
    logger.info({ link }, `[DEV EMAIL] ${label}`);
  }
}

/** Envia e-mail de verificação de conta. */
export async function sendVerificationEmail(
  _email: string,
  token: string
): Promise<void> {
  const link = `${BASE_URL}/verificar-email?token=${token}`;
  devLog("Verificação de e-mail", link);

  if (isProduction) {
    // TODO: integrar Resend ou SendGrid
    // await resend.emails.send({ to: email, subject: "Verifique seu e-mail", html: ... });
    logger.warn("sendVerificationEmail: provedor de e-mail não configurado em produção");
  }
}

/** Envia e-mail de recuperação de senha. */
export async function sendPasswordResetEmail(
  _email: string,
  token: string
): Promise<void> {
  const link = `${BASE_URL}/redefinir-senha?token=${token}`;
  devLog("Recuperação de senha", link);

  if (isProduction) {
    logger.warn("sendPasswordResetEmail: provedor de e-mail não configurado em produção");
  }
}

/** Notifica cuidadores sobre solicitação de exclusão de dados. */
export async function sendDeletionNotification(
  _emails: string[],
  scheduledAt: Date
): Promise<void> {
  const dateStr = scheduledAt.toLocaleDateString("pt-BR");
  devLog(`Notificação de exclusão agendada para ${dateStr}`, `${BASE_URL}/conta/exclusao`);

  if (isProduction) {
    logger.warn("sendDeletionNotification: provedor de e-mail não configurado em produção");
  }
}

/** Envia e-mail de convite para cuidador. */
export async function sendCaregiverInviteEmail(
  _email: string,
  token: string
): Promise<void> {
  const link = `${BASE_URL}/convite?token=${token}`;
  devLog("Convite de cuidador", link);

  if (isProduction) {
    logger.warn("sendCaregiverInviteEmail: provedor de e-mail não configurado em produção");
  }
}
