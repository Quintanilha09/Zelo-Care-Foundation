/**
 * Acesso do paciente ao próprio aparelho — ZELO-58.
 *
 * Duas famílias de rota, com autenticação diferente:
 *
 *   CUIDADOR (requirePrimaryCaregiver) — gera o link, lista os aparelhos,
 *   revoga. Quem decide se o paciente tem acesso é sempre quem cuida.
 *
 *   PACIENTE (requirePatientAccess) — EXATAMENTE três rotas: ver a dose de
 *   agora, registrar que tomou, e (QUI-8) mandar um recado. É o escopo
 *   mínimo pra tela do modo idoso funcionar, e nada além disso existe pra
 *   esse token alcançar.
 *
 *   A terceira nasceu na QUI-8 e é o que justifica retroativamente este
 *   desenho: o modo idoso deixa de ser só uma tela grande de "Tomei" e passa
 *   a ter uma razão AFETIVA para a pessoa abrir o aplicativo.
 *
 * A rota de ativação é a única pública: ela recebe o token do link (que o
 * paciente tem em mãos) e o troca por um token de dispositivo. Mesmo padrão
 * do aceite de convite de cuidador.
 */
import { getAuth } from "../lib/auth-types.ts";
import { Router } from "express";
import { eq, and, gte, lte, desc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import {
  patientAccessTokensTable, patientsTable, scheduledDosesTable,
  treatmentsTable, medicationsTable, doseRecordsTable, caregiversTable,
} from "@workspace/db";
import { requirePrimaryCaregiver } from "../middleware/require-auth";
import { requirePatientAccess, getPatientAccess } from "../middleware/require-patient-access.ts";
import { receberArquivo } from "../middleware/receber-arquivo.ts";
import { guardarMidia } from "../lib/media-upload.ts";
import { mediaUploadLimiter } from "../lib/rate-limit";
import { generateOneTimeToken, hashToken } from "../lib/tokens";
import { Clock } from "../lib/clock";
import { localDayBoundsUtc } from "@workspace/scheduling";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { boss, QUEUE_DOSE_TAKEN, ensureQueueStarted } from "../lib/queue.ts";
import { publishPatientEvent } from "../lib/realtime.ts";
import { publicTokenLimiter } from "../lib/rate-limit";

const router = Router();

/** O link de ativação vive pouco: é mandado por WhatsApp, e um link de
 *  acesso a dado de saúde não deveria ficar válido num histórico de
 *  conversa por dias. Depois de ativado, o token de dispositivo assume. */
const ACTIVATION_TTL_MS = 24 * 60 * 60 * 1000;

/** Rótulo curto do aparelho, só pro cuidador reconhecer qual é qual na
 *  lista. Nunca identifica pessoa — é uma leitura grosseira do user-agent. */
function deviceLabelFrom(userAgent: string | undefined): string {
  if (!userAgent) return "Aparelho";
  if (/iPhone/i.test(userAgent)) return "iPhone";
  if (/iPad/i.test(userAgent)) return "iPad";
  if (/Android/i.test(userAgent)) return "Celular Android";
  if (/Windows|Macintosh|Linux/i.test(userAgent)) return "Computador";
  return "Aparelho";
}

// ── CUIDADOR: gerar o link de acesso ──────────────────────────────────────

router.post("/patients/:patientId/access-link", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const familyId = getAuth(req).familyId;
  const [patient] = await db
    .select({ id: patientsTable.id, name: patientsTable.name, elderModeEnabled: patientsTable.elderModeEnabled })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // O acesso do paciente é a forma de usar o modo idoso — não faz sentido
  // existir com o modo desligado, e ligar por engano confundiria o cuidador.
  if (!patient.elderModeEnabled) {
    res.status(400).json({
      error: "Ligue o modo idoso deste paciente antes de enviar o acesso.",
      code: "ELDER_MODE_DISABLED",
    });
    return;
  }

  const { raw, hash } = generateOneTimeToken();
  const [created] = await db.insert(patientAccessTokensTable).values({
    patientId,
    familyId,
    tokenHash: hash,
    status: "pending",
    expiresAt: new Date(Clock.now().getTime() + ACTIVATION_TTL_MS),
    createdByCaregiverId: getAuth(req).caregiverId,
  }).returning({ id: patientAccessTokensTable.id });

  safeLog.info({ action: "created", entityType: "patient_access", familyId }, "Link de acesso do paciente gerado");
  await audit({
    familyId, entityType: "patient", entityId: String(patientId), action: "updated",
    actorId: String(getAuth(req).caregiverId), actorType: "caregiver", ipAddress: req.ip,
    diff: JSON.stringify({ patientAccessLinkCreated: created.id }),
  });

  // O token cru só existe nesta resposta — o banco tem só o hash.
  res.status(201).json({
    accessId: created.id,
    activationPath: `/acesso?token=${raw}`,
    patientName: patient.name,
    expiresInHours: ACTIVATION_TTL_MS / 3_600_000,
  });
});

