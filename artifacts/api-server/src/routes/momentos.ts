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
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { mediaAssetsTable, caregiversTable, patientsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { gerarTokenDeMidia } from "../lib/media-links.ts";
import { lerEstadoDoConsentimento } from "../lib/image-consent.ts";
import { DIAS_DE_RETENCAO } from "../lib/media-cleanup.ts";

const router = Router();

/**
 * Quantos momentos a lista devolve de uma vez.
 *
 * Não é paginação de rede social — é um teto de sanidade para a resposta
 * não crescer sem limite. Com a retenção de 90 dias da QUI-11, um mural
 * normal cabe folgado aqui.
 */
const TETO_DA_LISTA = 100;

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
    .where(and(eq(mediaAssetsTable.patientId, patientId), eq(mediaAssetsTable.familyId, auth.familyId)))
    .orderBy(desc(mediaAssetsTable.createdAt), desc(mediaAssetsTable.id))
    .limit(TETO_DA_LISTA);

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

  res.json({
    consentido: true,
    podeDecidirConsentimento: auth.role === "primary_caregiver",
    // O horário é formatado no fuso DO PACIENTE, não no de quem está olhando:
    // "hoje de manhã" tem que significar a manhã dela. O servidor manda o
    // instante em ISO e o fuso; quem formata é a tela.
    timezone: paciente.timezone,
    // A tela precisa dizer, sem drama, que momentos somem depois de 90 dias.
    diasDeRetencao: DIAS_DE_RETENCAO,
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
    })),
  });
});

export default router;
