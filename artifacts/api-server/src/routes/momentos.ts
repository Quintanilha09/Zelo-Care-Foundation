/**
 * Momentos do paciente — QUI-7 (projeto ZELO — Momentos).
 *
 *   GET /api/patients/:patientId/momentos   o mural, mais novos primeiro
 *
 * ── O que este recurso é ──────────────────────────────────────────────────
 *
 * É o primeiro recurso do ZELO que não é sobre remédio. Todo o resto do
 * produto responde *"a dose foi tomada?"*. Este responde outra pergunta:
 * **"como ela está?"** Um filho em outra cidade abre o app e vê a mãe.
 *
 * ── O que ele NÃO é, e isso é regra ───────────────────────────────────────
 *
 * **Não é rede social.** Sem contagem, sem "5 momentos esta semana", sem
 * feed infinito. A resposta daqui não tem total, não tem streak, não tem
 * nada que possa virar placar (CON-012).
 *
 * **Não interpreta ninguém.** Nenhuma análise automática de imagem, humor
 * ou expressão — seria interpretar a condição de uma pessoa, e cruza a
 * fronteira das CON-004 e CON-005. O app mostra a foto; quem lê a foto é
 * quem ama a pessoa.
 *
 * **Não cobra do cuidador.** A resposta nunca diz "faz X dias sem foto"
 * (CON-011). Mural vazio é mural vazio, e está tudo bem.
 *
 * ── Envio e exclusão não estão aqui ───────────────────────────────────────
 *
 * Publicar é `POST /api/media` e apagar é `DELETE /api/media/:id`, os dois
 * da QUI-5. Este arquivo é só a leitura do mural — a lista com autor,
 * horário e legenda, que é o que a QUI-5 deliberadamente não tinha.
 */