// ── CUIDADOR: listar e revogar aparelhos ──────────────────────────────────

router.get("/patients/:patientId/access", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const familyId = getAuth(req).familyId;
  const [patient] = await db
    .select({ id: patientsTable.id })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const rows = await db
    .select({
      id: patientAccessTokensTable.id,
      status: patientAccessTokensTable.status,
      deviceLabel: patientAccessTokensTable.deviceLabel,
      activatedAt: patientAccessTokensTable.activatedAt,
      lastUsedAt: patientAccessTokensTable.lastUsedAt,
      expiresAt: patientAccessTokensTable.expiresAt,
      createdAt: patientAccessTokensTable.createdAt,
      createdByName: caregiversTable.name,
    })
    .from(patientAccessTokensTable)
    .leftJoin(caregiversTable, eq(patientAccessTokensTable.createdByCaregiverId, caregiversTable.id))
    .where(and(
      eq(patientAccessTokensTable.patientId, patientId),
      eq(patientAccessTokensTable.familyId, familyId)
    ))
    .orderBy(desc(patientAccessTokensTable.createdAt));

  // Nunca devolve tokenHash — não serve pra nada no cliente e é material
  // sensível mesmo sendo hash.
  res.json(rows);
});

router.delete("/patients/:patientId/access/:accessId", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const accessId = Number(req.params.accessId);
  if (isNaN(patientId) || isNaN(accessId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const familyId = getAuth(req).familyId;
  const [revoked] = await db
    .update(patientAccessTokensTable)
    .set({ status: "revoked", revokedAt: Clock.now() })
    .where(and(
      eq(patientAccessTokensTable.id, accessId),
      eq(patientAccessTokensTable.patientId, patientId),
      eq(patientAccessTokensTable.familyId, familyId)
    ))
    .returning({ id: patientAccessTokensTable.id });

  if (!revoked) { res.status(404).json({ error: "Acesso não encontrado" }); return; }

  await audit({
    familyId, entityType: "patient", entityId: String(patientId), action: "updated",
    actorId: String(getAuth(req).caregiverId), actorType: "caregiver", ipAddress: req.ip,
    diff: JSON.stringify({ patientAccessRevoked: accessId }),
  });

  res.json({ revoked: true });
});

// ── PÚBLICO: ativar o acesso no aparelho do paciente ──────────────────────
// Única rota pública daqui. Recebe o token do LINK e devolve um token de
// DISPOSITIVO — o do link deixa de valer no mesmo movimento (uso único).

const ActivateBody = z.object({ token: z.string().min(1) });

router.post("/patient-access/activate", publicTokenLimiter, async (req, res): Promise<void> => {
  const body = ActivateBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Link inválido." }); return; }

  const [row] = await db
    .select({
      id: patientAccessTokensTable.id,
      patientId: patientAccessTokensTable.patientId,
      status: patientAccessTokensTable.status,
      expiresAt: patientAccessTokensTable.expiresAt,
    })
    .from(patientAccessTokensTable)
    .where(eq(patientAccessTokensTable.tokenHash, hashToken(body.data.token)))
    .limit(1);

  // Mensagem única pros três casos (não existe / já usado / expirado): o
  // paciente não tem o que fazer com a distinção, e ela ajudaria alguém
  // tentando adivinhar link.
  const invalid = !row || row.status !== "pending" ||
    (row.expiresAt !== null && row.expiresAt.getTime() < Clock.now().getTime());
  if (invalid) {
    res.status(400).json({
      error: "Este link não vale mais. Peça um novo para quem cuida de você.",
      code: "ACTIVATION_INVALID",
    });
    return;
  }

  const [patient] = await db
    .select({ name: patientsTable.name })
    .from(patientsTable)
    .where(eq(patientsTable.id, row!.patientId))
    .limit(1);

  const { raw, hash } = generateOneTimeToken();
  await db
    .update(patientAccessTokensTable)
    .set({
      tokenHash: hash, // o token do link some daqui: uso único de verdade
      status: "active",
      activatedAt: Clock.now(),
      expiresAt: null, // o token de dispositivo não expira sozinho; morre ao ser revogado
      deviceLabel: deviceLabelFrom(req.get("user-agent") ?? undefined),
      lastUsedAt: Clock.now(),
    })
    .where(eq(patientAccessTokensTable.id, row!.id));

  safeLog.info({ action: "updated", entityType: "patient_access" }, "Acesso do paciente ativado num aparelho");

  res.json({ accessToken: raw, patientName: patient?.name ?? "" });
});

// ── PACIENTE: a dose de agora ─────────────────────────────────────────────

router.get("/patient-access/today", requirePatientAccess, async (req, res): Promise<void> => {
  const { patientId } = getPatientAccess(req);

  const [patient] = await db
    .select({ name: patientsTable.name, timezone: patientsTable.timezone, elderModeEnabled: patientsTable.elderModeEnabled })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const { start, end } = localDayBoundsUtc(Clock.todayInTimezone(patient.timezone), patient.timezone);

  const doses = await db
    .select({
      id: scheduledDosesTable.id,
      scheduledAt: scheduledDosesTable.scheduledAt,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      status: scheduledDosesTable.status,
      dose: scheduledDosesTable.dose,
      medicationName: medicationsTable.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(and(
      eq(scheduledDosesTable.patientId, patientId),
      gte(scheduledDosesTable.scheduledAt, start),
      lte(scheduledDosesTable.scheduledAt, end)
    ))
    .orderBy(scheduledDosesTable.scheduledAt);

  // Só o que a tela do paciente precisa. Nada de contagem de perdidas,
  // percentual ou histórico — a régua da ZELO-40 continua valendo: nada
  // que gere ansiedade em quem está sendo cuidado.
  const next = doses.find((d) => d.status === "pending") ?? null;

  res.json({
    patientName: patient.name,
    elderModeEnabled: patient.elderModeEnabled,
    nextDose: next ? {
      id: next.id,
      medicationName: next.medicationName,
      dose: next.dose,
      scheduledLocalTime: next.scheduledLocalTime,
    } : null,
  });
});

// ── PACIENTE: registrar que tomou ─────────────────────────────────────────

const TakenBody = z.object({ scheduledDoseId: z.number().int().positive() });

router.post("/patient-access/taken", requirePatientAccess, async (req, res): Promise<void> => {
  const body = TakenBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Dose inválida." }); return; }

  const { patientId, familyId, createdByCaregiverId } = getPatientAccess(req);

  // A dose precisa ser DESTE paciente — o token nunca alcança outro.
  const [scheduled] = await db
    .select({
      id: scheduledDosesTable.id,
      patientId: scheduledDosesTable.patientId,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      medicationId: treatmentsTable.medicationId,
      medicationName: medicationsTable.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(eq(scheduledDosesTable.id, body.data.scheduledDoseId))
    .limit(1);

  if (!scheduled || scheduled.patientId !== patientId) {
    res.status(404).json({ error: "Dose não encontrada." });
    return;
  }

  // "Agora" é o relógio do SERVIDOR (mesma regra de dose-records.ts): o
  // relógio do aparelho do paciente é ainda menos confiável que o do
  // cuidador, e um registro legítimo nunca pode cair por causa disso.
  const now = Clock.now();

  // Mesma garantia de dose-records.ts: o primeiro registro vence, pelo
  // UNIQUE do banco. Se o cuidador registrou antes, isto vira no-op e a
  // tela do paciente mostra sucesso do mesmo jeito — a dose ESTÁ registrada.
  const [inserted] = await db
    .insert(doseRecordsTable)
    .values({
      scheduledDoseId: scheduled.id,
      patientId,
      // Responsável continua sendo o cuidador que deu o acesso — a
      // auditoria não muda com esta história (ver ZELO-40).
      caregiverId: createdByCaregiverId,
      takenAt: now,
      outcome: "taken",
      registeredViaElderMode: true,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted) {
    await db
      .update(scheduledDosesTable)
      .set({ status: "taken", updatedAt: now })
      .where(eq(scheduledDosesTable.id, scheduled.id));

    await audit({
      familyId, entityType: "dose_record", entityId: String(inserted.id), action: "created",
      actorId: String(createdByCaregiverId), actorType: "caregiver", ipAddress: req.ip,
      diff: JSON.stringify({ viaPatientAccess: true }),
    });

    await ensureQueueStarted();
    await boss.send(QUEUE_DOSE_TAKEN, { patientId, medicationId: scheduled.medicationId });

    const [patient] = await db.select({ name: patientsTable.name }).from(patientsTable).where(eq(patientsTable.id, patientId)).limit(1);
    publishPatientEvent(patientId, {
      type: "dose_registered",
      scheduledDoseId: scheduled.id,
      medicationName: scheduled.medicationName,
      scheduledLocalTime: scheduled.scheduledLocalTime,
      caregiverName: patient?.name ?? "Paciente",
      status: "taken",
    });
  }

  res.status(inserted ? 201 : 200).json({ registered: true });
});

// ── Mandar um recado — QUI-8 ──────────────────────────────────────────────
//
// A TERCEIRA e última rota do token de paciente.
//
// O que a torna segura não é uma checagem: é o fato de o `patientId` vir do
// TOKEN, nunca do corpo. Não existe campo que o aparelho possa mandar para
// apontar para outro paciente — a rota nem lê um.
//
// Áudio é o formato pensado para esta pessoa: segurar um botão e falar é
// muito mais fácil que digitar ou se filmar, e 60 segundos comprimidos são
// ~50 KB — cem vezes menos que vídeo. Foto entra junto, mesmo fluxo, mas
// aí o consentimento de imagem vale igual (QUI-6): guardarMidia decide.
//
// SEM transcrição automática, e isso é regra: processar a fala de uma pessoa
// vulnerável não é o recurso, é outro produto.

router.post("/patient-access/momento", requirePatientAccess, mediaUploadLimiter, receberArquivo, async (req, res): Promise<void> => {
  if (!req.file) {
    res.status(400).json({ error: "Não recebemos a gravação. Tente de novo.", code: "MEDIA_FILE_MISSING" });
    return;
  }

  const access = getPatientAccess(req);

  const resultado = await guardarMidia({
    familyId: access.familyId,
    patientId: access.patientId,
    // Nulo de propósito: quem publicou foi o PACIENTE, não um cuidador. É
    // isso que faz o mural atribuir o recado a ele.
    caregiverId: null,
    arquivo: { buffer: req.file.buffer, mimetype: req.file.mimetype, size: req.file.size },
    // Sem legenda: quem está deste lado não digita. É o ponto do recurso.
  });

  if (!resultado.ok) {
    res.status(resultado.status).json({ error: resultado.error, code: resultado.code });
    return;
  }

  await audit({
    familyId: access.familyId,
    entityType: "media_asset",
    entityId: String(resultado.id),
    action: "created",
    // "system" porque o vocabulário de actor_type só tem caregiver e system,
    // e o paciente não é cuidador. O diff diz quem foi de verdade.
    actorType: "system",
    ipAddress: req.ip,
    diff: JSON.stringify({ viaPatientAccess: true, kind: resultado.tipo }),
  });

  res.status(201).json({ id: resultado.id, kind: resultado.tipo, sizeBytes: resultado.sizeBytes });
});

export default router;