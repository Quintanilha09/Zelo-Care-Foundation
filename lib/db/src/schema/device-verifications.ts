import { pgTable, text, serial, integer, timestamp, boolean, index, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

/**
 * A entrada travada esperando o código do aparelho novo — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS COISAS PRECISAM SER VERDADE PARA A SESSÃO SAIR: SABER A SENHA E TER O
 * E-MAIL. ESTA TABELA É O ÚNICO LUGAR ONDE A PRIMEIRA FICA GUARDADA ENQUANTO
 * A SEGUNDA NÃO CHEGA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que existe um `desafio`, e não só o código ────────────────────────
 *
 * O caminho ingênuo seria a confirmação receber `{ email, codigo }`. Isso
 * **descartaria a senha**: qualquer um que soubesse o endereço poderia gastar
 * as tentativas do código e, acertando, entrar sem nunca ter sabido a senha.
 * O segundo fator viraria o único fator.
 *
 * Então o login, depois de conferir a senha, devolve um `desafio` — um valor
 * opaco de 256 bits, sem poder nenhum sozinho. A confirmação exige
 * `{ desafio, codigo }`: o desafio prova que a senha já passou, o código prova
 * que o e-mail é da pessoa. Nenhum dos dois basta.
 *
 * ── O desafio não é sessão ────────────────────────────────────────────────
 *
 * Ele não abre nada, não vale como `Authorization`, e morre em dez minutos.
 * Se vazar, quem o tiver ainda precisa do código que está na caixa de entrada
 * de outra pessoa.
 *
 * ── Por que o código mora aqui, e não em `email_verifications` ────────────
 *
 * Mesmo formato, propósito oposto. Lá o código prova que **o endereço existe**,
 * uma vez na vida da conta; aqui prova que **quem entrou é a pessoa**, e o
 * preço de falhar é ficar do lado de fora. Misturar os dois faria um código de
 * cadastro servir para entrar de aparelho novo — e faria "reenviar o código de
 * confirmação" apagar, sem querer, uma entrada em andamento.
 *
 * SEGURANÇA: nem o desafio nem o código são guardados crus.
 */
export const deviceVerificationsTable = pgTable(
  "device_verifications",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    /** SHA-256 do desafio devolvido ao cliente. Prova que a senha passou. */
    desafioHash: text("desafio_hash").notNull(),
    /** SHA-256 de `userId:codigo`, como em todo código deste projeto. */
    codigoHash: text("codigo_hash").notNull(),
    /**
     * Erros de digitação. Em `MAX_TENTATIVAS`, o desafio inteiro morre.
     *
     * Esta é a defesa principal — seis dígitos são um milhão de combinações, e
     * um milhão é nada para uma máquina. Ver `lib/codigo-de-verificacao.ts`.
     */
    attempts: integer("attempts").notNull().default(0),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    used: boolean("used").notNull().default(false),
    usedAt: timestamp("used_at", { withTimezone: true }),
    /** De onde partiu a entrada. Vai no e-mail, para a pessoa reconhecer. */
    requestIp: text("request_ip"),
    /** Vira o rótulo do aparelho, se o código for aceito. */
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    desafioUnico: unique("uq_device_verifications_desafio").on(table.desafioHash),
    // "Esta pessoa já tem uma entrada esperando código?" — o reenvio pergunta.
    pendenteDoUsuario: index("idx_device_verifications_pendente").on(
      table.userId,
      table.used,
      table.expiresAt,
    ),
  }),
);

export type DeviceVerification = typeof deviceVerificationsTable.$inferSelect;
export type InsertDeviceVerification = typeof deviceVerificationsTable.$inferInsert;
