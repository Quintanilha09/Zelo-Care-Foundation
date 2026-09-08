import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Códigos de recuperação — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ENQUANTO O SEGUNDO FATOR ERA OPCIONAL, ISTO ERA UM LUXO. O FUNDADOR DECIDIU
 * QUE É OBRIGATÓRIO — E NO MESMO ATO ESTA TABELA VIROU A ÚNICA COISA ENTRE UMA
 * CAIXA DE E-MAIL PERDIDA E UMA CONTA PERDIDA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Num app de código-fonte, perder a conta é aborrecimento. Aqui é o histórico
 * de medicação de um idoso ficando inacessível — e nem a exportação da LGPD
 * salva, porque exportar também exige entrar.
 *
 * Por isso a ordem é inegociável, e está no fluxo de ativação: **os códigos
 * são gerados, mostrados e confirmados ANTES de o segundo fator passar a valer
 * para a conta**. Ligar a tranca antes de entregar a chave reserva seria o
 * único jeito de esta função piorar o produto.
 *
 * ── Uma linha por código, e não um array na conta ─────────────────────────
 *
 * Cada código queima sozinho ao ser usado, e a pessoa precisa saber quantos
 * ainda tem. Um array em `users` daria o mesmo resultado com escrita
 * concorrente perigosa: dois usos ao mesmo tempo, e um deles reescreve o
 * outro — devolvendo à vida um código já gasto.
 *
 * ── `used_at` em vez de apagar ────────────────────────────────────────────
 *
 * "Este código foi usado no dia tal" é o que permite responder, depois, se
 * alguém entrou por aqui. Apagar a linha faria o código gasto ser
 * indistinguível de um que nunca existiu.
 *
 * ── Gerar de novo apaga os antigos ────────────────────────────────────────
 *
 * Quem pede um jogo novo está dizendo que o antigo se perdeu — ou vazou.
 * Manter os dois válidos seria manter viva exatamente a lista que a pessoa
 * quis anular. A rota de geração apaga o conjunto inteiro antes de inserir.
 *
 * SEGURANÇA: só o hash, com o `userId` como sal — mesma regra dos códigos de
 * 6 dígitos, e pela mesma razão (separar usuários, não ofuscar o segredo).
 */
export const recoveryCodesTable = pgTable(
  "recovery_codes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** SHA-256 de `userId:CODIGO`, com o código já normalizado. */
    codeHash: text("code_hash").notNull(),
    /** Nulo enquanto vale. Preenchido no instante em que entra numa conta. */
    usedAt: timestamp("used_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // "Este código é desta pessoa, e ainda vale?" — a única pergunta feita.
    doUsuario: index("idx_recovery_codes_usuario").on(table.userId, table.codeHash),
  }),
);

export type RecoveryCode = typeof recoveryCodesTable.$inferSelect;
export type InsertRecoveryCode = typeof recoveryCodesTable.$inferInsert;
