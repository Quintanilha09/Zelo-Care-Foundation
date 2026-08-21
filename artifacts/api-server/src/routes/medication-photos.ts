import { getAuth } from "../lib/auth-types.ts";
/**
 * Extração de medicamento por foto — ZELO (ZELO-21).
 *
 * Este router NUNCA escreve em treatments/medications — é estruturalmente
 * impossível salvar um tratamento a partir de foto sem passar pela tela de
 * confirmação, porque não existe nenhum caminho aqui que crie um tratamento.
 * O cadastro de verdade continua sendo POST /patients/:id/treatments
 * (ZELO-16), que o formulário chama depois que o cuidador revisa e edita
 * os campos pré-preenchidos.
 */
import { Router } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { photoExtractionsTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth } from "../middleware/require-auth";
import { photoExtractionLimiter } from "../lib/rate-limit";
import { safeLog } from "../lib/safe-logger";
import { Clock } from "../lib/clock";
import { extractMedicationFromPhoto } from "../lib/vision.ts";

const router = Router();

const ACCEPTED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB — foto de celular comprimida cabe folgado
  fileFilter: (_req, file, cb) => {
    cb(null, ACCEPTED_MIME_TYPES.has(file.mimetype));
  },
});

// ── Enviar foto e extrair campos ────────────────────────────────────────

router.post("/medication-photos/extract", requireAuth, photoExtractionLimiter, upload.single("photo"), async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Envie uma foto em JPEG, PNG ou WebP, até 8MB." });
    return;
  }

  const imageBase64 = req.file.buffer.toString("base64");

  let result;
  try {
    result = await extractMedicationFromPhoto(imageBase64, req.file.mimetype);
  } catch (err) {
    // Foto ilegível ou falha de API: resposta calma, sem travar. O
    // formulário manual continua disponível — "prefiro digitar" é o
    // comportamento padrão quando isto falha.
    safeLog.error({ action: "photo_extraction_failed", err }, "Falha ao extrair medicamento da foto");
    res.status(422).json({ error: "Não conseguimos ler essa foto. Pode preencher manualmente." });
    return;
  }

  const [extraction] = await db
    .insert(photoExtractionsTable)
    .values({
      familyId: getAuth(req).familyId,
      uploadedByCaregiverId: getAuth(req).caregiverId,
      photoData: imageBase64,
      mimeType: req.file.mimetype,
      sizeBytes: req.file.size,
      extractedFields: result.fields,
      confidence: result.confidence,
    })
    .returning({ id: photoExtractionsTable.id });

  res.status(201).json({
    extractionId: extraction.id,
    fields: result.fields,
    confidence: result.confidence,
  });
});

// ── Confirmar (registra o que o cuidador de fato manteve, para calibração futura) ──

const ConfirmBody = z.object({
  confirmedFields: z.object({
    name: z.string().nullable(),
    concentration: z.string().nullable(),
    form: z.string().nullable(),
    posologyText: z.string().nullable(),
    // O que o cuidador de fato manteve do scheduleGuess sugerido — só para
    // calibrar a taxa de acerto depois, nunca usado pra criar nada sozinho.
    scheduleType: z.enum(["times_per_day", "every_n_hours"]).nullable().optional(),
    intervalHours: z.number().nullable().optional(),
    timesPerDay: z.number().nullable().optional(),
    durationDays: z.number().nullable().optional(),
  }),
  retainPhoto: z.boolean().default(false),
});

router.post("/medication-photos/:extractionId/confirm", requireAuth, async (req, res): Promise<void> => {
  const extractionId = Number(req.params.extractionId);
  if (isNaN(extractionId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = ConfirmBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [existing] = await db
    .select()
    .from(photoExtractionsTable)
    .where(and(eq(photoExtractionsTable.id, extractionId), eq(photoExtractionsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!existing) { res.status(404).json({ error: "Extração não encontrada" }); return; }

  const [updated] = await db
    .update(photoExtractionsTable)
    .set({
      confirmedFields: body.data.confirmedFields,
      retained: body.data.retainPhoto,
      status: "confirmed",
      confirmedAt: Clock.now(),
      // Padrão é descartar — só mantém o binário se o cuidador pediu explicitamente.
      ...(body.data.retainPhoto ? {} : { photoData: null, mimeType: null, sizeBytes: null }),
    })
    .where(eq(photoExtractionsTable.id, extractionId))
    .returning();

  res.json({ id: updated.id, status: updated.status, retained: updated.retained });
});

// ── Descartar a foto (remove o binário de fato) ─────────────────────────

router.post("/medication-photos/:extractionId/discard", requireAuth, async (req, res): Promise<void> => {
  const extractionId = Number(req.params.extractionId);
  if (isNaN(extractionId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [updated] = await db
    .update(photoExtractionsTable)
    .set({
      photoData: null,
      mimeType: null,
      sizeBytes: null,
      retained: false,
      status: "discarded",
      discardedAt: Clock.now(),
    })
    .where(and(eq(photoExtractionsTable.id, extractionId), eq(photoExtractionsTable.familyId, getAuth(req).familyId)))
    .returning();

  if (!updated) { res.status(404).json({ error: "Extração não encontrada" }); return; }
  res.json({ id: updated.id, status: updated.status });
});

export default router;
