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

import { Router, type RequestHandler } from "express";
import multer from "multer";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { mediaAssetsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { verifyPatientBelongsToFamily } from "../lib/family-access";
import { mediaUploadLimiter, mediaContentLimiter } from "../lib/rate-limit";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import {
  obterArmazenamento,
  novaChaveDeObjeto,
  type TipoDeMidia,
} from "../lib/media-storage.ts";
import { gerarTokenDeMidia, lerTokenDeMidia } from "../lib/media-links.ts";
import { exigeConsentimentoDeImagem, temConsentimentoDeImagem } from "../lib/image-consent.ts";

const router = Router();

/**
 * O TIPO VEM DO MIME, NUNCA DO CLIENTE.
 *
 * Se o cliente mandasse `kind`, ele poderia enviar um vídeo de 8 MB
 * declarando "image" e escapar do teto de 2 MB das imagens. Derivando o
 * tipo desta tabela, o teto certo é aplicado sempre — e um MIME fora dela
 * é recusado antes de qualquer byte ser gravado.
 *
 * SVG está fora de propósito: SVG é documento executável e vira XSS quando
 * servido de volta. Os três formatos de imagem aceitos aqui são raster.
 */
const TIPOS_ACEITOS: Record<string, TipoDeMidia> = {
  "image/jpeg": "image",
  "image/png": "image",
  "image/webp": "image",
  "video/mp4": "video",
  "video/webm": "video",
  "audio/webm": "audio",
  "audio/mp4": "audio",
  "audio/mpeg": "audio",
  "audio/ogg": "audio",
};

/**
 * Tetos por tipo, calibrados com a compressão no aparelho já aplicada
 * (ver planning/refinamentos/momentos-fotos-e-videos.md):
 *
 *   foto  ~300 KB depois de 1600px + JPEG 0.8   -> teto de 2 MB
 *   áudio ~300 KB em 60 segundos                -> teto de 1 MB
 *   vídeo ~5 MB em 30 segundos a 720p           -> teto de 8 MB
 *
 * O teto é várias vezes a expectativa: sobra para um aparelho que comprime
 * pior, sem virar porta aberta.
 */
const TETO_POR_TIPO: Record<TipoDeMidia, number> = {
  image: 2 * 1024 * 1024,
  audio: 1 * 1024 * 1024,
  video: 8 * 1024 * 1024,
};

const TETO_ABSOLUTO = Math.max(...Object.values(TETO_POR_TIPO));

/** Tamanho máximo da legenda (QUI-7). Recado curto, não post. */
const TETO_DA_LEGENDA = 300;

const upload = multer({
  storage: multer.memoryStorage(),
  // O multer só conhece um teto. Ele corta o abuso grosseiro; o teto por
  // tipo é conferido depois, quando já se sabe qual é o tipo.
  limits: { fileSize: TETO_ABSOLUTO },
  // SEM fileFilter de propósito. Filtrando aqui, um MIME recusado chega ao
  // handler como "nenhum arquivo enviado" — e o app responderia "envie um
  // arquivo" para quem enviou um arquivo. A checagem de formato acontece no
  // handler, onde dá para responder 415 dizendo a verdade.
});

function emMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * O multer LANÇA quando o arquivo passa do teto, e um throw dentro de
 * middleware vira 500 genérico do Express. Aqui ele vira 413 com mensagem
 * útil, que é a diferença entre "o app quebrou" e "esse arquivo é grande
 * demais".
 */
const receberArquivo: RequestHandler = (req, res, next) => {
  upload.single("arquivo")(req, res, (err: unknown) => {
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      res.status(413).json({
        error: `Arquivo grande demais: o limite é ${emMegabytes(TETO_ABSOLUTO)}.`,
        code: "MEDIA_TOO_LARGE",
      });
      return;
    }
    if (err) {
      safeLog.error({ action: "media_upload_parse_failed", err }, "Falha ao ler o envio de midia");
      res.status(400).json({ error: "Não conseguimos ler o arquivo enviado.", code: "MEDIA_FILE_MISSING" });
      return;
    }
    next();
  });
};

