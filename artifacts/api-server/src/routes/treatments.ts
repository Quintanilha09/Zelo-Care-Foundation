import { getAuth } from "../lib/auth-types.ts";
/**
 * Tratamentos — ZELO.
 * familyId vem do token JWT, sempre resolvido via patientId -> patients.family_id.
 * Nenhuma tela sugere, calcula ou valida quantidade de dose — o app registra
 * o que o médico prescreveu, nunca opina.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { treatmentsTable, patientsTable, medicationsTable, stockEntriesTable, scheduledDosesTable, doseRecordsTable } from "@workspace/db";
import { z } from "zod";
import { expandSchedule } from "@workspace/scheduling";
import type { ScheduleConfig } from "@workspace/scheduling";
import { requireAuth } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { generateDosesForTreatment, clearFuturePendingDoses, cancelFutureDoses } from "../lib/dose-generation.ts";
import { publishPatientEvent } from "../lib/realtime.ts";
import { isPatientEditable, READ_ONLY_MESSAGE } from "../lib/plan-limits.ts";

const router = Router();

const TimeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário deve ser HH:mm");

const ScheduleConfigBody = z.discriminatedUnion("scheduleType", [
  z.object({ scheduleType: z.literal("times_per_day"), times: z.array(TimeOfDay).min(1) }),
  z.object({ scheduleType: z.literal("every_n_hours"), intervalHours: z.number().int().positive(), startTime: TimeOfDay }),
  z.object({ scheduleType: z.literal("specific_weekdays"), weekdays: z.array(z.number().int().min(0).max(6)).min(1), times: z.array(TimeOfDay).min(1) }),
  z.object({ scheduleType: z.literal("alternate_days"), times: z.array(TimeOfDay).min(1), startDate: z.string() }),
  z.object({ scheduleType: z.literal("cycle_with_pause"), onDays: z.number().int().positive(), offDays: z.number().int().min(0), times: z.array(TimeOfDay).min(1) }),
]);

const CreateTreatmentBody = z.object({
  medicationId: z.number().int().positive(),
  dose: z.string().optional().nullable(), // texto livre — "1 comprimido", "5ml" — nunca validado ou sugerido
  scheduleConfig: ScheduleConfigBody,
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
  instructions: z.string().optional().nullable(),
  // ZELO-30: silent/standard/critical — controla se e quando a dose escala
  // além do(s) cuidador(es) principal(is) (ver dose-reminders.ts).
  escalationProfile: z.enum(["silent", "standard", "critical"]).optional(),
  // ZELO-34: opcional de propósito — "sem estoque informado, a função fica
  // desligada pra aquele tratamento, sem insistir" (a própria história).
  initialStock: z.object({
    quantity: z.number().positive(),
    unit: z.string().min(1),
    prescriptionExpiresAt: z.string().optional().nullable(),
  }).optional(),
});

const UpdateTreatmentBody = CreateTreatmentBody.partial().extend({
  status: z.enum(["active", "paused", "finished", "cancelled"]).optional(),
});

const PreviewBody = z.object({
  scheduleConfig: ScheduleConfigBody,
  startDate: z.string(),
  endDate: z.string().optional().nullable(),
});

async function loadPatientInFamily(patientId: number, familyId: number) {
  const [patient] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone, name: patientsTable.name })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return patient ?? null;
}

const WEEKDAY_PT: Record<string, string> = {
  Sunday: "domingo", Monday: "segunda", Tuesday: "terça", Wednesday: "quarta",
  Thursday: "quinta", Friday: "sexta", Saturday: "sábado",
};

/** Linguagem natural, no fuso do paciente: "amanhã às 8h", "quinta às 20h"... */
function describeInPortuguese(dates: Date[], timezone: string): string[] {
  const now = Clock.now();
  const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit" }); // en-CA = YYYY-MM-DD
  const timeFmt = new Intl.DateTimeFormat("pt-BR", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hour12: false });
  const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" });

  const todayISO = dateFmt.format(now);
  const tomorrowISO = dateFmt.format(new Date(now.getTime() + 86_400_000));

  return dates.map((d) => {
    const dateISO = dateFmt.format(d);
    const timeStr = timeFmt.format(d).replace(":", "h");

    let dayLabel: string;
    if (dateISO === todayISO) dayLabel = "hoje";
    else if (dateISO === tomorrowISO) dayLabel = "amanhã";
    else dayLabel = WEEKDAY_PT[weekdayFmt.format(d)];

    return `${dayLabel} às ${timeStr}`;
  });
}

