import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

// Code de uso único emitido no redirect do callback OAuth (Google) — troca
// segura de tokens pós-redirect sem expor accessToken/refreshToken numa
// URL (que vazaria em histórico do navegador e logs de acesso).
//
// FICA NO BANCO, NÃO EM MEMÓRIA DO PROCESSO: entre o /callback emitir o
// code e o frontend chamar /exchange, pode não ser o MESMO processo a
// atender as duas requisições (reinício, múltiplas instâncias) — um Map
// em memória perde o code nesse caso, e o login falha silenciosamente.
// Mesmo padrão de token de uso único já usado em email_verifications,
// password_resets e export_tokens (ver lib/tokens.ts generateOneTimeToken).
//
// Expira em 60s — bem mais curto que os outros tokens de uso único, porque
// a troca acontece automaticamente no boot do app, não depende do usuário
// clicar em nada.
export const oauthLoginCodesTable = pgTable("oauth_login_codes", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => usersTable.id, { onDelete: "cascade" }),
  codeHash: text("code_hash").notNull().unique(),
  accessToken: text("access_token").notNull(),
  refreshToken: text("refresh_token").notNull(),
  expiresIn: integer("expires_in").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type OAuthLoginCode = typeof oauthLoginCodesTable.$inferSelect;
export type InsertOAuthLoginCode = typeof oauthLoginCodesTable.$inferInsert;
