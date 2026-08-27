import { pgTable, serial, integer, timestamp, unique, index } from "drizzle-orm/pg-core";
import { mediaAssetsTable } from "./media-assets";
import { caregiversTable } from "./caregivers";

/**
 * O coração de um momento — QUI-10 (projeto ZELO — Momentos).
 *
 * ── Por que não existe coluna de TIPO ─────────────────────────────────────
 *
 * A reação é uma só, e é um coração. A existência da linha **é** a reação.
 *
 * Uma coluna `type` seria a porta de entrada para variedade de reações, e a
 * QUI-10 recusa isso explicitamente: escolher entre carinhas transforma um
 * gesto em resposta, e resposta pede a próxima. O produto não quer conversa
 * no mural — quer que a família diga "eu vi, e me importo".
 *
 * ── Por que não existe contador ───────────────────────────────────────────
 *
 * **Não há coluna de total, e nunca deve haver.** A regra da CON-012 é
 * mostrar QUEM reagiu, jamais QUANTOS. Um número aqui viraria placar, e
 * placar transforma carinho em métrica — o oposto do que o mural é.
 *
 * Contar linhas é trivial em SQL, e é por isso que o cuidado precisa estar
 * na resposta da API: existe teste que falha se qualquer campo de total
 * aparecer no JSON do mural.
 *
 * ── Um por cuidador ───────────────────────────────────────────────────────
 *
 * `UNIQUE(media_asset_id, caregiver_id)` impede a mesma pessoa de reagir
 * duas vezes. O botão alterna: reagir de novo apaga a linha.
 *
 * Os dois `onDelete: "cascade"` são de propósito: momento apagado leva as
 * reações junto (não sobra carinho órfão apontando para nada), e cuidador
 * removido da família também. Aqui, ao contrário do autor da mídia, **não**
 * é `set null` — uma reação anônima não significa nada, já que o valor dela
 * é justamente ser de alguém.
 */
export const mediaReactionsTable = pgTable(
  "media_reactions",
  {
    id: serial("id").primaryKey(),
    mediaAssetId: integer("media_asset_id")
      .notNull()
      .references(() => mediaAssetsTable.id, { onDelete: "cascade" }),
    caregiverId: integer("caregiver_id")
      .notNull()
      .references(() => caregiversTable.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    umPorCuidador: unique("uq_media_reaction_asset_caregiver").on(
      table.mediaAssetId,
      table.caregiverId
    ),
    // O mural sempre lê as reações de uma lista de momentos de uma vez
    // (`inArray`). Sem este índice seria varredura da tabela inteira a cada
    // abertura da seção.
    porMidia: index("idx_media_reactions_asset").on(table.mediaAssetId),
  })
);

export type MediaReaction = typeof mediaReactionsTable.$inferSelect;
export type InsertMediaReaction = typeof mediaReactionsTable.$inferInsert;
