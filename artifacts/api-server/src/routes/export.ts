import { getAuth } from "../lib/auth-types.ts";
/**
 * Exportação de dados — ZELO.
 * POST /api/export                      — gera snapshot e retorna link de download
 * GET  /api/export/download/:rawToken   — download autenticado pelo token (uso único)
 *
 * REGRAS:
 * - Link expira em 1 hora após geração
 * - Link é de uso único — após download marca como usado
 * - Nunca por e-mail com anexo — apenas download direto
 * - Audit log registra que a exportação aconteceu (sem conteúdo)
 */

import { Router } from "express";
import { eq, and, gt, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  exportTokensTable,
  patientsTable,
  treatmentsTable,
  scheduledDosesTable,
  doseRecordsTable,
  appointmentsTable,
  healthMeasurementsTable,
  medicationsTable,
  usersTable,
  familiesTable,
  caregiversTable,
  consentRecordsTable,
  mediaAssetsTable,
  mediaReactionsTable,
  notificationPreferencesTable,
} from "@workspace/db";
import { generateOneTimeToken, hashToken } from "../lib/tokens";
import { requireAuth } from "../middleware/require-auth";
import { publicTokenLimiter } from "../lib/rate-limit";
import { audit } from "../lib/audit";
import { safeLog } from "../lib/safe-logger";
import { Clock } from "../lib/clock";
import { gerarPdfDaExportacao } from "../lib/export-pdf.ts";

const router = Router();

// ── Gera snapshot e retorna link de download ──────────────────────────────

