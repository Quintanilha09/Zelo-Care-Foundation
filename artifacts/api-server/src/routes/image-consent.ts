/**
 * Consentimento de imagem — QUI-6 (projeto ZELO — Momentos).
 *
 *   GET  /api/patients/:patientId/image-consent   estado atual
 *   POST /api/patients/:patientId/image-consent   conceder ou revogar
 *
 * ── A tensão que esta história resolve ────────────────────────────────────
 *
 * Fotografar uma pessoa exige o consentimento dela. Quando essa pessoa é
 * idosa, dependente e às vezes sem capacidade civil plena, o cuidado
 * precisa ser MAIOR, não menor.
 *
 * O mesmo recurso pode proteger o paciente (prova de bom cuidado) ou
 * expô-lo (vigilância de alguém que não pode consentir de verdade). O que
 * separa os dois é exatamente o rigor daqui. **Na dúvida, o padrão é não
 * ter o recurso** — por isso ausência de registro significa "não", nunca
 * "ainda não perguntamos, então pode".
 *
 * ── Três regras que não são negociáveis ───────────────────────────────────
 *
 * 1. **Consentimento próprio, separado do de saúde.** Ver lib/image-consent.ts.
 * 2. **Quem consente fica registrado**, e em que papel: o próprio paciente
 *    ou o representante legal. `givenBy` é obrigatório — não tem padrão.
 * 3. **Revogar apaga as mídias que já existem.** Consentimento que não pode
 *    ser desfeito não é consentimento.
 */

import { Router } from "express";
import { z } from "zod";
import { db } from "@workspace/db";
import { consentRecordsTable } from "@workspace/db";
import { requireAuth, requirePrimaryCaregiver } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { verifyPatientBelongsToFamily } from "../lib/family-access";
import { lerEstadoDoConsentimento } from "../lib/image-consent.ts";
import { apagarMidiasDoPaciente } from "../lib/media-cleanup.ts";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";

const router = Router();

const CorpoDoConsentimento = z.object({
  consentGiven: z.boolean(),
  version: z.string().min(1),
  // Obrigatório de propósito, e sem valor padrão. "Quem está consentindo"
  // não é detalhe de formulário: é o que separa consentimento do titular de
  // decisão tomada por outra pessoa em nome dele, e é o que a trilha de
  // auditoria precisa mostrar depois.
  givenBy: z.enum(["self", "legal_representative"]),
});

function idValido(bruto: string): number | null {
  const id = Number(bruto);
  return Number.isSafeInteger(id) && id > 0 ? id : null;
}

// ── Estado atual ──────────────────────────────────────────────────────────
//
// Qualquer cuidador da família pode LER. É o que permite à tela de Momentos
// (QUI-7) simplesmente não renderizar a seção quando não há consentimento —
// em vez de mostrá-la cinza com um cadeado, que é convite a insistir.

router.get<{ patientId: string }>("/patients/:patientId/image-consent", requireAuth, async (req, res): Promise<void> => {
  const patientId = idValido(req.params.patientId);
  if (patientId === null) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const auth = getAuth(req);
  if (!(await verifyPatientBelongsToFamily(patientId, auth.familyId))) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const estado = await lerEstadoDoConsentimento(patientId);
  res.json({
    consentido: estado.consentido,
    givenBy: estado.givenBy,
    version: estado.version,
    registradoEm: estado.registradoEm?.toISOString() ?? null,
    jaDecidido: estado.jaDecidido,
    // Só o cuidador principal decide — a tela usa isto para mostrar o botão
    // a quem pode usá-lo, em vez de deixar todo mundo tentar e levar 403.
    podeDecidir: auth.role === "primary_caregiver",
  });
});

// ── Conceder ou revogar ───────────────────────────────────────────────────

