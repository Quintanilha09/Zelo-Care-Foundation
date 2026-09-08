import { pgTable, text, serial, integer, timestamp, boolean, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Aparelhos que já provaram ser da pessoa — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ISTO NÃO É IMPRESSÃO DIGITAL DE APARELHO. É UM TOKEN QUE O SERVIDOR EMITIU
 * E O NAVEGADOR GUARDOU. A DIFERENÇA NÃO É DE IMPLEMENTAÇÃO — É DE CONTRATO.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A alternativa óbvia seria reconhecer o aparelho por IP + user agent. A Issue
 * proíbe, e com razão dupla:
 *
 * - **erra**: IP de celular muda o dia inteiro, e uma atualização do Chrome
 *   troca o user agent. O cuidador seria tratado como estranho na própria casa
 * - **coleta**: fingerprint junta sinais que ninguém ofereceu, para adivinhar
 *   o que um token responde com certeza
 *
 * O token não entra sozinho: ele não é credencial de sessão. Ele só responde
 * "este aparelho já foi verificado por este usuário" — a senha continua sendo
 * exigida em toda entrada.
 *
 * ── Por que `token_hash` é `unique` aqui, e não em `email_verifications` ──
 *
 * Lá o segredo tem um milhão de combinações e colisão é rotina; aqui são 256
 * bits, e duas linhas com o mesmo hash significariam falha do gerador. A
 * unicidade é, além de barata, a afirmação certa sobre o dado.
 *
 * ── O par (user_id, token_hash) ───────────────────────────────────────────
 *
 * A consulta do login é sempre "este token é deste usuário?", nunca "de quem é
 * este token?". Perguntar as duas coisas juntas fecha a porta para um token
 * válido de outra conta ser aceito por engano numa refatoração futura.
 */
export const trustedDevicesTable = pgTable(
  "trusted_devices",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** SHA-256 do token cru. O cru só existe no navegador da pessoa. */
    tokenHash: text("token_hash").notNull(),
    /**
     * "Chrome no Windows" — para a pessoa reconhecer a linha na lista.
     *
     * Vem do user agent, que mente com frequência e muda sozinho. Serve para
     * a pessoa se localizar, **nunca** para decidir se o aparelho vale: quem
     * decide isso é o token.
     */
    label: text("label").notNull(),
    /** De onde o aparelho foi registrado. Ajuda a reconhecer o que não foi ela. */
    createdIp: text("created_ip"),
    /**
     * Renova o prazo a cada entrada.
     *
     * É esta coluna que faz 30 dias serem invisíveis para quem usa o app com
     * qualquer regularidade: o relógio reinicia a cada uso, e só chega ao fim
     * para quem sumiu de verdade — que é exatamente quando pedir código de
     * novo faz sentido.
     */
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    /**
     * Revogado pela própria pessoa, em Ajustes.
     *
     * Coluna em vez de `DELETE` porque "este aparelho foi desligado por você,
     * naquele dia" é informação — e porque apagar a linha faria o aparelho
     * revogado ser indistinguível de um que nunca existiu, no dia em que
     * alguém precisar entender o que aconteceu com a conta.
     */
    revoked: boolean("revoked").notNull().default(false),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    tokenUnico: unique("uq_trusted_devices_token").on(table.tokenHash),
    // "Quais aparelhos válidos este usuário tem?" — o login e a tela de Ajustes.
    doUsuario: index("idx_trusted_devices_usuario").on(table.userId, table.revoked, table.expiresAt),
  }),
);

export type TrustedDevice = typeof trustedDevicesTable.$inferSelect;
export type InsertTrustedDevice = typeof trustedDevicesTable.$inferInsert;
