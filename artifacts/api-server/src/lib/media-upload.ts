/**
 * Receber uma mídia — regra única, dois portões de entrada — QUI-8.
 *
 * ── Por que isto virou módulo ─────────────────────────────────────────────
 *
 * A partir da QUI-8 existem DOIS caminhos para uma mídia entrar:
 *
 *   1. `POST /api/media` — o cuidador, com sessão de cuidador
 *   2. `POST /api/patient-access/momento` — o PACIENTE, do aparelho dele,
 *      com o token de dispositivo da ZELO-58
 *
 * São autenticações completamente diferentes, de propósito. Mas o que
 * acontece com o arquivo depois — allowlist de MIME, teto por tipo, portão
 * de consentimento, gravar objeto antes da linha — precisa ser
 * **exatamente igual** nos dois.
 *
 * Duplicar isso seria duplicar validação de segurança, e validação de
 * segurança duplicada é validação que um dia diverge. Quem autentica é a
 * rota; o que vale para o arquivo é este arquivo.
 */

import { db } from "@workspace/db";
import { mediaAssetsTable } from "@workspace/db";
import { obterArmazenamento, novaChaveDeObjeto, type TipoDeMidia } from "./media-storage.ts";
import { exigeConsentimentoDeImagem, temConsentimentoDeImagem } from "./image-consent.ts";
import { avisarMomentoNovo } from "./momento-aviso.ts";
import { safeLog } from "./safe-logger.ts";

/**
 * O TIPO VEM DO MIME, NUNCA DO CLIENTE.
 *
 * Se o cliente mandasse `kind`, ele poderia enviar um vídeo de 8 MB
 * declarando "image" e escapar do teto de 2 MB das imagens.
 *
 * SVG está fora de propósito: SVG é documento executável e vira XSS quando
 * servido de volta. Os três formatos de imagem aceitos são raster.
 */
