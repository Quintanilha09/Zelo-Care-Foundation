import {
  pgTable, serial, integer, text, timestamp, boolean, jsonb, pgEnum,
} from "drizzle-orm/pg-core";
import { familiesTable } from "./families";
import { caregiversTable } from "./caregivers";

// ZELO-21: extração de medicamento por foto (Claude Vision).
//
// Separa deliberadamente o BINÁRIO da foto (photoData/mimeType/sizeBytes,
// nulados de propósito ao descartar — é isso que torna "descartar remove o
// arquivo do storage de fato" literalmente verdade) dos CAMPOS EXTRAÍDOS
// (extractedFields/confidence/confirmedFields), que não são dado sensível
// de imagem e sobrevivem ao descarte — servem só pra calibrar a taxa de
// acerto por campo depois (extractedFields vs. confirmedFields).
//
// Este registro NUNCA cria um treatment/medication sozinho — é só o rascunho
// que preenche o formulário de cadastro manual (POST /treatments já
// existente). Ver routes/medication-photos.ts.
export const photoExtractionStatusEnum = pgEnum("photo_extraction_status", [
  "pending_confirmation",
  "confirmed",
  "discarded",
]);

export const photoExtractionsTable = pgTable("photo_extractions", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  uploadedByCaregiverId: integer("uploaded_by_caregiver_id")
    .notNull()
    .references(() => caregiversTable.id, { onDelete: "cascade" }),

  // Binário — nulado ao descartar. Nunca persiste fora deste banco.
  photoData: text("photo_data"), // base64; nulado no descarte
  mimeType: text("mime_type"),
  sizeBytes: integer("size_bytes"),
  // Cuidador escolhe reter a foto além da confirmação — padrão é descartar.
  retained: boolean("retained").notNull().default(false),

  // Resultado bruto do modelo — nome, concentração, forma, posologia como
  // texto (nunca mapeada automaticamente pra scheduleConfig estruturado,
  // isso é decisão do cuidador no formulário). Um valor de confiança 0-1
  // por campo em `confidence`.
  extractedFields: jsonb("extracted_fields").notNull(),
  confidence: jsonb("confidence").notNull(),

  // Preenchido só quando o cuidador confirma o formulário — o que ele de
  // fato manteve/corrigiu. Nunca gravado a partir da resposta do modelo
  // sozinha. Usado só para calibrar taxa de acerto por campo depois.
  confirmedFields: jsonb("confirmed_fields"),

  status: photoExtractionStatusEnum("status").notNull().default("pending_confirmation"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  discardedAt: timestamp("discarded_at", { withTimezone: true }),
});

export type PhotoExtraction = typeof photoExtractionsTable.$inferSelect;
export type InsertPhotoExtraction = typeof photoExtractionsTable.$inferInsert;
