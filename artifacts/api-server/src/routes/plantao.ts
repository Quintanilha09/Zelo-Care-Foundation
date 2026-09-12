/**
 * A escala de plantão — Issue #177.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DE QUEM É A VEZ, E NUNCA QUEM PODE.
 *
 * Nenhuma rota deste arquivo filtra, esconde ou restringe qualquer coisa.
 * Ela só guarda e devolve o combinado da família. Se um dia a escala virar
 * filtro de acesso, uma família inteira perde o app numa noite em que
 * ninguém marcou plantão — e é justamente a noite em que mais precisa.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O assunto não existe para quem não revezou ──────────────────────────
 *
 * Família sem escala nunca vê nada disto: `GET` devolve lista vazia, a tela
 * não desenha a seção, e o lembrete continua indo para o cuidador principal
 * exatamente como sempre foi. A escala é oferta, não cadastro obrigatório.
 */
import { Router } from "express";
import { eq, and, asc } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { shiftsTable, caregiversTable, patientsTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { mensagemDeValidacao } from "../lib/erro-de-validacao.ts";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { quemEstaDePlantao } from "../lib/plantao.ts";

const router = Router();

const Hora = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "horário deve ser HH:mm");

/**
 * Um turno: recorrente OU pontual, nunca os dois.
 *
 * O `refine` é o que impede uma linha que não descreve nada — um turno sem
 * dia nenhum, ou um que diz ser toda terça E também dia 12.
 */
const TurnoBody = z
  .object({
    caregiverId: z.number().int().positive(),
    /** 0=domingo .. 6=sábado. Recorrência semanal. */
    weekday: z.number().int().min(0).max(6).optional(),
    /** "YYYY-MM-DD" no fuso do paciente. Troca pontual. */
    onDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    startTime: Hora.optional(),
    endTime: Hora.optional(),
  })
  .refine(
    (t) => (t.weekday === undefined) !== (t.onDate === undefined),
    { message: "informe o dia da semana OU uma data, nunca os dois" },
  );

async function carregarPaciente(patientId: number, familyId: number) {
  const [p] = await db
    .select({ id: patientsTable.id, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(and(eq(patientsTable.id, patientId), eq(patientsTable.familyId, familyId)))
    .limit(1);
  return p ?? null;
}

/**
 * A escala do paciente, e quem está de plantão agora.
 *
 * As duas coisas na mesma resposta porque a tela mostra as duas juntas, e
 * uma segunda ida ao servidor só para saber "e agora?" deixaria a linha do
 * cabeçalho aparecer depois da lista.
 */
router.get("/patients/:patientId/plantao", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const paciente = await carregarPaciente(patientId, getAuth(req).familyId);
  // Paciente de outra família responde 404, e não 403: 403 confirmaria que
  // ele existe.
  if (!paciente) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const turnos = await db
    .select({
      id: shiftsTable.id,
      caregiverId: shiftsTable.caregiverId,
      caregiverName: caregiversTable.name,
      weekday: shiftsTable.weekday,
      onDate: shiftsTable.onDate,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
    })
    .from(shiftsTable)
    .innerJoin(caregiversTable, eq(shiftsTable.caregiverId, caregiversTable.id))
    .where(eq(shiftsTable.patientId, patientId))
    .orderBy(asc(shiftsTable.weekday), asc(shiftsTable.onDate), asc(shiftsTable.startTime));

  const agora = await quemEstaDePlantao(patientId, paciente.timezone, Clock.now());

  res.json({
    turnos,
    /** `null` = ninguém marcado para agora. Não é erro: é o caso comum. */
    agora,
    /** Quem a tela pode oferecer para o turno. Nunca filtrado por plantão. */
    cuidadores: await db
      .select({ id: caregiversTable.id, name: caregiversTable.name, role: caregiversTable.role })
      .from(caregiversTable)
      .where(eq(caregiversTable.familyId, getAuth(req).familyId))
      .orderBy(asc(caregiversTable.name)),
  });
});

router.post("/patients/:patientId/plantao", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  if (isNaN(patientId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const paciente = await carregarPaciente(patientId, getAuth(req).familyId);
  if (!paciente) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const body = TurnoBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: mensagemDeValidacao(body.error) }); return; }

  // O cuidador precisa ser da MESMA família. Sem esta checagem daria para
  // pendurar o plantão do paciente numa pessoa de outra casa.
  const [cuidador] = await db
    .select({ id: caregiversTable.id })
    .from(caregiversTable)
    .where(and(
      eq(caregiversTable.id, body.data.caregiverId),
      eq(caregiversTable.familyId, getAuth(req).familyId),
    ))
    .limit(1);
  if (!cuidador) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  const [criado] = await db
    .insert(shiftsTable)
    .values({
      patientId,
      caregiverId: body.data.caregiverId,
      weekday: body.data.weekday ?? null,
      onDate: body.data.onDate ?? null,
      // Padrão: o dia inteiro. É o que a maioria quer dizer com "sábado é meu".
      startTime: body.data.startTime ?? "00:00",
      endTime: body.data.endTime ?? "23:59",
      createdByCaregiverId: getAuth(req).caregiverId,
    })
    .returning({ id: shiftsTable.id });

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "shift",
    entityId: String(criado.id),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    // O diff do audit é metadado: nunca o nome de quem cuida nem o do
    // paciente. Se é recorrente ou pontual basta para reconstruir a história.
    diff: JSON.stringify({ recorrente: body.data.weekday !== undefined }),
    ipAddress: req.ip,
  });

  res.status(201).json({ id: criado.id });
});

router.delete("/patients/:patientId/plantao/:shiftId", requireAuth, async (req, res): Promise<void> => {
  const patientId = Number(req.params.patientId);
  const shiftId = Number(req.params.shiftId);
  if (isNaN(patientId) || isNaN(shiftId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const paciente = await carregarPaciente(patientId, getAuth(req).familyId);
  if (!paciente) { res.status(404).json({ error: "Paciente não encontrado" }); return; }

  const apagados = await db
    .delete(shiftsTable)
    .where(and(eq(shiftsTable.id, shiftId), eq(shiftsTable.patientId, patientId)))
    .returning({ id: shiftsTable.id });

  if (apagados.length === 0) { res.status(404).json({ error: "Turno não encontrado" }); return; }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "shift",
    entityId: String(shiftId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip,
  });

  res.json({ ok: true });
});

export default router;