export const TIPOS_ACEITOS: Record<string, TipoDeMidia> = {
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
 */
export const TETO_POR_TIPO: Record<TipoDeMidia, number> = {
  image: 2 * 1024 * 1024,
  audio: 1 * 1024 * 1024,
  video: 8 * 1024 * 1024,
};

export const TETO_ABSOLUTO = Math.max(...Object.values(TETO_POR_TIPO));

/** Tamanho máximo da legenda (QUI-7). Recado curto, não post. */
export const TETO_DA_LEGENDA = 300;

export function emMegabytes(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Legenda opcional, recortada em vez de recusada — ver `guardarMidia`. */
export function normalizarLegenda(bruta: unknown): string | null {
  if (typeof bruta !== "string") return null;
  const limpa = bruta.trim();
  return limpa.length > 0 ? limpa.slice(0, TETO_DA_LEGENDA) : null;
}

export interface ArquivoRecebido {
  buffer: Buffer;
  mimetype: string;
  size: number;
}

export interface PedidoDeMidia {
  familyId: number;
  patientId: number;
  /** Nulo quando quem enviou foi o próprio paciente, do aparelho dele. */
  caregiverId: number | null;
  arquivo: ArquivoRecebido;
  caption?: unknown;
}

export type ResultadoDeMidia =
  | {
      ok: true;
      id: number;
      tipo: TipoDeMidia;
      sizeBytes: number;
      /**
       * O aviso à família (QUI-10), **já em andamento e sem espera**.
       *
       * A rota não aguarda de propósito: avisar são chamadas HTTPS a serviços
       * de push, uma por aparelho da família. Aguardar acrescentaria o tempo
       * de todos eles à resposta de quem enviou a foto — e quem enviou já fez
       * o que queria fazer, não está esperando por isso.
       *
       * A promessa vem no resultado só para que **o teste tenha onde
       * esperar**. Teste que dorme meio segundo torcendo para o push já ter
       * saído é teste instável, e teste instável ensina a ignorar vermelho.
       */
      avisoEnviado: Promise<unknown>;
    }
  | { ok: false; status: number; error: string; code: string };

/**
 * Valida, guarda o objeto e cataloga. Não fala HTTP — devolve o que
 * aconteceu, e a rota traduz.
 */
export async function guardarMidia(pedido: PedidoDeMidia): Promise<ResultadoDeMidia> {
  const armazenamento = obterArmazenamento();
  if (!armazenamento) {
    // Capacidade ausente não é erro do usuário. Mesmo padrão de
    // /auth/email/status e /config/maps: o que falta é dito, não escondido.
    return {
      ok: false, status: 503,
      error: "O envio de fotos e vídeos ainda não está disponível neste ambiente.",
      code: "MEDIA_STORAGE_UNAVAILABLE",
    };
  }

  const tipo = TIPOS_ACEITOS[pedido.arquivo.mimetype];
  if (!tipo) {
    return { ok: false, status: 415, error: "Esse formato de arquivo não é aceito.", code: "MEDIA_TYPE_REJECTED" };
  }

  const teto = TETO_POR_TIPO[tipo];
  if (pedido.arquivo.size > teto) {
    return {
      ok: false, status: 413,
      error: `Arquivo grande demais: o limite é ${emMegabytes(teto)}.`,
      code: "MEDIA_TOO_LARGE",
    };
  }

  // QUI-6 — ninguém é fotografado sem consentimento registrado.
  //
  // Só imagem e vídeo. Áudio passa de propósito: voz não é imagem, e um
  // recado gravado pelo próprio paciente é ele se expressando, não ele
  // sendo retratado. Ver lib/image-consent.ts.
  if (exigeConsentimentoDeImagem(tipo) && !(await temConsentimentoDeImagem(pedido.patientId))) {
    return {
      ok: false, status: 403,
      error: "Esta família ainda não registrou o consentimento para fotografar este paciente.",
      code: "IMAGE_CONSENT_REQUIRED",
    };
  }

  const chave = novaChaveDeObjeto(tipo);

  // ORDEM IMPORTA: grava o objeto primeiro. Se o insert falhar depois,
  // apagamos o objeto — não sobra nada. Fazendo ao contrário, uma falha na
  // gravação deixaria uma linha apontando para um arquivo que não existe, e
  // o mural quebraria ao tentar exibir.
  try {
    await armazenamento.guardar(chave, pedido.arquivo.buffer, pedido.arquivo.mimetype);
  } catch (err) {
    safeLog.error({ action: "media_store_failed", err }, "Falha ao gravar midia no armazenamento");
    return {
      ok: false, status: 502,
      error: "Não conseguimos guardar o arquivo agora. Tente de novo.",
      code: "MEDIA_STORE_FAILED",
    };
  }

  try {
    const [asset] = await db
      .insert(mediaAssetsTable)
      .values({
        familyId: pedido.familyId,
        patientId: pedido.patientId,
        uploadedByCaregiverId: pedido.caregiverId,
        kind: tipo,
        mimeType: pedido.arquivo.mimetype,
        sizeBytes: pedido.arquivo.size,
        objectKey: chave,
        caption: normalizarLegenda(pedido.caption),
      })
      .returning({ id: mediaAssetsTable.id });

    // QUI-10 — a família fica sabendo que há algo novo.
    //
    // Aqui, e não em cada rota, pelo mesmo motivo que a validação está aqui:
    // os dois portões de entrada precisam se comportar igual, e um deles é o
    // aparelho do próprio paciente. Um recado gravado por ela é exatamente
    // o caso em que ninguém pode ficar sem saber.
    //
    // `avisarMomentoNovo` nunca lança — se o push falhar, a mídia continua
    // publicada, que é o que importa.
    const avisoEnviado = avisarMomentoNovo(asset.id);

    return { ok: true, id: asset.id, tipo, sizeBytes: pedido.arquivo.size, avisoEnviado };
  } catch (err) {
    await armazenamento.apagar(chave).catch(() => undefined);
    safeLog.error({ action: "media_catalog_failed", err }, "Falha ao catalogar midia; objeto removido");
    return {
      ok: false, status: 500,
      error: "Não conseguimos guardar o arquivo agora. Tente de novo.",
      code: "MEDIA_CATALOG_FAILED",
    };
  }
}
