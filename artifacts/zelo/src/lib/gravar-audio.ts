/**
 * Gravar um recado em áudio — QUI-8.
 *
 * ── Por que áudio, e não vídeo ────────────────────────────────────────────
 *
 * Para um idoso, segurar um botão e falar é **muito** mais fácil que digitar
 * ou se filmar. E o custo não se compara: 60 segundos de áudio a 24 kbps são
 * ~180 KB — contra ~5 MB de um vídeo de 30 segundos.
 *
 * Para quem tem dificuldade motora, visual ou de leitura — boa parte do
 * público deste app — o áudio pode ser o único canal que funciona de verdade.
 *
 * ── Formato ───────────────────────────────────────────────────────────────
 *
 * Opus dentro de WebM onde há suporte (Chrome, Firefox, Edge, Android);
 * MP4/AAC no Safari, que não grava WebM. A allowlist do servidor aceita os
 * dois — ver lib/media-upload.ts.
 *
 * 24 kbps é bitrate de voz, não de música: 60 segundos cabem em ~180 KB, bem
 * abaixo do teto de 1 MB do servidor e do critério de aceite de 300 KB.
 */

/** Limite duro de gravação. Recado, não podcast. */
export const SEGUNDOS_MAXIMOS = 60;

const BITRATE = 24_000;

/** Formatos que tentamos, em ordem de preferência. */
const FORMATOS = [
  "audio/webm;codecs=opus",
  "audio/webm",
  "audio/mp4",
  "audio/ogg;codecs=opus",
];

export function gravacaoDisponivel(): boolean {
  return (
    typeof MediaRecorder !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia
  );
}

function escolherFormato(): string | null {
  if (typeof MediaRecorder === "undefined") return null;
  for (const formato of FORMATOS) {
    if (MediaRecorder.isTypeSupported(formato)) return formato;
  }
  return null;
}

export interface Gravacao {
  /** Encerra a gravação e devolve o arquivo. Idempotente. */
  parar: () => Promise<File>;
  /** Desiste: solta o microfone e não devolve nada. */
  cancelar: () => void;
  /** Formato escolhido, útil para diagnóstico. */
  formato: string;
}

/**
 * Começa a gravar. Lança se o navegador não suportar ou se a pessoa negar o
 * microfone — quem chama mostra a mensagem.
 *
 * O microfone é solto assim que a gravação termina, sempre. Deixar o stream
 * aberto mantém o indicador de "gravando" aceso no aparelho, e num app de
 * pessoa vulnerável isso é inaceitável.
 */
export async function comecarGravacao(): Promise<Gravacao> {
  if (!gravacaoDisponivel()) {
    throw new Error("Este aparelho não consegue gravar áudio.");
  }

  const formato = escolherFormato();
  if (!formato) throw new Error("Este navegador não grava áudio num formato que aceitamos.");

  const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
  const recorder = new MediaRecorder(stream, { mimeType: formato, audioBitsPerSecond: BITRATE });
  const pedacos: Blob[] = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) pedacos.push(e.data); };
  recorder.start();

  const soltarMicrofone = () => stream.getTracks().forEach((t) => t.stop());

  // Trava de segurança no próprio gravador: mesmo que a tela erre o
  // cronômetro, a gravação para sozinha no limite.
  const corte = setTimeout(() => {
    if (recorder.state === "recording") recorder.stop();
  }, SEGUNDOS_MAXIMOS * 1000);

  let finalizada: Promise<File> | null = null;

  return {
    formato,
    parar: () => {
      if (finalizada) return finalizada;
      finalizada = new Promise<File>((resolve, reject) => {
        recorder.onstop = () => {
          clearTimeout(corte);
          soltarMicrofone();
          const blob = new Blob(pedacos, { type: formato });
          if (blob.size === 0) {
            reject(new Error("Não saiu som nenhum. Tente segurar o botão por mais tempo."));
            return;
          }
          // A extensão só serve para o nome do arquivo; quem manda é o MIME.
          const extensao = formato.startsWith("audio/mp4") ? "m4a" : formato.startsWith("audio/ogg") ? "ogg" : "webm";
          resolve(new File([blob], `recado.${extensao}`, { type: formato.split(";")[0] }));
        };
        recorder.onerror = () => {
          clearTimeout(corte);
          soltarMicrofone();
          reject(new Error("A gravação falhou. Tente de novo."));
        };
        if (recorder.state === "recording") recorder.stop();
        else recorder.onstop?.(new Event("stop"));
      });
      return finalizada;
    },
    cancelar: () => {
      clearTimeout(corte);
      recorder.onstop = null;
      if (recorder.state === "recording") recorder.stop();
      soltarMicrofone();
    },
  };
}
