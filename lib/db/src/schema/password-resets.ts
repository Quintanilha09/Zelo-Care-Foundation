import { pgTable, text, serial, integer, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * Códigos de redefinição de senha.
 *
 * ── Era link, virou código de 6 dígitos (Issue #102) ──────────────────────
 *
 * Até 04/09/2026 isto guardava o SHA-256 de um token de 64 hex, e o token
 * viajava dentro de um link montado com `APP_URL`. Em 03/09/2026 o fundador
 * ficou sem conseguir trocar a senha: o e-mail chegou perfeito e o link levava
 * a uma página de erro do Replit, porque `APP_URL` apontava para um app que
 * nunca foi publicado.
 *
 * Foi o **terceiro** tropeço na mesma variável em dois dias — antes disso ela
 * esteve ausente e depois sem `https://`. Três configurações diferentes, um
 * sintoma só: o problema não era a variável, era depender de link.
 *
 * A verificação de e-mail já tinha feito essa troca na Issue #77, pela mesma
 * razão, e não deu mais problema desde então.
 *
 * ── Por que três coisas mudaram junto ─────────────────────────────────────
 *
 * O código tem **um milhão** de combinações; o token tinha 2^256. Trocar um
 * pelo outro sem mudar mais nada seria rebaixamento de segurança disfarçado de
 * melhoria de usabilidade. O que segura o código não é o tamanho dele:
 *
 * 1. **`attempts`** — 5 erros e o código morre. Sem esta coluna, um milhão de
 *    tentativas é questão de minutos. É a defesa principal, não um detalhe.
 *
 * 2. **`token_hash` deixou de ser `UNIQUE`.** Com 6 dígitos, a mesma pessoa
 *    pedindo dois códigos pode sortear o mesmo duas vezes — 1 em um milhão é
 *    raro, e "raro" num `INSERT` significa erro 500 para alguém, um dia, sem
 *    explicação. O hash leva o `userId` como sal (ver
 *    `lib/codigo-de-verificacao.ts`), o que já separa um usuário do outro;
 *    declarar unicidade global era, além de quebrado, a afirmação errada
 *    sobre o dado.
 *
 * 3. **Índice por `(user_id, used, expires_at)`** — a consulta quente passou a
 *    ser "o código ativo deste usuário", e não mais "quem tem este hash".
 *
 * ── Só um código vivo por vez ─────────────────────────────────────────────
 *
 * Cada código vivo é mais 5 tentativas oferecidas a quem estiver adivinhando.
 * Emitir um novo **invalida os anteriores**.
 *
 * ── O prazo caiu de 1 hora para 10 minutos ────────────────────────────────
 *
 * A hora existia porque a pessoa podia demorar a achar o e-mail, abrir noutro
 * aparelho, voltar. Com código digitado na tela que já está aberta, esse
 * percurso não existe — e prazo de redefinição de senha é janela de ataque.
 * Dez minutos é o mesmo da verificação de conta (`VALIDADE_MINUTOS`).
 *
 * SEGURANÇA: o código cru só existe no e-mail. O banco guarda o hash. Ao usar,
 * marca `used = true` E revoga todos os `refresh_tokens` do usuário, forçando
 * login novo em todos os aparelhos.
 */
export const passwordResetsTable = pgTable(
  "password_resets",
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
    requestIp: text("request_ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // "Qual o código ativo deste usuário?" — a única pergunta que a confirmação faz.
    codigoAtivo: index("idx_password_resets_ativo").on(
      table.userId,
      table.used,
      table.expiresAt,
    ),
  }),
);

export type PasswordReset = typeof passwordResetsTable.$inferSelect;
export type InsertPasswordReset = typeof passwordResetsTable.$inferInsert;
