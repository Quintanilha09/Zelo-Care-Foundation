import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Troca do e-mail da conta, esperando confirmação — Issue #46.
 *
 * ── Por que o endereço novo mora AQUI e não em `users` ────────────────────
 *
 * `users.email` é a identidade de login, `notNull().unique()`. Escrever o
 * endereço novo lá antes de confirmar significaria:
 *
 * - a pessoa perde o login imediatamente, mesmo que tenha digitado errado
 * - o endereço novo fica reservado sem prova de que alguém o controla
 * - um erro de digitação vira conta inacessível, sem volta
 *
 * O pendente fica nesta tabela até o código chegar de volta. Só então
 * `users.email` muda, numa transação.
 *
 * ── Por que isto é a rota mais perigosa da conta ──────────────────────────
 *
 * Quem troca o e-mail passa a receber os próprios links de recuperação de
 * senha. Uma sessão esquecida num computador emprestado, ou um XSS de um
 * minuto, viram **sequestro permanente** se a troca valer sem prova.
 *
 * Daí as três exigências, e nenhuma é opcional:
 *
 * 1. **senha atual**, porque sessão aberta não prova quem está ali
 * 2. **código enviado ao endereço NOVO**, porque só quem o controla confirma
 * 3. **aviso ao endereço ANTIGO**, que é o que dá à vítima a chance de reagir
 *
 * A terceira é a que costuma faltar nos produtos que erram isso — e é a única
 * que funciona quando as outras duas já foram vencidas.
 *
 * SEGURANÇA: o código cru só existe no e-mail; o banco guarda o hash, com o
 * `userId` como sal (ver `lib/codigo-de-verificacao.ts`).
 */
export const emailChangesTable = pgTable(
  "email_changes",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** Para onde a conta vai, se confirmar. Guardado em minúsculas. */
    novoEmail: text("novo_email").notNull(),
    codigoHash: text("codigo_hash").notNull(),
    /** Mesma defesa do cadastro: 5 erros e o código morre. */
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** De onde partiu o pedido — vai no aviso ao endereço antigo. */
    requestIp: text("request_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    pendenteDoUsuario: index("idx_email_changes_pendente").on(
      table.userId,
      table.used,
      table.expiresAt,
    ),
  }),
);

export type EmailChange = typeof emailChangesTable.$inferSelect;
export type InsertEmailChange = typeof emailChangesTable.$inferInsert;
