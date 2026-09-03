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

/**
 * Lado maior da MINIATURA de prévia — Issue #53.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PRÉVIA PRECISA DE UM ARQUIVO PRÓPRIO, E É POR ISSO QUE A ABA MORRIA.
 *
 * A prévia mostrava o arquivo de 1600px dentro de uma miniatura de ~90px na
 * tela. O CSS encolhe o **desenho**; o navegador continua **decodificando no
 * tamanho natural** — 1600 × 1200 × 4 bytes = **7,7 MB de bitmap por prévia**,
 * residentes enquanto a imagem estiver na tela.
 *
 * Seis fotos escolhidas = ~46 MB só de prévias, além da compressão em curso.
 * Num celular, o renderizador estoura: a aba morre, o navegador recarrega, e a
 * pessoa volta para a ficha do paciente sem foto nenhuma e **sem mensagem de
 * erro** — porque o JavaScript morreu junto e não teve como avisar.
 *
 * Era a assinatura exata do relato: cinco funcionava, seis não.
 *
 * Com 240px, a mesma prévia decodifica em ~230 KB. Seis delas somam 1,4 MB no
 * lugar de 46 MB.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export const LADO_DA_MINIATURA = 240;

export interface FotoComprimida {
  /** O que vai para o servidor: 1600px. */
  arquivo: File;
  /**
   * O que a tela mostra enquanto a foto espera para subir. **Nunca use
   * `arquivo` numa `<img>` de prévia** — ver `LADO_DA_MINIATURA`.
   */
  miniatura: Blob;
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

  try {
    const grande = await desenhar(fonte, largura, altura, LADO_MAXIMO, QUALIDADE);
    if (!grande.blob) throw new Error("Não conseguimos preparar a foto para envio.");

    // A miniatura sai do MESMO bitmap já carregado: desenhar duas vezes custa
    // milissegundos, e é o que evita a prévia decodificar 7,7 MB por foto.
    const mini = await desenhar(fonte, largura, altura, LADO_DA_MINIATURA, 0.7);
    // Se a miniatura falhar, a prévia cai no arquivo grande: pior para a
    // memória, melhor que a tela ficar sem imagem nenhuma.
    const miniatura = mini.blob ?? grande.blob;

    // Recomprimir nem sempre encolhe. Quando não encolhe, o original vence —
    // e o original mantém o formato que o usuário escolheu.
    if (grande.blob.size >= arquivo.size) {
      return {
        arquivo,
        miniatura,
        bytesAntes: arquivo.size,
        bytesDepois: arquivo.size,
        largura,
        altura,
      };
    }

    return {
      arquivo: new File([grande.blob], "momento.jpg", { type: "image/jpeg" }),
      miniatura,
      bytesAntes: arquivo.size,
      bytesDepois: grande.blob.size,
      largura: grande.largura,
      altura: grande.altura,
    };
  } finally {
    liberar();
  }
}

/**
 * Desenha a imagem num canvas do tamanho pedido e devolve o JPEG.
 *
 * ── Por que isto virou função própria ─────────────────────────────────────
 *
 * O canvas é criado, usado e **solto aqui dentro**. Antes havia um canvas só,
 * e soltá-lo era responsabilidade do `finally` lá de cima; com dois desenhos
 * (o de envio e o da miniatura), essa responsabilidade se duplicaria — e a
 * segunda cópia é a que alguém esquece.
 */
async function desenhar(
  fonte: CanvasImageSource,
  largura: number,
  altura: number,
  ladoMaximo: number,
  qualidade: number,
): Promise<{ blob: Blob | null; largura: number; altura: number }> {
  const escala = Math.min(1, ladoMaximo / Math.max(largura, altura));
  const novaLargura = Math.round(largura * escala);
  const novaAltura = Math.round(altura * escala);

  const tela = document.createElement("canvas");
  try {
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
      tela.toBlob(resolve, "image/jpeg", qualidade);
    });
    return { blob, largura: novaLargura, altura: novaAltura };
  } finally {
    // ── Soltar o canvas na mão, e não esperar o coletor — Issue #53 ───────
    //
    // Um canvas de 1600×1200 guarda ~7,7 MB de pixels, e essa memória **não é
    // do JavaScript**: vive no processo do navegador e só sai quando o objeto
    // é coletado. Num laço que comprime oito fotos seguidas, o coletor não
    // roda entre as voltas — não tem por que rodar, já que sobra heap — e os
    // backing stores se acumulam.
    //
    // Zerar as dimensões descarta o backing store na hora. É feio, e é a forma
    // suportada de fazer isso: não existe `canvas.dispose()`.
    tela.width = 0;
    tela.height = 0;
  }
}