// ── Listar tratamentos de um paciente ─────────────────────────────────────

router.get("/patients/:patientId/treatments", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const treatments = await db
    .select({
      id: treatmentsTable.id,
      patientId: treatmentsTable.patientId,
      medicationId: treatmentsTable.medicationId,
      medicationName: medicationsTable.name,
      dose: treatmentsTable.dose,
      scheduleType: treatmentsTable.scheduleType,
      scheduleConfig: treatmentsTable.scheduleConfig,
      startDate: treatmentsTable.startDate,
      endDate: treatmentsTable.endDate,
      status: treatmentsTable.status,
      instructions: treatmentsTable.instructions,
      // Necessário para pré-preencher o formulário de EDIÇÃO: sem isto, abrir
      // um tratamento para editar perderia o perfil de escalonamento escolhido
      // e o salvaria de volta como 'standard' sem ninguém pedir.
      escalationProfile: treatmentsTable.escalationProfile,
      createdAt: treatmentsTable.createdAt,
    })
    .from(treatmentsTable)
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(eq(treatmentsTable.patientId, patientId))
    .orderBy(treatmentsTable.createdAt);

  // QUI-16: quais destes tratamentos já têm dose registrada.
  //
  // A tela precisa saber ANTES de desenhar o botão: excluir um tratamento
  // que já tem histórico é recusado com 409 (ver o DELETE mais abaixo), e
  // oferecer um botão que o servidor vai negar é enganar quem olha.
  //
  // Uma consulta só para a lista inteira, não uma por tratamento.
  const comRegistro = await db
    .selectDistinct({ treatmentId: scheduledDosesTable.treatmentId })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .where(eq(doseRecordsTable.patientId, patientId));
  const registrados = new Set(comRegistro.map((r) => r.treatmentId));

  res.json(treatments.map((t) => ({ ...t, hasDoseRecords: registrados.has(t.id) })));
});

// ── Pré-visualizar próximas doses, sem salvar nada ────────────────────────

router.post("/patients/:patientId/treatments/preview", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = PreviewBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const windowStart = Clock.now();
  const windowEnd = new Date(windowStart.getTime() + 90 * 86_400_000); // busca até 90 dias à frente para achar 5 doses mesmo em posologias esparsas

  const dates = expandSchedule(
    {
      schedule: body.data.scheduleConfig as ScheduleConfig,
      treatmentStartDate: body.data.startDate,
      treatmentEndDate: body.data.endDate ?? null,
      timezone: patient.timezone,
    },
    windowStart,
    windowEnd
  ).slice(0, 5);

  res.json({
    nextDoses: dates.map((d) => d.toISOString()),
    inPortuguese: describeInPortuguese(dates, patient.timezone),
  });
});

// ── Criar tratamento ───────────────────────────────────────────────────────

