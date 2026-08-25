import {
  pgTable, serial, integer, text, timestamp, pgEnum, index,
} from "drizzle-orm/pg-core";
import { familiesTable } from "./families";
import { patientsTable } from "./patients";
import { caregiversTable } from "./caregivers";

/**
 * Fundação de mídia — QUI-5 (projeto ZELO — Momentos).
 *
 * ── O binário NÃO mora aqui ───────────────────────────────────────────────
 *
 * Esta tabela guarda só o CATÁLOGO. Os bytes vivem no Object Storage, e a
 * ligação entre os dois é `objectKey`.
 *
 * É a diferença deliberada em relação a `photo_extractions.photo_data` e
 * `appointments.attachment_data`, que guardam base64 dentro do Postgres.
 * Aquilo funciona para uma foto ocasional; para um mural, não:
 *
 *   - base64 infla o tamanho em ~33%
 *   - todo backup do banco passa a carregar as mídias junto
 *   - vídeo é impraticável — 30 segundos de celular são 30 a 60 MB
 *
 * Os dois campos legados continuam onde estão de propósito. Migrá-los junto
 * misturaria dois riscos numa mudança só; vira história própria depois.
 *
 * ── O nome do objeto não diz nada ─────────────────────────────────────────
 *
 * `objectKey` é aleatório (CON-008: nenhum dado de saúde em URL). Nunca
 * contém nome de paciente, de medicamento nem id previsível — quem obtiver
 * a chave não aprende nada sobre quem está na foto.
 *
 * ── Exclusão é exclusão ───────────────────────────────────────────────────
 *
 * Não há coluna `deletedAt`, e isso é escolha, não esquecimento. Apagar um
 * momento tem que apagar o OBJETO no bucket; deixar a linha marcada como
 * excluída convidaria alguém a "recuperar" mais tarde um arquivo que o
 * consentimento já não cobre. A linha some junto com os bytes.
 *
 * O `onDelete: "cascade"` em família e paciente faz a exclusão do titular
 * (REQ-006) derrubar as linhas — mas NÃO apaga o objeto no bucket. Quem
 * apaga o objeto é o código da rota, e é por isso que existe teste
 * verificando que a chave deixou de existir.
 */
export const mediaKindEnum = pgEnum("media_kind", ["image", "video", "audio"]);

export const mediaAssetsTable = pgTable(
  "media_assets",
  {
    id: serial("id").primaryKey(),
    familyId: integer("family_id")
      .notNull()
      .references(() => familiesTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),

    // Nulo quando quem enviou foi o PRÓPRIO PACIENTE, pelo token de
    // dispositivo da ZELO-58 (história 4 do refinamento). `set null` para
    // que remover um cuidador não apague a mídia que ele publicou — a foto
    // é da família, não dele.
    uploadedByCaregiverId: integer("uploaded_by_caregiver_id")
      .references(() => caregiversTable.id, { onDelete: "set null" }),

    kind: mediaKindEnum("kind").notNull(),
    mimeType: text("mime_type").notNull(),
    sizeBytes: integer("size_bytes").notNull(),

    /** Chave aleatória no bucket. Única — duas linhas nunca apontam pro mesmo objeto. */
    objectKey: text("object_key").notNull().unique(),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    // O mural é sempre "as mídias deste paciente, mais novas primeiro".
    patientTimelineIndex: index("idx_media_assets_patient_timeline").on(
      table.patientId,
      table.createdAt
    ),
  })
);

export type MediaAsset = typeof mediaAssetsTable.$inferSelect;
export type InsertMediaAsset = typeof mediaAssetsTable.$inferInsert;
