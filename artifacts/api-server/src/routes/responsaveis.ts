/**
 * Quem é responsável por um paciente — Issue #120.
 *
 *   GET    /api/patients/:patientId/caregivers               quem responde por ele
 *   POST   /api/patients/:patientId/caregivers               vincular
 *   DELETE /api/patients/:patientId/caregivers/:caregiverId  desvincular
 *
 * ══════════════════════════════════════════════════════════════════════════
 * VÍNCULO NÃO É AUTORIZAÇÃO.
 *
 * Nada aqui muda quem pode ver ou registrar dose. Um cuidador sem vínculo
 * continua enxergando o paciente exatamente como antes — o que estas rotas
 * respondem é *"quem é o responsável?"*, não *"quem pode ver?"*.
 *
 * Autorização por paciente é a fase 11.6, e continua adiada: exigiria mudar
 * o modelo do JWT, que hoje carrega um `role` único por sessão.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Montado em prefixo próprio, e por quê ────────────────────────────────
 *
 * `/patients/:patientId/caregivers` tem três segmentos, como
 * `/patients/:patientId/momentos` e vários outros. Este arquivo é montado
 * **antes** do `patientsRouter` para que nenhuma rota de dois segmentos com
 * parâmetro o engula — a armadilha que já comeu `/patients/today-summary`.
 */

import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiverPatientsTable, caregiversTable } from "@workspace/db";
import { requireAuth, requirePrimaryCaregiver } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { verifyPatientBelongsToFamily } from "../lib/family-access";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { z } from "zod";

const router = Router();

const VincularBody = z.object({ caregiverId: z.number().int().positive() });

/** `404, nunca 403` para paciente fora da família — invariante 2. */
async function pacienteDaFamilia(patientId: number, familyId: number): Promise<boolean> {
  if (!Number.isSafeInteger(patientId) || patientId <= 0) return false;
  return verifyPatientBelongsToFamily(patientId, familyId);
}

// ── Quem responde por este paciente ───────────────────────────────────────

router.get<{ patientId: string }>(
  "/patients/:patientId/caregivers",
  requireAuth,
  async (req, res): Promise<void> => {
    const patientId = Number(req.params.patientId);
    if (!(await pacienteDaFamilia(patientId, getAuth(req).familyId))) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    const responsaveis = await db
      .select({
        id: caregiversTable.id,
        name: caregiversTable.name,
        role: caregiversTable.role,
        vinculadoEm: caregiverPatientsTable.createdAt,
      })
      .from(caregiverPatientsTable)
      .innerJoin(caregiversTable, eq(caregiversTable.id, caregiverPatientsTable.caregiverId))
      .where(eq(caregiverPatientsTable.patientId, patientId))
      .orderBy(caregiversTable.name);

    res.json(responsaveis);
  },
);

// ── Vincular ──────────────────────────────────────────────────────────────

router.post<{ patientId: string }>(
  "/patients/:patientId/caregivers",
  requirePrimaryCaregiver,
  async (req, res): Promise<void> => {
    const patientId = Number(req.params.patientId);
    if (!(await pacienteDaFamilia(patientId, getAuth(req).familyId))) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    const body = VincularBody.safeParse(req.body);
    if (!body.success) {
      res.status(400).json({ error: "Informe qual cuidador vincular." });
      return;
    }

    // O cuidador precisa ser da MESMA família do paciente. Sem esta consulta,
    // o corpo da requisição escolheria alguém de outra família e o vínculo
    // atravessaria a fronteira que o invariante 2 existe para manter.
    const [cuidador] = await db
      .select({ id: caregiversTable.id })
      .from(caregiversTable)
      .where(
        and(
          eq(caregiversTable.id, body.data.caregiverId),
          eq(caregiversTable.familyId, getAuth(req).familyId),
        ),
      )
      .limit(1);

    if (!cuidador) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    // Vincular duas vezes é o mesmo vínculo — dois toques rápidos no botão
    // chegam como duas requisições, e a segunda bateria na UNIQUE. Ignorar é
    // o comportamento certo: o estado final é o mesmo.
    await db
      .insert(caregiverPatientsTable)
      .values({
        caregiverId: cuidador.id,
        patientId,
        createdByCaregiverId: getAuth(req).caregiverId,
        createdAt: Clock.now(),
      })
      .onConflictDoNothing();

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "patient",
      entityId: String(patientId),
      action: "updated",
      actorType: "caregiver",
      actorId: String(getAuth(req).caregiverId),
      diff: JSON.stringify({ vinculou: cuidador.id }),
    });

    res.status(201).json({ caregiverId: cuidador.id, patientId });
  },
);

// ── Desvincular ───────────────────────────────────────────────────────────

router.delete<{ patientId: string; caregiverId: string }>(
  "/patients/:patientId/caregivers/:caregiverId",
  requirePrimaryCaregiver,
  async (req, res): Promise<void> => {
    const patientId = Number(req.params.patientId);
    const caregiverId = Number(req.params.caregiverId);

    if (!(await pacienteDaFamilia(patientId, getAuth(req).familyId))) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }
    if (!Number.isSafeInteger(caregiverId) || caregiverId <= 0) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    // Sem conferir a família do cuidador de novo: o paciente já foi conferido
    // acima, e o vínculo só existe entre pares da mesma família — quem não é
    // da família simplesmente não tem linha para apagar.
    await db
      .delete(caregiverPatientsTable)
      .where(
        and(
          eq(caregiverPatientsTable.patientId, patientId),
          eq(caregiverPatientsTable.caregiverId, caregiverId),
        ),
      );

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "patient",
      entityId: String(patientId),
      action: "updated",
      actorType: "caregiver",
      actorId: String(getAuth(req).caregiverId),
      diff: JSON.stringify({ desvinculou: caregiverId }),
    });

    // 204 mesmo quando não havia vínculo: o pedido era "que esta pessoa não
    // seja mais responsável", e esse estado está garantido de qualquer jeito.
    res.status(204).end();
  },
);

export default router;