router.post("/patients/:patientId/treatments", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const patient = await loadPatientInFamily(patientId, getAuth(req).familyId);
  if (!patient) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  // ZELO-38: downgrade nunca apaga dado — paciente excedente do plano
  // atual fica visível pra sempre, só não aceita tratamento novo.
  if (!(await isPatientEditable(patientId, getAuth(req).familyId))) {
    res.status(403).json({ error: READ_ONLY_MESSAGE, code: "PLAN_READ_ONLY" });
    return;
  }

  const body = CreateTreatmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  // Medicamento precisa pertencer à mesma família (mesma checagem de isolamento)
  const [medication] = await db
    .select({ id: medicationsTable.id })
    .from(medicationsTable)
    .where(and(eq(medicationsTable.id, body.data.medicationId), eq(medicationsTable.familyId, getAuth(req).familyId)))
    .limit(1);
  if (!medication) { res.status(404).json({ error: "Medicamento não encontrado" }); return; }

  const [treatment] = await db
    .insert(treatmentsTable)
    .values({
      patientId,
      medicationId: body.data.medicationId,
      dose: body.data.dose ?? null,
      scheduleType: body.data.scheduleConfig.scheduleType,
      scheduleConfig: body.data.scheduleConfig,
      startDate: body.data.startDate,
      endDate: body.data.endDate ?? null,
      instructions: body.data.instructions ?? null,
      ...(body.data.escalationProfile ? { escalationProfile: body.data.escalationProfile } : {}),
    })
    .returning();

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "treatment",
    entityId: String(treatment.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  // ZELO-34: "quantidade inicial informada no cadastro do tratamento" —
  // upsert por (patientId, medicationId): represcrever o mesmo medicamento
  // (dose mudou, por exemplo) atualiza o estoque conhecido em vez de tentar
  // criar uma segunda linha e esbarrar na constraint única.
  if (body.data.initialStock) {
    await db
      .insert(stockEntriesTable)
      .values({
        patientId,
        medicationId: body.data.medicationId,
        quantityRemaining: body.data.initialStock.quantity,
        unit: body.data.initialStock.unit,
        prescriptionExpiresAt: body.data.initialStock.prescriptionExpiresAt ?? null,
      })
      .onConflictDoUpdate({
        target: [stockEntriesTable.patientId, stockEntriesTable.medicationId],
        set: {
          quantityRemaining: body.data.initialStock.quantity,
          unit: body.data.initialStock.unit,
          prescriptionExpiresAt: body.data.initialStock.prescriptionExpiresAt ?? null,
          updatedAt: Clock.now(),
        },
      });
  }

  // Gera a janela inicial de doses. Falha aqui não deve derrubar a criação
  // do tratamento — o tratamento já existe e é válido mesmo sem doses ainda;
  // loga e segue, em vez de fazer o cuidador perder o que acabou de digitar.
  try {
    await generateDosesForTreatment(treatment.id);
  } catch (err) {
    req.log?.error({ err, treatmentId: treatment.id }, "Falha ao gerar doses iniciais");
  }

  publishPatientEvent(patientId, { type: "treatment_changed", treatmentId: treatment.id });

  res.status(201).json(treatment);
});

// ── Ler um tratamento ──────────────────────────────────────────────────────