router.post("/export", requireAuth, async (req, res): Promise<void> => {
  const familyId = getAuth(req).familyId;

  // Coleta todos os dados da família
  const patients = await db
    .select()
    .from(patientsTable)
    .where(eq(patientsTable.familyId, familyId));

  const patientIds = patients.map((p) => p.id);

  // ── O defeito que ficou aqui até a QUI-17 ────────────────────────────────
  //
  // Isto era `eq(..., pid0)`, com `pid0 = patientIds[0]`. O comentário
  // original até dizia "inAny" — a intenção estava escrita, a implementação
  // não. Numa família com mais de um paciente, **só o primeiro saía com
  // dados**: os demais vinham com `treatments: []`, `doseRecords: []`, e por
  // aí. E como a exportação é o direito do titular de levar os próprios
  // dados embora, ela mentia calada.
  //
  // Não dava para ver pela tela porque não havia tela: a rota existia,
  // testada, e nada no app a chamava.
  //
  // O `-1` continua sendo necessário — `inArray` com lista vazia não gera
  // SQL válido, e uma família sem paciente é um caso real (conta nova).
  const alvos = patientIds.length > 0 ? patientIds : [-1];
  const [treatments, doses, records, appointments, measurements, medications] =
    await Promise.all([
      db.select().from(treatmentsTable).where(inArray(treatmentsTable.patientId, alvos)),
      db.select().from(scheduledDosesTable).where(inArray(scheduledDosesTable.patientId, alvos)),
      db.select().from(doseRecordsTable).where(inArray(doseRecordsTable.patientId, alvos)),
      db.select().from(appointmentsTable).where(inArray(appointmentsTable.patientId, alvos)),
      db.select().from(healthMeasurementsTable).where(inArray(healthMeasurementsTable.patientId, alvos)),
      db.select().from(medicationsTable).where(eq(medicationsTable.familyId, familyId)),
    ]);

  // ── O que faltava até a Issue #48 ────────────────────────────────────────
  //
  // O pacote afirmava, na própria `_note`, ser "exportação de dados pessoais
  // conforme solicitação LGPD" — e não continha os dados pessoais de quem o
  // pediu. Saíam `userId: 169` e `caregiverId: 196`, e nada de nome, e-mail,
  // consentimento ou mídia. Afirmar conformidade e não entregá-la é pior do
  // que não afirmar nada.
  //
  // Tudo continua recortado pela família do JWT. Nenhum id vem da requisição —
  // é o invariante 2 aplicado a recursos que não são paciente.
  const [conta, familia, cuidadores, consentimentos, midias, preferencias] =
    await Promise.all([
      db.select().from(usersTable).where(eq(usersTable.id, getAuth(req).userId)).limit(1),
      db.select().from(familiesTable).where(eq(familiesTable.id, familyId)).limit(1),
      db.select().from(caregiversTable).where(eq(caregiversTable.familyId, familyId)),
      db
        .select()
        .from(consentRecordsTable)
        .where(eq(consentRecordsTable.userId, getAuth(req).userId)),
      db.select().from(mediaAssetsTable).where(eq(mediaAssetsTable.familyId, familyId)),
      db
        .select()
        .from(notificationPreferencesTable)
        .where(eq(notificationPreferencesTable.caregiverId, getAuth(req).caregiverId)),
    ]);

  // Reações só das mídias desta família — nunca varredura da tabela inteira.
  // Mesmo motivo do `-1` acima: `inArray` vazio não gera SQL válido.
  const midiaIds = midias.length > 0 ? midias.map((m) => m.id) : [-1];
  const reacoes = await db
    .select()
    .from(mediaReactionsTable)
    .where(inArray(mediaReactionsTable.mediaAssetId, midiaIds));

  const eu = conta[0];

  const snapshot = JSON.stringify({
    exportDate: Clock.now().toISOString(),
    exportedBy: { userId: getAuth(req).userId, caregiverId: getAuth(req).caregiverId },
    familyId,

    // A conta de quem pediu. `passwordHash` fica de fora: hash de senha é
    // credencial interna de autenticação, não dado pessoal do titular.
    conta: eu
      ? {
          id: eu.id,
          nome: eu.name,
          email: eu.email,
          emailVerificado: eu.emailVerified,
          situacao: eu.status,
          criadaEm: eu.createdAt,
        }
      : null,

    familia: familia[0]
      ? {
          id: familia[0].id,
          nome: familia[0].name,
          criadaEm: familia[0].createdAt,
          janelaRetroativaHoras: familia[0].retroactiveWindowHours,
          mostrarMedicamentoNoAviso: familia[0].showMedicationInPush,
          silencioNoturno: {
            ativo: familia[0].quietHoursEnabled,
            inicio: familia[0].quietHoursStart,
            fim: familia[0].quietHoursEnd,
          },
        }
      : null,

    // Os OUTROS cuidadores saem sem e-mail, de propósito.
    //
    // Portabilidade é o direito de levar embora os SEUS dados. O e-mail de
    // outra pessoa é dado dela, não de quem pediu a exportação — e qualquer
    // cuidador da família pode chamar esta rota. Nome e papel ficam porque
    // sem eles o resto do pacote não se lê: `caregiverId: 196` não diz quem
    // registrou a dose.
    cuidadores: cuidadores.map((c) => ({
      id: c.id,
      nome: c.name,
      papel: c.role,
      criadoEm: c.createdAt,
      ehVoce: c.id === getAuth(req).caregiverId,
      ...(c.id === getAuth(req).caregiverId ? { email: c.email } : {}),
    })),

    // O registro mais importante do pacote: é o que legitima o tratamento de
    // dado de saúde (art. 11 da LGPD). Sem ele o resto fica sem base legal
    // visível.
    consentimentos: consentimentos.map((c) => ({
      tipo: c.consentType,
      concedido: c.consentGiven,
      dadoPor: c.givenBy,
      pacienteId: c.patientId,
      versao: c.version,
      registradoEm: c.createdAt,
    })),

    patients: patients.map((p) => ({
      ...p,
      treatments: treatments.filter((t) => t.patientId === p.id),
      scheduledDoses: doses.filter((d) => d.patientId === p.id),
      doseRecords: records.filter((r) => r.patientId === p.id),
      appointments: appointments.filter((a) => a.patientId === p.id),
      healthMeasurements: measurements.filter((m) => m.patientId === p.id),
      // Momentos: metadado e legenda. O arquivo em si não vai no pacote —
      // ver `_midia` no fim. `objectKey` também fica de fora: é o caminho
      // interno no armazenamento, detalhe de implementação e não dado do
      // titular.
      momentos: midias
        .filter((m) => m.patientId === p.id)
        .map((m) => ({
          id: m.id,
          tipo: m.kind,
          legenda: m.caption,
          tamanhoBytes: m.sizeBytes,
          tipoDoArquivo: m.mimeType,
          publicadoPorCuidadorId: m.uploadedByCaregiverId,
          guardadoEm: m.keptAt,
          publicadoEm: m.createdAt,
          coracoesDeCuidadorId: reacoes
            .filter((r) => r.mediaAssetId === m.id)
            .map((r) => r.caregiverId),
        })),
    })),
    medications,

    // Escolha da pessoa sobre como é avisada. São as preferências de QUEM
    // pediu — as dos outros cuidadores são dado deles.
    preferenciasDeNotificacao: preferencias.map((n) => ({
      pacienteId: n.patientId,
      categoria: n.category,
      ativa: n.enabled,
      atualizadaEm: n.updatedAt,
    })),

    _note: "Exportação de dados pessoais conforme solicitação LGPD.",
    _midia:
      "Fotos e áudios entram como metadado e legenda, não como arquivo. Pedir os arquivos originais é possível — fale com o suporte. Dito aqui em vez de omitido em silêncio.",
    _fora:
      "Ficam de fora, de propósito: hash de senha, tokens de sessão e o e-mail dos outros cuidadores. Os dois primeiros são credencial interna, não dado seu; o terceiro é dado de outra pessoa.",
  }, null, 2);

  // ── DOIS tokens, um por formato — Issue #49 ─────────────────────────────
  //
  // O link é de uso único. Com um token só para os dois formatos, baixar o
  // PDF mataria o JSON — e a pessoa que quisesse conferir os dois teria de
  // gerar a exportação duas vezes.
  //
  // Dois tokens custam uma linha a mais na tabela e resolvem: cada um morre
  // no próprio uso, os dois expiram na mesma hora, e o formato vem da URL,
  // sem precisar de coluna nova.
  const { raw, hash } = generateOneTimeToken();
  const { raw: rawPdf, hash: hashPdf } = generateOneTimeToken();
  const expiresAt = new Date(Clock.now().getTime() + 60 * 60 * 1000); // 1 hora

  await db.insert(exportTokensTable).values([
    { userId: getAuth(req).userId, familyId, tokenHash: hash, expiresAt, snapshot },
    { userId: getAuth(req).userId, familyId, tokenHash: hashPdf, expiresAt, snapshot },
  ]);

  await audit({
    familyId,
    entityType: "data_export",
    entityId: hash.slice(0, 16),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });
  safeLog.info({ action: "export_created", familyId }, "Exportação de dados gerada");

  res.json({
    downloadUrl: `/api/export/download/${raw}`,
    // O PDF é a versão para LER; o JSON, a versão para IMPORTAR. As duas
    // são portabilidade, e trocar uma pela outra perderia metade dela.
    downloadUrlPdf: `/api/export/download/${rawPdf}?formato=pdf`,
    expiresAt,
    patientCount: patients.length,
  });
});

