/**
 * Apagar mídia de verdade — QUI-6.
 *
 * "Apagar" aqui significa **remover o objeto do bucket**, não marcar uma
 * linha. Uma revogação de consentimento que deixasse os arquivos no
 * armazenamento não seria revogação nenhuma — seria uma promessa.
 *
 * ── Por que o objeto sai antes da linha ───────────────────────────────────
 *
 * Se apagar o objeto falhar, a linha **continua no banco** e a operação
 * devolve erro. Isso permite tentar de novo, e mantém verdadeira a regra de
 * que toda linha aponta para um arquivo existente.
 *
 * O contrário — apagar a linha primeiro — deixaria um arquivo pessoal órfão
 * no bucket, sem nada apontando para ele. Não é só custo: é dado que alguém
 * pediu para apagar e continuou existindo.
 *
 * ── Quem mais vai usar isto ───────────────────────────────────────────────
 *
 * Este módulo nasce para a revogação de consentimento, mas é o mesmo
 * mecanismo de que precisam a retenção de 90 dias (QUI-11) e a exclusão de
 * dados do titular (REQ-006). Por isso é uma função, não um trecho dentro
 * da rota.
 */

import { and, eq, inArray, isNull, lt, type SQL } from "drizzle-orm";
import { db } from "@workspace/db";
import { mediaAssetsTable } from "@workspace/db";
import { obterArmazenamento, type TipoDeMidia } from "./media-storage.ts";
import { safeLog } from "./safe-logger.ts";
import { Clock } from "./clock.ts";

/**
 * Quantos dias um momento vive sem que ninguém peça para guardar.
 *
 * **Isto é minimização de dado, que a LGPD exige** — guardar foto de uma
 * pessoa vulnerável para sempre, sem motivo, é o oposto do que a lei pede.
 * O custo cair junto é consequência, não motivo.
 */
export const DIAS_DE_RETENCAO = 90;

export interface ResultadoDaLimpeza {
  /** Quantas mídias foram apagadas, objeto e linha. */
  apagadas: number;
  /** Quantas falharam ao apagar o objeto — as linhas dessas continuam no banco. */
  falhas: number;
}

/**
 * Apaga as mídias de um paciente, opcionalmente restritas a certos tipos.
 *
 * `tipos` vazio ou omitido apaga tudo. A revogação de consentimento de
 * imagem passa `["image", "video"]` — áudio não é coberto por esse
 * consentimento e não pode ser apagado por ele.
 */
export async function apagarMidiasDoPaciente(
  patientId: number,
  tipos?: readonly TipoDeMidia[]
): Promise<ResultadoDaLimpeza> {
  const filtroDeTipo = tipos && tipos.length > 0
    ? inArray(mediaAssetsTable.kind, [...tipos])
    : undefined;

  return apagarPorFiltro(and(eq(mediaAssetsTable.patientId, patientId), filtroDeTipo));
}

/**
 * Apaga TODA a mídia de uma família.
 *
 * Existe para a exclusão de dados do titular (REQ-006). O `onDelete:
 * "cascade"` da tabela derruba as linhas quando a família some — mas
 * **não toca no bucket**. Sem esta função, apagar a conta deixaria as fotos
 * da pessoa no armazenamento para sempre, sem nada apontando para elas.
 *
 * Chamar ANTES do delete da família: depois, não há mais linha para saber
 * quais objetos apagar.
 */
export async function apagarMidiasDaFamilia(familyId: number): Promise<ResultadoDaLimpeza> {
  return apagarPorFiltro(eq(mediaAssetsTable.familyId, familyId));
}

/**
 * Expurgo por idade — QUI-11.
 *
 * Apaga o que passou de `DIAS_DE_RETENCAO` **e não foi marcado para
 * guardar**. Idempotente por construção: rodar duas vezes na sequência não
 * acha nada na segunda, porque a primeira já apagou as linhas.
 */
export async function apagarMidiasVencidas(): Promise<ResultadoDaLimpeza> {
  const corte = new Date(Clock.now().getTime() - DIAS_DE_RETENCAO * 86_400_000);
  return apagarPorFiltro(
    and(lt(mediaAssetsTable.createdAt, corte), isNull(mediaAssetsTable.keptAt))
  );
}

async function apagarPorFiltro(filtro: SQL | undefined): Promise<ResultadoDaLimpeza> {
  const alvos = await db
    .select({ id: mediaAssetsTable.id, objectKey: mediaAssetsTable.objectKey })
    .from(mediaAssetsTable)
    .where(filtro);

  if (alvos.length === 0) return { apagadas: 0, falhas: 0 };

  const armazenamento = obterArmazenamento();
  const removidos: number[] = [];
  let falhas = 0;

  for (const alvo of alvos) {
    if (armazenamento) {
      try {
        await armazenamento.apagar(alvo.objectKey);
      } catch (err) {
        // Uma falha não aborta as outras: apagar 9 de 10 é melhor que 0 de 10.
        // A linha da que falhou fica, e uma nova tentativa a pega.
        falhas += 1;
        safeLog.error({ action: "media_purge_object_failed", err }, "Falha ao apagar objeto de midia");
        continue;
      }
    }
    removidos.push(alvo.id);
  }

  if (removidos.length > 0) {
    await db.delete(mediaAssetsTable).where(inArray(mediaAssetsTable.id, removidos));
  }

  return { apagadas: removidos.length, falhas };
}
