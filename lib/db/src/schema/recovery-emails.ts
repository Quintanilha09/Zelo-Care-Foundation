import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * E-mail de recuperação esperando confirmação — Issue #87.
 *
 * ── O que é um e-mail de recuperação, e o que ele NÃO é ───────────────────
 *
 * É um segundo endereço, cadastrado pela pessoa, que serve para **voltar** à
 * conta quando o e-mail principal se perde. O endereço confirmado mora em
 * `users.recovery_email`; esta tabela guarda só o pendente, até o código
 * chegar de volta.
 *
 * **Ele não é uma segunda chave da mesma porta.** O poder dele é deliberadamente
 * menor que o do e-mail principal:
 *
 * | O e-mail de recuperação PODE | NÃO PODE |
 * |---|---|
 * | receber o código de aparelho novo (#79) | redefinir a senha |
 * | — | trocar o e-mail principal |
 * | — | entrar sozinho |
 *
 * Esse limite é a ideia inteira. Sem ele, cadastrar um endereço reserva
 * **dobra a superfície de ataque com o mesmo poder**: quem comprometer o
 * reserva toma a conta, e o que parecia rede de proteção vira a porta mais
 * fácil. Com o limite, comprometer o reserva não basta — ainda falta a senha.
 *
 * Na prática o limite não é uma regra escrita em lugar nenhum: é o fato de
 * `login`, `password-reset/request` e `account/email/change` procurarem por
 * `users.email`, e nunca por esta coluna. `recuperacao-de-conta.test.ts` prova
 * as três, porque uma consulta trocada por engano no futuro devolveria o poder
 * inteiro sem nenhum sintoma visível.
 *
 * ── Por que o pendente mora aqui, e não em `users` ────────────────────────
 *
 * Mesma razão da Issue #46 (`email_changes`): escrever direto em `users` faria
 * um endereço não confirmado passar por confirmado. E endereço de recuperação
 * não verificado é **pior que nenhum** — dá a sensação de rede de proteção sem
 * entregar rede nenhuma, e a pessoa só descobre no dia em que precisa.
 *
 * SEGURANÇA: o código cru só existe no e-mail; o banco guarda o hash, com o
 * `userId` como sal (ver `lib/codigo-de-verificacao.ts`).
 */
export const recoveryEmailsTable = pgTable(
  "recovery_emails",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** O endereço reserva proposto. Guardado em minúsculas. */
    email: text("email").notNull(),
    codigoHash: text("codigo_hash").notNull(),
    /** Mesma defesa do cadastro: 5 erros e o código morre. */
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** De onde partiu o pedido — vai no aviso ao endereço principal. */
    requestIp: text("request_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pendenteDoUsuario: index("idx_recovery_emails_pendente").on(
      table.userId,
      table.used,
      table.expiresAt,
    ),
  }),
);

export type RecoveryEmail = typeof recoveryEmailsTable.$inferSelect;
export type InsertRecoveryEmail = typeof recoveryEmailsTable.$inferInsert;
