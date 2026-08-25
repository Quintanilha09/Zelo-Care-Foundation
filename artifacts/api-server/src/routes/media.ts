/**
 * Fundação de mídia — QUI-5 (projeto ZELO — Momentos).
 *
 * Esta história NÃO tem tela. Ela existe para que as próximas tenham onde
 * guardar arquivo com segurança:
 *
 *   POST   /api/media                    envia um arquivo (autenticado)
 *   GET    /api/media/:id/link           gera um link curto de leitura
 *   GET    /api/media/content/:token     devolve os bytes (o token É a autenticação)
 *   DELETE /api/media/:id                apaga o objeto E a linha
 *
 * O que NÃO está aqui, de propósito:
 *   - consentimento de imagem — é a QUI-6, e vem ANTES de qualquer tela
 *   - mural, legenda, autor na tela — é a QUI-7
 *   - transcodificação — nunca. A compressão é no aparelho.
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { mediaAssetsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { receberArquivo } from "../middleware/receber-arquivo.ts";
import { getAuth } from "../lib/auth-types.ts";
import { verifyPatientBelongsToFamily } from "../lib/family-access";
import { mediaUploadLimiter, mediaContentLimiter } from "../lib/rate-limit";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { obterArmazenamento } from "../lib/media-storage.ts";
import { guardarMidia } from "../lib/media-upload.ts";
import { gerarTokenDeMidia, lerTokenDeMidia } from "../lib/media-links.ts";

const router = Router();

// ── Enviar ────────────────────────────────────────────────────────────────
//
// A validação do arquivo (allowlist de MIME, teto por tipo, consentimento,
// ordem de gravação) vive em lib/media-upload.ts, compartilhada com a rota
// do PACIENTE (QUI-8). Aqui fica só o que é específico do cuidador: a
// sessão dele e o vínculo do paciente com a família dele.

router.post("/media", requireAuth, mediaUploadLimiter, receberArquivo, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({
      error: "Envie um arquivo em JPEG, PNG, WebP, MP4, WebM, MP3 ou OGG.",
      code: "MEDIA_FILE_MISSING",
    });
    return;
  }

  const patientId = Number(req.body?.patientId);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    res.status(400).json({ error: "Informe de qual paciente é esta mídia.", code: "PATIENT_ID_REQUIRED" });
    return;
  }

  const auth = getAuth(req);
  if (!(await verifyPatientBelongsToFamily(patientId, auth.familyId))) {
    // 404, nunca 403 — não confirmamos nem que o paciente existe (CON-014).
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const resultado = await guardarMidia({
    familyId: auth.familyId,
    patientId,
    caregiverId: auth.caregiverId,
    arquivo: { buffer: req.file.buffer, mimetype: req.file.mimetype, size: req.file.size },
    caption: req.body?.caption,
  });

  if (!resultado.ok) {
    res.status(resultado.status).json({ error: resultado.error, code: resultado.code });
    return;
  }

  const asset = { id: resultado.id };
  const tipo = resultado.tipo;

  await audit({
    familyId: auth.familyId,
    entityType: "media_asset",
    entityId: String(asset.id),
    action: "created",
    actorType: "caregiver",
    actorId: String(auth.caregiverId),
  });

  const { token, expiraEm } = gerarTokenDeMidia(asset.id);
  res.status(201).json({
    id: asset.id,
    kind: tipo,
    sizeBytes: req.file.size,
    url: `/api/media/content/${token}`,
    expiraEm: expiraEm.toISOString(),
  });
});

// ── Ler os bytes ──────────────────────────────────────────────────────────
//
// Declarada ANTES de /media/:id/link. As duas têm três segmentos, e a regra
// deste projeto (uma rota já foi engolida por outra) é: literal primeiro.

router.get<{ token: string }>("/media/content/:token", mediaContentLimiter, async (req, res): Promise<void> => {
  const assetId = lerTokenDeMidia(req.params.token);
  if (assetId === null) {
    res.status(410).json({ error: "Link expirado ou inválido" });
    return;
  }

  const [asset] = await db
    .select()
    .from(mediaAssetsTable)
    .where(eq(mediaAssetsTable.id, assetId))
    .limit(1);

  if (!asset) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const armazenamento = obterArmazenamento();
  const bytes = armazenamento ? await armazenamento.ler(asset.objectKey) : null;
  if (!bytes) {
    safeLog.error({ action: "media_object_missing" }, "Linha de midia sem objeto correspondente");
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  res.setHeader("Content-Type", asset.mimeType);
  // nosniff: impede que o navegador ignore o Content-Type e trate o arquivo
  // como HTML. Sem isso, um arquivo malicioso que passasse pelo allowlist
  // poderia executar script na origem do app.
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Disposition", "inline");
  // private: nunca em cache compartilhado. O tempo bate com a validade do
  // link — cache mais longo que o link serviria conteúdo já revogado.
  res.setHeader("Cache-Control", "private, max-age=600");
  res.send(bytes);
});

// ── Renovar o link ────────────────────────────────────────────────────────

router.get<{ id: string }>("/media/:id/link", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const auth = getAuth(req);
  const [asset] = await db
    .select({ id: mediaAssetsTable.id, kind: mediaAssetsTable.kind })
    .from(mediaAssetsTable)
    .where(and(eq(mediaAssetsTable.id, id), eq(mediaAssetsTable.familyId, auth.familyId)))
    .limit(1);

  if (!asset) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const { token, expiraEm } = gerarTokenDeMidia(asset.id);
  res.json({
    id: asset.id,
    kind: asset.kind,
    url: `/api/media/content/${token}`,
    expiraEm: expiraEm.toISOString(),
  });
});

// ── Apagar ────────────────────────────────────────────────────────────────

router.delete<{ id: string }>("/media/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (!Number.isSafeInteger(id) || id <= 0) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const auth = getAuth(req);
  const [asset] = await db
    .select()
    .from(mediaAssetsTable)
    .where(and(eq(mediaAssetsTable.id, id), eq(mediaAssetsTable.familyId, auth.familyId)))
    .limit(1);

  if (!asset) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  // QUI-7 — quem publicou apaga o seu; o cuidador principal apaga qualquer um.
  //
  // A lista do mural já devolve `podeApagar` por item, mas isso é conforto de
  // tela, não segurança: o frontend não é fronteira. A regra vale aqui.
  //
  // 403, não 404, e de propósito: quem chegou até aqui já provou que a mídia
  // é da família dele. Esconder a existência de algo que ele acabou de ver na
  // própria tela não protegeria nada e só confundiria.
  const ehDono = asset.uploadedByCaregiverId === auth.caregiverId;
  if (!ehDono && auth.role !== "primary_caregiver") {
    res.status(403).json({
      error: "Só quem publicou, ou o cuidador principal, pode apagar este momento.",
      code: "MEDIA_DELETE_DENIED",
    });
    return;
  }

  // ORDEM IMPORTA, e é o inverso do envio: o objeto sai primeiro. Se apagar
  // o objeto falhar, a linha CONTINUA lá e a operação devolve erro — dá para
  // tentar de novo. Apagando a linha antes, um objeto órfão ficaria no bucket
  // para sempre, sem nada que aponte para ele. Isso não é só custo: é dado
  // pessoal que alguém pediu para apagar e continuou existindo.
  const armazenamento = obterArmazenamento();
  if (armazenamento) {
    try {
      await armazenamento.apagar(asset.objectKey);
    } catch (err) {
      safeLog.error({ action: "media_delete_failed", err }, "Falha ao apagar objeto de midia");
      res.status(502).json({ error: "Não conseguimos apagar o arquivo agora. Tente de novo.", code: "MEDIA_DELETE_FAILED" });
      return;
    }
  }

  await db.delete(mediaAssetsTable).where(eq(mediaAssetsTable.id, asset.id));

  await audit({
    familyId: auth.familyId,
    entityType: "media_asset",
    entityId: String(asset.id),
    action: "deleted",
    actorType: "caregiver",
    actorId: String(auth.caregiverId),
  });

  res.status(204).end();
});

export default router;
