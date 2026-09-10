import { carregarImagem } from "./comprimir-imagem";

/**
 * Recorte quadrado da foto de perfil — Issue #137.
 *
 * ── Por que sempre 1:1, sem oferecer escolha ──────────────────────────────
 *
 * O avatar é círculo em toda tela do ZELO: `h-9` no cabeçalho, `h-12` no
 * cartão dos Ajustes, `h-20` em "Seu perfil". Não existe lugar onde uma foto
 * retangular caiba — oferecer proporção seria dar uma decisão que não muda
 * nada no resultado.
 *
 * ── A armadilha do EXIF, e por que a preparação existe ────────────────────
 *
 * Foto tirada em pé costuma vir com os pixels deitados e uma marca de EXIF
 * dizendo "gire 90°". O `<img>` do navegador aplica essa marca sozinho ao
 * desenhar; um `canvas` alimentado pelo arquivo cru, **não**.
 *
 * Se a tela de recorte mostrasse a foto orientada e o corte lesse o arquivo
 * cru, o quadrado escolhido sairia de um lugar e o corte de outro — o rosto
 * viraria ombro. E só em foto vertical, que é a maioria das fotos de rosto.
 *
 * `prepararParaRecorte` mata a classe inteira: ela **normaliza a orientação
 * uma vez**, produz uma imagem já girada, e é dessa imagem que tanto a tela
 * quanto o corte trabalham. Depois disso não há mais EXIF em lugar nenhum.
 */

/** Menor lado aceito, em pixels do arquivo original. */
export const LADO_MINIMO = 200;

export interface FotoPreparada {
  /** URL da imagem **já orientada** — é o que a tela de recorte mostra. */
  url: string;
  largura: number;
  altura: number;
  /** Sempre chame ao fechar a tela: sem isto o blob fica preso na memória. */
  liberar: () => void;
}

/** Área devolvida pelo `react-easy-crop`, em pixels da imagem preparada. */
export interface AreaDeRecorte {
  x: number;
  y: number;
  width: number;
  height: number;
}

export class FotoPequenaDemais extends Error {
  constructor(readonly menorLado: number) {
    super(
      `Esta foto tem ${menorLado} pixels no lado menor. ` +
        `Escolha uma com pelo menos ${LADO_MINIMO}.`,
    );
    this.name = "FotoPequenaDemais";
  }
}

/**
 * Normaliza a orientação e devolve uma URL para a tela de recorte.
 *
 * Recusa foto pequena demais **antes** de mostrar o recorte: deixar a pessoa
 * escolher o enquadramento de uma imagem de 80px para só então dizer que não
 * serve é fazê-la trabalhar à toa. É a outra metade do "ou pequena" que o
 * fundador relatou.
 */
export async function prepararParaRecorte(arquivo: File): Promise<FotoPreparada> {
  const { fonte, largura, altura, liberar } = await carregarImagem(arquivo);

  try {
    const menorLado = Math.min(largura, altura);
    if (menorLado < LADO_MINIMO) throw new FotoPequenaDemais(menorLado);

    const tela = document.createElement("canvas");
    tela.width = largura;
    tela.height = altura;
    const ctx = tela.getContext("2d");
    if (!ctx) throw new Error("Não conseguimos preparar a foto.");
    ctx.drawImage(fonte, 0, 0);

    const blob = await new Promise<Blob | null>((resolve) =>
      tela.toBlob(resolve, "image/jpeg", 0.92),
    );
    if (!blob) throw new Error("Não conseguimos preparar a foto.");

    const url = URL.createObjectURL(blob);
    return {
      url,
      largura,
      altura,
      liberar: () => {
        URL.revokeObjectURL(url);
        // Zerar a tela devolve o bitmap ao coletor na hora, em vez de deixá-lo
        // preso até a próxima coleta — o mesmo cuidado da QUI/#53.
        tela.width = 0;
        tela.height = 0;
      },
    };
  } finally {
    liberar();
  }
}

/**
 * Corta o quadrado escolhido e devolve um `File` pronto para a compressão.
 *
 * A saída é **quadrada de verdade**, e não um retângulo que o CSS finge ser
 * redondo: o que chega ao servidor é o que a pessoa enquadrou.
 *
 * Recebe a URL da imagem **preparada** (ver acima), nunca o arquivo cru.
 */
export async function recortarQuadrado(
  urlPreparada: string,
  area: AreaDeRecorte,
  nome = "foto-de-perfil.jpg",
): Promise<File> {
  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image();
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error("Não conseguimos recortar a foto."));
    el.src = urlPreparada;
  });

  // O `react-easy-crop` pode devolver a área ligeiramente fora da imagem
  // quando a pessoa arrasta até a borda. Grampear evita um canvas com faixa
  // transparente na lateral do rosto.
  const lado = Math.round(Math.min(area.width, area.height));
  const x = Math.max(0, Math.min(Math.round(area.x), img.naturalWidth - lado));
  const y = Math.max(0, Math.min(Math.round(area.y), img.naturalHeight - lado));

  const tela = document.createElement("canvas");
  tela.width = lado;
  tela.height = lado;
  const ctx = tela.getContext("2d");
  if (!ctx) throw new Error("Não conseguimos recortar a foto.");
  ctx.drawImage(img, x, y, lado, lado, 0, 0, lado, lado);

  const blob = await new Promise<Blob | null>((resolve) =>
    tela.toBlob(resolve, "image/jpeg", 0.92),
  );
  tela.width = 0;
  tela.height = 0;
  if (!blob) throw new Error("Não conseguimos recortar a foto.");

  // JPEG sempre: o recorte já rasterizou tudo, e um PNG de rosto aqui só
  // seria maior. O servidor aceita os três formatos de qualquer forma.
  return new File([blob], nome, { type: "image/jpeg" });
}
