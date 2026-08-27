/**
 * Quem reagiu a um momento — QUI-10.
 *
 * ── A regra que este arquivo existe para não deixar escapar ───────────────
 *
 * **Mostra QUEM, nunca QUANTOS.**
 *
 * Nada aqui devolve total, e não é esquecimento: contar é uma linha de SQL,
 * e é exatamente por isso que a disciplina precisa morar no formato da
 * resposta. Um campo `total` no JSON viraria número na tela, número na tela
 * vira comparação entre fotos, e comparação entre fotos transforma o mural
 * num placar de engajamento (CON-012).
 *
 * A tela pode até saber o tamanho da lista — `quemReagiu.length` existe em
 * JavaScript. A diferença é que ninguém precisou decidir mostrar isso: o
 * caminho fácil é escrever os nomes, que é o comportamento certo.
 *
 * ── Por que em lote ───────────────────────────────────────────────────────
 *
 * O mural devolve até 100 momentos. Uma consulta por momento seriam 100
 * idas ao banco para abrir uma seção — daí `lerCoracoesEmLote`.
 */
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { mediaReactionsTable, caregiversTable } from "@workspace/db";

export interface Coracoes {
  /** Nomes de quem reagiu, em ordem de chegada. Nunca um número. */
  quemReagiu: string[];
  /** Se quem está pedindo já reagiu — é o que deixa o botão preenchido. */
  euReagi: boolean;
}

const VAZIO: Coracoes = { quemReagiu: [], euReagi: false };

/** As reações de vários momentos de uma vez. Chave é o id da mídia. */
export async function lerCoracoesEmLote(
  mediaAssetIds: number[],
  meuCaregiverId: number
): Promise<Map<number, Coracoes>> {
  const mapa = new Map<number, Coracoes>();
  if (mediaAssetIds.length === 0) return mapa;

  const linhas = await db
    .select({
      mediaAssetId: mediaReactionsTable.mediaAssetId,
      caregiverId: mediaReactionsTable.caregiverId,
      nome: caregiversTable.name,
      criadoEm: mediaReactionsTable.createdAt,
    })
    .from(mediaReactionsTable)
    .innerJoin(caregiversTable, eq(caregiversTable.id, mediaReactionsTable.caregiverId))
    .where(inArray(mediaReactionsTable.mediaAssetId, mediaAssetIds))
    .orderBy(mediaReactionsTable.createdAt, mediaReactionsTable.id);

  for (const linha of linhas) {
    const atual = mapa.get(linha.mediaAssetId) ?? { quemReagiu: [], euReagi: false };
    atual.quemReagiu.push(linha.nome);
    if (linha.caregiverId === meuCaregiverId) atual.euReagi = true;
    mapa.set(linha.mediaAssetId, atual);
  }

  return mapa;
}

/** As reações de UM momento. Atalho sobre o lote, para a rota do botão. */
export async function lerCoracoes(
  mediaAssetId: number,
  meuCaregiverId: number
): Promise<Coracoes> {
  const mapa = await lerCoracoesEmLote([mediaAssetId], meuCaregiverId);
  return mapa.get(mediaAssetId) ?? { ...VAZIO, quemReagiu: [] };
}
