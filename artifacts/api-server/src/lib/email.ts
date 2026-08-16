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

const isProduction = process.env.NODE_ENV === "production";
const BASE_URL = process.env.APP_URL ?? "http://localhost:5173";

function devLog(label: string, link: string): void {
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
