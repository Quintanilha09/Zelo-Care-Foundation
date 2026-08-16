import { getAuth } from "../lib/auth-types.ts";
/**
 * Rotas de consentimento LGPD — ZELO.
 * POST /api/consent        — registra um consentimento
 * GET  /api/consent        — lista consentimentos do usuário autenticado
 *
 * REGRAS:
 * - Cada consentimento é um INSERT imutável (nunca UPDATE)
 * - Para revogar: INSERT com consentGiven="false"
 * - Versão do termo sempre registrada (prova de qual texto foi aceito)
 * - IP e user-agent obrigatórios para prova de consentimento informado (LGPD Art. 8 §5)
 */

import { Router } from "express";
import { z } from "zod";
import { eq, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { consentRecordsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

const ConsentBody = z.object({
  consentType: z.enum([
    "terms_of_service",
    "privacy_policy",
    "health_data_processing",
    "marketing",
    "data_sharing",
  ]),
  consentGiven: z.boolean(),
  version: z.string().min(1),
  representative: z.enum(["self", "legal_representative"]).optional(),
});

router.post("/consent", requireAuth, async (req, res): Promise<void> => {
  const body = ConsentBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  const ip = req.ip ?? "unknown";

  await db.insert(consentRecordsTable).values({
    userId: getAuth(req).userId,
    consentType: body.data.consentType,
    consentGiven: String(body.data.consentGiven),
    version: body.data.version,
    ipAddress: ip,
    userAgent: req.headers["user-agent"] ?? null,
  });

  res.status(201).json({ message: "Consentimento registrado" });
});

router.get("/consent", requireAuth, async (req, res): Promise<void> => {
  const records = await db
    .select()
    .from(consentRecordsTable)
    .where(eq(consentRecordsTable.userId, getAuth(req).userId))
    .orderBy(desc(consentRecordsTable.createdAt));

  res.json(records);
});

// Versões atuais dos termos — marcadas como rascunho
router.get("/consent/terms", async (_req, res): Promise<void> => {
  res.json({
    termsOfService: {
      version: "v1.0",
      status: "draft_pending_legal_review",
      title: "Termos de Uso do ZELO",
      summary: "RASCUNHO — aguardando revisão jurídica. Não usar em produção.",
      url: "/termos",
    },
    healthDataProcessing: {
      version: "v1.0",
      status: "draft_pending_legal_review",
      title: "Consentimento para Tratamento de Dados de Saúde",
      summary: "RASCUNHO — aguardando revisão jurídica. Dados coletados: medicamentos, doses, aferições de saúde, consultas.",
      legalBasis: "Art. 11, II, a da LGPD — proteção da vida e incolumidade do titular",
      dataController: "Titular dos dados: o paciente. Responsável pelo tratamento: quem administra o ZELO.",
      url: "/consentimento-saude",
    },
  });
});

export default router;