router.get("/treatments/:treatmentId", requireAuth, async (req, res): Promise<void> => {
  const treatmentId = Number(req.params.treatmentId);
  if (isNaN(treatmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [row] = await db
    .select({ treatment: treatmentsTable, patientFamilyId: patientsTable.familyId })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  if (!row || row.patientFamilyId !== getAuth(req).familyId) {
    res.status(404).json({ error: "Tratamento não encontrado" });
    return;
  }
  res.json(row.treatment);
});

// ── Editar tratamento ──────────────────────────────────────────────────────
// Só afeta doses futuras ainda não geradas/registradas — a regeneração real
// de doses fica a cargo do módulo de agendamento (ZELO-18), que compara o
// updatedAt e recria apenas o que ainda não foi tomado.

router.patch("/treatments/:treatmentId", requireAuth, async (req, res): Promise<void> => {
  const treatmentId = Number(req.params.treatmentId);
  if (isNaN(treatmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [existing] = await db
    .select({ treatment: treatmentsTable, patientFamilyId: patientsTable.familyId })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  if (!existing || existing.patientFamilyId !== getAuth(req).familyId) {
    res.status(404).json({ error: "Tratamento não encontrado" });
    return;
  }

  const body = UpdateTreatmentBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const { scheduleConfig, ...rest } = body.data;
  // ZELO-20: reativar (finished/cancelled -> active) ou mudar a data de fim
  // invalida o aviso de véspera já enviado — um prazo novo merece aviso novo.
  const reactivating = existing.treatment.status !== "active" && body.data.status === "active";
  const endDateChanged = body.data.endDate !== undefined && body.data.endDate !== existing.treatment.endDate;

  const [updated] = await db
    .update(treatmentsTable)
    .set({
      ...rest,
      ...(scheduleConfig ? { scheduleConfig, scheduleType: scheduleConfig.scheduleType } : {}),
      ...(reactivating || endDateChanged ? { endingNoticeSentAt: null } : {}),
      updatedAt: Clock.now(),
    })
    .where(eq(treatmentsTable.id, treatmentId))
    .returning();

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "treatment",
    entityId: String(treatmentId),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  // Só as doses futuras AINDA NÃO REGISTRADAS são afetadas — nunca as já
  // tomadas/puladas, isso é histórico e fica intacto.
  try {
    const scheduleChanged = scheduleConfig || body.data.startDate || body.data.endDate;
    if (updated.status !== "active") {
      await cancelFutureDoses(treatmentId);
    } else if (scheduleChanged || reactivating) {
      // reactivating cobre o "reativar em um toque" da história ZELO-20:
      // finished/cancelled -> active sem nenhum outro campo mudando ainda
      // precisa regenerar a janela de doses, que cancelFutureDoses zerou.
      await clearFuturePendingDoses(treatmentId);
      await generateDosesForTreatment(treatmentId);
    }
  } catch (err) {
    req.log?.error({ err, treatmentId }, "Falha ao regenerar doses após edição");
  }

  publishPatientEvent(updated.patientId, { type: "treatment_changed", treatmentId });

  res.json(updated);
});

// ── Excluir tratamento ─────────────────────────────────────────────────────
//
// ── Por que esta rota recusa em vez de apagar — QUI-16 ─────────────────────
//
// Concluir e cancelar guardam o tratamento no histórico, que é o certo na
// esmagadora maioria dos casos. Mas quem cadastrou o remédio ERRADO não quer
// isso guardado para sempre numa lista de encerrados: quer que suma.
//
// O que essa rota NÃO pode fazer é apagar história de cuidado. E o risco aqui
// é silencioso: `scheduled_doses.treatment_id` e `dose_records
// .scheduled_dose_id` são ambos ON DELETE CASCADE. Um DELETE inocente no
// tratamento levaria junto **todas as doses tomadas**, sem erro nenhum, sem
// aviso nenhum — e o relatório de adesão passaria a mentir sobre um período
// que de fato aconteceu.
//
// Então a regra é simples e verificável: **teve dose registrada, não apaga.**
// A resposta 409 diz o que fazer no lugar, porque recusar sem apontar a saída
// é só um beco sem saída educado.

router.delete("/treatments/:treatmentId", requireAuth, async (req, res): Promise<void> => {
  const treatmentId = Number(req.params.treatmentId);
  if (isNaN(treatmentId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [existing] = await db
    .select({ treatment: treatmentsTable, patientFamilyId: patientsTable.familyId })
    .from(treatmentsTable)
    .innerJoin(patientsTable, eq(treatmentsTable.patientId, patientsTable.id))
    .where(eq(treatmentsTable.id, treatmentId))
    .limit(1);

  // 404, nunca 403: responder "existe, mas não é seu" já entrega que aquele
  // id existe em alguma família. É a mesma regra do resto do produto.
  if (!existing || existing.patientFamilyId !== getAuth(req).familyId) {
    res.status(404).json({ error: "Tratamento não encontrado" });
    return;
  }

  // Sem portão de plano aqui, de propósito. `isPatientEditable` existe para
  // barrar CRESCIMENTO quando a família passou do limite — e apagar é o
  // contrário de crescer. Bloquear a limpeza de um cadastro errado por causa
  // de plano seria cobrar pelo direito de corrigir um engano. O PATCH também
  // não tem portão, pela mesma família de razões: parar um tratamento é
  // segurança do paciente (invariante 6).

  const [registro] = await db
    .select({ id: doseRecordsTable.id })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .where(eq(scheduledDosesTable.treatmentId, treatmentId))
    .limit(1);

  if (registro) {
    res.status(409).json({
      error:
        "Este tratamento já tem dose registrada, e o histórico precisa continuar existindo. " +
        "Cancele o tratamento: ele para de gerar lembrete e sai da lista de ativos.",
      code: "TREATMENT_HAS_HISTORY",
    });
    return;
  }

  await db.delete(treatmentsTable).where(eq(treatmentsTable.id, treatmentId));

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "treatment",
    entityId: String(treatmentId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  // A tela do paciente precisa recarregar: o cartão sumiu, e as doses
  // pendentes que o cascade levou junto também.
  publishPatientEvent(existing.treatment.patientId, { type: "treatment_changed", treatmentId });

  res.status(204).end();
});

export default router;