// ── Download autenticado (uso único) ─────────────────────────────────────

router.get<{ rawToken: string }>("/export/download/:rawToken", publicTokenLimiter, async (req, res): Promise<void> => {
  const { rawToken } = req.params;
  const tokenHash = hashToken(rawToken);

  const [exportRecord] = await db
    .select()
    .from(exportTokensTable)
    .where(
      and(
        eq(exportTokensTable.tokenHash, tokenHash),
        eq(exportTokensTable.downloaded, false),
        gt(exportTokensTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!exportRecord || !exportRecord.snapshot) {
    res.status(404).json({ error: "Link inválido, expirado ou já utilizado" });
    return;
  }

  // Marca como usado antes de enviar (evita race condition)
  await db.update(exportTokensTable)
    .set({ downloaded: true, downloadedAt: Clock.now() })
    .where(eq(exportTokensTable.id, exportRecord.id));

  const dia = Clock.now().toISOString().slice(0, 10);

  // O formato vem da URL, não do banco: o token diz QUEM pode baixar, a
  // query diz COMO. Evita uma coluna nova para uma informação que já cabe
  // no link que o próprio servidor montou.
  if (req.query.formato === "pdf") {
    const pdf = await gerarPdfDaExportacao(exportRecord.snapshot);
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="zelo-seus-dados-${dia}.pdf"`);
    res.send(pdf);
    return;
  }

  res.setHeader("Content-Type", "application/json");
  res.setHeader("Content-Disposition", `attachment; filename="zelo-export-${dia}.json"`);
  res.send(exportRecord.snapshot);
});

export default router;