import { Router } from "express";
import { and, desc, eq, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { mediaAssetsTable, caregiversTable, patientsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { gerarTokenDeMidia } from "../lib/media-links.ts";
import { lerEstadoDoConsentimento } from "../lib/image-consent.ts";
import { DIAS_DE_RETENCAO } from "../lib/media-cleanup.ts";
import { lerCoracoesEmLote } from "../lib/coracoes.ts";

const router = Router();

/**
 * Quantos momentos a lista devolve de uma vez — QUI-18.
 *
 * Antes eram 100 de uma vez, e o motivo declarado era honesto: um teto de
 * sanidade, não paginação. Com o mural em grade (QUI-18) 100 miniaturas são
 * 100 requisições de imagem no primeiro toque, e num 3G isso é a diferença
 * entre "abriu" e "travou".
 *
 * 24 é múltiplo de 3 e de 4, que são as duas larguras de coluna da grade —
 * ou seja, a última fileira nunca chega pela metade.
 *
 * **Isto não é feed infinito.** A página seguinte só vem quando alguém pede,
 * num botão. O mural não puxa sozinho enquanto a pessoa rola, porque rolagem
 * infinita existe para prender, e este produto não quer prender ninguém.
 */
const TAMANHO_DA_PAGINA = 24;
const TETO_DA_PAGINA = 60;

/**
 * O cursor: o instante e o id do último momento já entregue.
 *
 * Precisa dos dois. Só `createdAt` perderia (ou repetiria) momentos
 * publicados no mesmo instante — o que acontece de verdade quando alguém
 * envia três fotos de uma vez —, e é o mesmo par que já ordena a consulta.
 *
 * Formato `<iso>|<id>`. Legível de propósito: cursor opaco esconde de quem
 * depura, e não há nada aqui que valha esconder — quem tem o cursor já tem
 * a resposta que o continha.
 */
function lerCursor(bruto: unknown): { instante: Date; id: number } | null {
  if (typeof bruto !== "string" || bruto.length === 0) return null;
  const [iso, id] = bruto.split("|");
  const instante = new Date(iso ?? "");
  const numero = Number(id);
  if (Number.isNaN(instante.getTime()) || !Number.isSafeInteger(numero) || numero <= 0) return null;
  return { instante, id: numero };
}

/** Quantos itens pedir, respeitando o teto. Entrada inválida cai no padrão. */
function lerLimite(bruto: unknown): number {
  const numero = Number(bruto);
  if (!Number.isSafeInteger(numero) || numero < 1) return TAMANHO_DA_PAGINA;
  return Math.min(numero, TETO_DA_PAGINA);
}

router.get<{ patientId: string }>("/patients/:patientId/momentos", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (!Number.isSafeInteger(patientId) || patientId <= 0) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  const auth = getAuth(req);

  // Busca paciente e vínculo de família na mesma consulta: se não pertence à
  // família, some — 404, nunca 403 (CON-014).
  const [paciente] = await db
    .select({ id: patientsTable.id, name: patientsTable.name, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, auth.familyId)))
    .limit(1);

  if (!paciente) {
    res.status(404).json({ error: "Recurso não encontrado" });
    return;
  }

  // Sem consentimento, a seção NÃO EXISTE na tela (QUI-6). A resposta diz
  // isso explicitamente para o cliente não renderizar nada — em vez de
  // mostrar um mural cinza com cadeado, que é convite a insistir.
  const consentimento = await lerEstadoDoConsentimento(patientId);
  if (!consentimento.consentido) {
    res.json({
      consentido: false,
      podeDecidirConsentimento: auth.role === "primary_caregiver",
      timezone: paciente.timezone,
      momentos: [],
    });
    return;
  }

  const cursor = lerCursor(req.query.cursor);
  const limite = lerLimite(req.query.limite);

  // Um a mais do que o pedido: é assim que se sabe que HÁ próxima página sem
  // uma segunda consulta de contagem — e sem contagem nenhuma vazar para a
  // resposta, que é regra aqui (CON-012).
  const linhas = await db
    .select({
      id: mediaAssetsTable.id,
      kind: mediaAssetsTable.kind,
      caption: mediaAssetsTable.caption,
      createdAt: mediaAssetsTable.createdAt,
      keptAt: mediaAssetsTable.keptAt,
      autorId: mediaAssetsTable.uploadedByCaregiverId,
    })
    .from(mediaAssetsTable)
    .where(
      and(
        eq(mediaAssetsTable.patientId, patientId),
        eq(mediaAssetsTable.familyId, auth.familyId),
        // Comparação do PAR (instante, id), na mesma ordem do `orderBy`.
        // Comparar só o instante perderia — ou repetiria — os momentos
        // enviados no mesmo segundo, que é o caso real de quem manda três
        // fotos de uma vez.
        cursor
          ? or(
              lt(mediaAssetsTable.createdAt, cursor.instante),
              and(eq(mediaAssetsTable.createdAt, cursor.instante), lt(mediaAssetsTable.id, cursor.id))
            )
          : sql`true`
      )
    )
    .orderBy(desc(mediaAssetsTable.createdAt), desc(mediaAssetsTable.id))
    .limit(limite + 1);

  const temMais = linhas.length > limite;
  if (temMais) linhas.pop();

  const ultimo = linhas[linhas.length - 1];
  const proximoCursor = temMais && ultimo
    ? `${ultimo.createdAt.toISOString()}|${ultimo.id}`
    : null;

  // Nomes dos autores numa consulta só. Sem isto seriam N consultas para um
  // mural de 100 fotos.
  const idsDeAutor = [...new Set(linhas.map((l) => l.autorId).filter((id): id is number => id !== null))];
  const autores = idsDeAutor.length > 0
    ? await db
        .select({ id: caregiversTable.id, name: caregiversTable.name })
        .from(caregiversTable)
        .where(inArray(caregiversTable.id, idsDeAutor))
    : [];
  const nomePorId = new Map(autores.map((a) => [a.id, a.name]));

  // QUI-10 — quem reagiu, numa consulta só para o mural inteiro.
  //
  // Nomes, nunca total. Ver lib/coracoes.ts para o porquê, e o teste que
  // falha se algum campo de contagem aparecer nesta resposta.
  const coracoesPorMomento = await lerCoracoesEmLote(linhas.map((l) => l.id), auth.caregiverId);

  res.json({
    consentido: true,
    podeDecidirConsentimento: auth.role === "primary_caregiver",
    // O horário é formatado no fuso DO PACIENTE, não no de quem está olhando:
    // "hoje de manhã" tem que significar a manhã dela. O servidor manda o
    // instante em ISO e o fuso; quem formata é a tela.
    timezone: paciente.timezone,
    // A tela precisa dizer, sem drama, que momentos somem depois de 90 dias.
    diasDeRetencao: DIAS_DE_RETENCAO,
    // QUI-18 — `null` quando acabou. Nunca "faltam N": um total aqui viraria
    // placar do mural, e é exatamente o que este recurso não pode ter.
    proximoCursor,
    momentos: linhas.map((linha) => ({
      id: linha.id,
      kind: linha.kind,
      caption: linha.caption,
      criadoEm: linha.createdAt.toISOString(),
      // QUI-11: guardado nunca expira. Para os demais, a tela mostra quando
      // some — avisar antes é critério de aceite, não gentileza.
      guardado: linha.keptAt !== null,
      expiraEm: linha.keptAt !== null
        ? null
        : new Date(linha.createdAt.getTime() + DIAS_DE_RETENCAO * 86_400_000).toISOString(),
      // Autor nulo = publicado pelo próprio paciente, do aparelho dele
      // (QUI-8). Ainda não acontece, mas a tela já trata.
      autor: linha.autorId !== null ? nomePorId.get(linha.autorId) ?? null : paciente.name,
      url: `/api/media/content/${gerarTokenDeMidia(linha.id).token}`,
      // Quem publicou apaga o seu. O cuidador principal apaga qualquer um.
      // Calculado aqui para a tela não precisar repetir a regra — mas o
      // servidor confere de novo no DELETE: frontend não é fronteira de
      // segurança.
      podeApagar: auth.role === "primary_caregiver" || linha.autorId === auth.caregiverId,
      // QUI-10: nomes de quem reagiu, e se eu sou um deles. Nunca quantos.
      ...(coracoesPorMomento.get(linha.id) ?? { quemReagiu: [], euReagi: false }),
    })),
  });
});

export default router;