// ── Enviar ────────────────────────────────────────────────────────────────

router.post("/media", requireAuth, mediaUploadLimiter, receberArquivo, async (req, res): Promise<void> => {
  const armazenamento = obterArmazenamento();
  if (!armazenamento) {
    // Capacidade ausente não é erro do usuário. Mesmo padrão de
    // /auth/email/status e /config/maps: o que falta é dito, não escondido
    // atrás de um 500.
    res.status(503).json({
      error: "O envio de fotos e vídeos ainda não está disponível neste ambiente.",
      code: "MEDIA_STORAGE_UNAVAILABLE",
    });
    return;
  }

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

  const tipo = TIPOS_ACEITOS[req.file.mimetype];
  if (!tipo) {
    res.status(415).json({ error: "Esse formato de arquivo não é aceito.", code: "MEDIA_TYPE_REJECTED" });
    return;
  }

  const teto = TETO_POR_TIPO[tipo];
  if (req.file.size > teto) {
    res.status(413).json({
      error: `Arquivo grande demais: o limite é ${emMegabytes(teto)}.`,
      code: "MEDIA_TOO_LARGE",
    });
    return;
  }

  // QUI-6 — ninguém é fotografado sem consentimento registrado.
  //
  // Vem DEPOIS da checagem de família (senão vazaria a existência do
  // paciente pelo código de erro) e ANTES de qualquer byte ser gravado.
  //
  // Só imagem e vídeo. Áudio passa de propósito: voz não é imagem, e um
  // recado gravado pelo próprio paciente (QUI-8) é ele se expressando, não
  // ele sendo retratado. Ver lib/image-consent.ts.
  if (exigeConsentimentoDeImagem(tipo) && !(await temConsentimentoDeImagem(patientId))) {
    res.status(403).json({
      error: "Esta família ainda não registrou o consentimento para fotografar este paciente.",
      code: "IMAGE_CONSENT_REQUIRED",
    });
    return;
  }

  // Legenda opcional (QUI-7). Texto livre e curto. Recortar em vez de
  // recusar é deliberado: alguém que escreveu demais não deve perder a foto
  // que já subiu por causa disso.
  const legendaBruta = typeof req.body?.caption === "string" ? req.body.caption.trim() : "";
  const legenda = legendaBruta.length > 0 ? legendaBruta.slice(0, TETO_DA_LEGENDA) : null;

  const chave = novaChaveDeObjeto(tipo);

  // ORDEM IMPORTA: grava o objeto primeiro. Se o insert falhar depois,
  // apagamos o objeto — não sobra nada. Fazendo ao contrário, uma falha na
  // gravação deixaria uma linha apontando para um arquivo que não existe, e
  // o mural quebraria ao tentar exibir.
  try {
    await armazenamento.guardar(chave, req.file.buffer, req.file.mimetype);
  } catch (err) {
    safeLog.error({ action: "media_store_failed", err }, "Falha ao gravar midia no armazenamento");
    res.status(502).json({ error: "Não conseguimos guardar o arquivo agora. Tente de novo.", code: "MEDIA_STORE_FAILED" });
    return;
  }

  let asset: { id: number };
  try {
    [asset] = await db
      .insert(mediaAssetsTable)
      .values({
        familyId: auth.familyId,
        patientId,
        uploadedByCaregiverId: auth.caregiverId,
        kind: tipo,
        mimeType: req.file.mimetype,
        sizeBytes: req.file.size,
        objectKey: chave,
        caption: legenda,
      })
      .returning({ id: mediaAssetsTable.id });
  } catch (err) {
    await armazenamento.apagar(chave).catch(() => undefined);
    safeLog.error({ action: "media_catalog_failed", err }, "Falha ao catalogar midia; objeto removido");
    res.status(500).json({ error: "Não conseguimos guardar o arquivo agora. Tente de novo." });
    return;
  }

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
