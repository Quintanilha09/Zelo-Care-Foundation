/**
 * Receber um arquivo multipart — QUI-8.
 *
 * Usado pelas duas portas de entrada de mídia (cuidador e paciente), pelo
 * mesmo motivo de `lib/media-upload.ts` existir: o teto e o tratamento de
 * erro precisam ser idênticos nos dois, e duplicá-los é duplicar o dia em
 * que eles divergem.
 */
import multer from "multer";
import type { RequestHandler } from "express";
import { TETO_ABSOLUTO, emMegabytes } from "../lib/media-upload.ts";
import { safeLog } from "../lib/safe-logger.ts";

const upload = multer({
  storage: multer.memoryStorage(),
  // O multer só conhece um teto. Ele corta o abuso grosseiro; o teto por
  // tipo é conferido depois, quando já se sabe qual é o tipo.
  limits: { fileSize: TETO_ABSOLUTO },
  // SEM fileFilter de propósito. Filtrando aqui, um MIME recusado chega ao
  // handler como "nenhum arquivo enviado" — e o app responderia "envie um
  // arquivo" para quem enviou um arquivo. A checagem de formato acontece
  // em guardarMidia, onde dá para responder 415 dizendo a verdade.
});

/**
 * O multer LANÇA quando o arquivo passa do teto, e um throw dentro de
 * middleware vira 500 genérico do Express. Aqui ele vira 413 com mensagem
 * útil, que é a diferença entre "o app quebrou" e "esse arquivo é grande
 * demais".
 */
export const receberArquivo: RequestHandler = (req, res, next) => {
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
