import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Códigos de verificação de e-mail — enviados ao cadastrar.
 *
 * ── Era link, virou código de 6 dígitos (Issue #77) ───────────────────────
 *
 * Até 02/09/2026 isto guardava o SHA-256 de um token de 64 caracteres hex, e o
 * token viajava dentro de um link. Passou a guardar o hash de um **código de 6
 * dígitos**, digitado na tela — pedido do fundador, "assim como o GitHub".
 *
 * ── Por que três coisas mudaram junto ─────────────────────────────────────
 *
 * O código tem **um milhão** de combinações; o token tinha 2^256. Trocar um
 * pelo outro sem mudar mais nada seria um rebaixamento de segurança disfarçado
 * de melhoria de usabilidade. O que segura o código não é o tamanho dele:
 *
 * 1. **`attempts`** — 5 erros e o código morre. Sem esta coluna, um milhão de
 *    tentativas é questão de minutos. É a defesa principal, não um detalhe.
 *
 * 2. **`token_hash` deixou de ser `UNIQUE`.** Com 6 dígitos, dois usuários
 *    sorteando o mesmo código é rotina, não coincidência — e a constraint
 *    global faria o cadastro do segundo explodir com violação de unicidade.
 *    O hash leva o `userId` como sal (ver `lib/codigo-de-verificacao.ts`), o
 *    que já separa um usuário do outro; declarar unicidade global era, além de
 *    quebrado, a afirmação errada sobre o dado.
 *
 * 3. **Índice por `(user_id, used, expires_at)`** — a consulta quente passou a
 *    ser "o código ativo deste usuário", e não mais "quem tem este hash".
 *
 * ── Só um código vivo por vez ─────────────────────────────────────────────
 *
 * O comentário antigo dizia o contrário: *"um userId pode ter múltiplos tokens
 * ativos (reenvios) — a verificação de qualquer um deles é válida"*. Para
 * código isso é perigoso: cada código vivo é mais 5 tentativas oferecidas ao
 * atacante. Emitir um novo **invalida os anteriores**.
 *
 * SEGURANÇA: o código cru só existe no e-mail. O banco guarda o hash.
 */
export const emailVerificationsTable = pgTable(
  "email_verifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    /** Erros de digitação neste código. Em `MAX_TENTATIVAS`, ele morre. */
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // "Qual o código ativo deste usuário?" — a única pergunta que a verificação faz.
    codigoAtivo: index("idx_email_verifications_ativo").on(
      table.userId,
      table.used,
      table.expiresAt,
    ),
  }),
);

export type EmailVerification = typeof emailVerificationsTable.$inferSelect;
export type InsertEmailVerification = typeof emailVerificationsTable.$inferInsert;
