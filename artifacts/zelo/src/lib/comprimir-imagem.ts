/**
 * Compressão de foto no aparelho — QUI-7.
 *
 * ── É a maior economia do projeto inteiro, e é de graça ───────────────────
 *
 * Uma foto de celular tem 3 a 8 MB. Reduzida para 1600px no lado maior e
 * reencodada em JPEG 0.8, ela vira ~300 KB — **10 a 20 vezes menos**
 * armazenamento e banda, sem que ninguém perceba a diferença numa tela de
 * celular.
 *
 * O navegador faz isso sozinho, com `canvas`. Nenhuma biblioteca nova.
 *
 * ── E tira o endereço de dentro da foto ──────────────────────────────────
 *
 * Efeito colateral que aqui é benefício principal: **desenhar num canvas e
 * reencodar descarta todo o EXIF** — inclusive as coordenadas de GPS que a
 * câmera grava.
 *
 * Sem isto, uma foto da Dona Maria carregaria a localização exata da casa
 * dela para dentro do nosso armazenamento. Para um produto que cuida de
 * pessoa vulnerável, isso não é detalhe.
 *
 * ── A orientação precisa ser tratada de propósito ─────────────────────────
 *
 * Foto tirada em pé costuma vir com os pixels deitados e uma marca de EXIF
 * dizendo "gire 90°". Como estamos jogando o EXIF fora, se não aplicarmos a
 * rotação ANTES, a foto sai deitada. `createImageBitmap` com
 * `imageOrientation: "from-image"` resolve; o caminho de reserva usa `<img>`,
 * que o navegador já orienta sozinho ao renderizar.
 */

/** Lado maior da imagem final, em pixels. */
export const LADO_MAXIMO = 1600;

/** Qualidade do JPEG. 0.8 é o ponto onde o arquivo despenca e o olho não vê. */
export const QUALIDADE = 0.8;

export interface FotoComprimida {
  arquivo: File;
  bytesAntes: number;
  bytesDepois: number;
  largura: number;
  altura: number;
}

/** Carrega a imagem já orientada, com caminho de reserva para navegador antigo. */
async function carregarImagem(arquivo: File): Promise<{ fonte: CanvasImageSource; largura: number; altura: number; liberar: () => void }> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(arquivo, { imageOrientation: "from-image" });
      return {
        fonte: bitmap,
        largura: bitmap.width,
        altura: bitmap.height,
        liberar: () => bitmap.close(),
      };
    } catch {
      // Safari antigo não aceita `imageOrientation`. Cai para o <img>.
    }
  }

  const url = URL.createObjectURL(arquivo);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Não foi possível ler esta imagem."));
      el.src = url;
    });
    return {
      fonte: img,
      largura: img.naturalWidth,
      altura: img.naturalHeight,
      liberar: () => URL.revokeObjectURL(url),
    };
  } catch (erro) {
    URL.revokeObjectURL(url);
    throw erro;
  }
}

/**
 * Comprime uma foto para envio.
 *
 * Lança se o arquivo não for imagem legível — quem chama mostra a mensagem.
 * Nunca devolve um arquivo MAIOR que o original: se a recompressão engordar
 * (acontece com imagem já minúscula, ou PNG de poucas cores), devolve o
 * original.
 */
export async function comprimirFoto(arquivo: File): Promise<FotoComprimida> {
  const { fonte, largura, altura, liberar } = await carregarImagem(arquivo);

  // Fora do `try` de propósito: o `finally` precisa alcançá-lo para soltar os
  // pixels. Ver o comentário longo lá embaixo.
  let canvas: HTMLCanvasElement | null = null;

  try {
    const escala = Math.min(1, LADO_MAXIMO / Math.max(largura, altura));
    const novaLargura = Math.round(largura * escala);
    const novaAltura = Math.round(altura * escala);

    // `tela` é o alias local; `canvas` guarda a mesma referência só para o
    // `finally` alcançar. Sem o alias, o TypeScript perde o estreitamento de
    // tipo dentro da closure do `toBlob`.
    const tela = document.createElement("canvas");
    canvas = tela;
    tela.width = novaLargura;
    tela.height = novaAltura;

    const ctx = tela.getContext("2d");
    if (!ctx) throw new Error("Este navegador não conseguiu preparar a foto.");
    // Fundo branco: JPEG não tem transparência, e sem isto um PNG com fundo
    // transparente vira preto.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, novaLargura, novaAltura);
    ctx.drawImage(fonte, 0, 0, novaLargura, novaAltura);

    const blob = await new Promise<Blob | null>((resolve) => {
      tela.toBlob(resolve, "image/jpeg", QUALIDADE);
    });
    if (!blob) throw new Error("Não conseguimos preparar a foto para envio.");

    // Recomprimir nem sempre encolhe. Quando não encolhe, o original vence —
    // e o original mantém o formato que o usuário escolheu.
    if (blob.size >= arquivo.size) {
      return {
        arquivo,
        bytesAntes: arquivo.size,
        bytesDepois: arquivo.size,
        largura,
        altura,
      };
    }

    return {
      arquivo: new File([blob], "momento.jpg", { type: "image/jpeg" }),
      bytesAntes: arquivo.size,
      bytesDepois: blob.size,
      largura: novaLargura,
      altura: novaAltura,
    };
  } finally {
    liberar();
    // ── Soltar o canvas na mão, e não esperar o coletor — Issue #53 ───────
    //
    // Um canvas de 1600×1200 guarda ~7,7 MB de pixels, e essa memória **não
    // é do JavaScript**: vive no processo do navegador e só sai quando o
    // objeto é coletado. Num laço que comprime oito fotos seguidas, o
    // coletor não roda entre as voltas — ele não tem por que rodar, já que
    // sobra memória de heap — e os oito backing stores se acumulam junto com
    // os bitmaps de origem.
    //
    // Num celular isso estoura o teto do renderizador. Ele morre, o navegador
    // recarrega a aba, e a pessoa perde as fotos que tinha escolhido. Era o
    // sintoma da Issue #53, e explica por que UMA foto sempre funcionou e
    // duas ou mais não.
    //
    // Zerar as dimensões descarta o backing store na hora. É feio e é a forma
    // suportada de fazer isso — não existe `canvas.dispose()`.
    if (canvas) {
      canvas.width = 0;
      canvas.height = 0;
    }
  }
}