router.post<{ patientId: string }>("/patients/:patientId/image-consent", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const patientId = idValido(req.params.patientId);
  if (patientId === null) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const corpo = CorpoDoConsentimento.safeParse(req.body);
  if (!corpo.success) {
    res.status(400).json({
      error: "Informe se consente, a versão do termo e quem está consentindo.",
      code: "IMAGE_CONSENT_INVALID",
    });
    return;
  }

  const auth = getAuth(req);
  if (!(await verifyPatientBelongsToFamily(patientId, auth.familyId))) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const { consentGiven, version, givenBy } = corpo.data;

  // A tabela é imutável: conceder e revogar são os dois um INSERT. É isso
  // que preserva o histórico inteiro para a ANPD — quem consentiu, em que
  // papel, quando, e quando desfez.
  await db.insert(consentRecordsTable).values({
    userId: auth.userId,
    patientId,
    givenBy,
    consentType: "image_capture",
    consentGiven: String(consentGiven),
    version,
    ipAddress: req.ip ?? "unknown",
    userAgent: req.get("user-agent") ?? undefined,
  });

  // REVOGAR APAGA O QUE JÁ EXISTE.
  //
  // Só imagem e vídeo: áudio não é coberto por este consentimento, então
  // revogá-lo não pode apagar o recado de voz que o paciente gravou.
  let apagadas = 0;
  if (!consentGiven) {
    const limpeza = await apagarMidiasDoPaciente(patientId, ["image", "video"]);
    apagadas = limpeza.apagadas;

    if (limpeza.falhas > 0) {
      // O consentimento JÁ foi revogado (o registro está gravado e a rota de
      // envio já recusa). O que falhou foi apagar arquivo — e isso o usuário
      // precisa saber, porque é a parte que ele pediu.
      safeLog.error(
        { action: "image_consent_purge_incomplete", count: limpeza.falhas },
        "Revogacao registrada, mas nem toda a midia foi apagada"
      );
      await audit({
        familyId: auth.familyId,
        entityType: "image_consent_purge",
        entityId: String(patientId),
        action: "deleted",
        actorId: String(auth.caregiverId),
        actorType: "caregiver",
        ipAddress: req.ip,
        diff: JSON.stringify({ apagadas, falhas: limpeza.falhas, completo: false }),
      });
      res.status(500).json({
        error: "O consentimento foi revogado, mas não conseguimos apagar todas as fotos. Tente revogar de novo.",
        code: "IMAGE_CONSENT_PURGE_INCOMPLETE",
        apagadas,
      });
      return;
    }
  }

  safeLog.info(
    { action: consentGiven ? "granted" : "revoked", entityType: "image_consent", familyId: auth.familyId },
    "Consentimento de imagem atualizado"
  );
  // ── Por que `action: "created"` também ao revogar ────────────────────────
  //
  // `audit_action` é um vocabulário pequeno e deliberado
  // (created/updated/deleted/accessed). Considerei acrescentar "granted" e
  // "revoked", mas isso é migração numa tabela imutável e crítica — custo
  // alto para ganho de rótulo.
  //
  // E "created" é literalmente o que aconteceu: `consent_records` só cresce,
  // e revogar é um registro NOVO. Quem lê a trilha distingue os dois pelo
  // `consentGiven` do diff, que é o campo que carrega a decisão.
  await audit({
    familyId: auth.familyId,
    entityType: "image_consent",
    entityId: String(patientId),
    action: "created",
    actorId: String(auth.caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
    // `consentGiven` responde "concedeu ou revogou", `givenBy` responde "em
    // que papel". Nada aqui é dado de saúde nem identifica o paciente por
    // nome. A coluna é `text`, não jsonb — daí o stringify.
    diff: JSON.stringify({ consentGiven, givenBy, version }),
  });

  if (!consentGiven && apagadas > 0) {
    await audit({
      familyId: auth.familyId,
      entityType: "image_consent_purge",
      entityId: String(patientId),
      action: "deleted",
      actorId: String(auth.caregiverId),
      actorType: "caregiver",
      ipAddress: req.ip,
      diff: JSON.stringify({ apagadas, falhas: 0, completo: true }),
    });
  }

  res.status(201).json({
    consentido: consentGiven,
    givenBy,
    version,
    midiasApagadas: apagadas,
  });
});

export default router;
