import { getAuth } from "../lib/auth-types.ts";
/**
 * Feed de atividade recente da família — ZELO.
 * GET /api/activity?limit=20
 *
 * Converte entradas do audit_log em linguagem natural para o cuidador principal.
 * Exemplo: "Bruno registrou a dose das 8h" / "Ana aceitou o convite"
 *
 * PRIVACIDADE: nomes de medicamento NÃO aparecem nas mensagens — apenas
 * referências ao tipo de evento. O actorId é resolvido para nome do cuidador.
 */

import { Router } from "express";
import { eq, desc, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditLogTable, caregiversTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";

const router = Router();

// Mapa de (entityType, action) → template de mensagem em português
function buildMessage(
  entityType: string,
  action: string,
  actorName: string
): string {
  const who = actorName;

  const messages: Record<string, Record<string, string>> = {
    dose_record: {
      created: `${who} registrou uma dose`,
      updated: `${who} editou um registro de dose`,
      deleted: `${who} removeu um registro de dose`,
    },
    treatment: {
      created: `${who} criou um tratamento`,
      updated: `${who} atualizou um tratamento`,
      deleted: `${who} encerrou um tratamento`,
    },
    patient: {
      created: `${who} cadastrou um paciente`,
      updated: `${who} atualizou os dados do paciente`,
      accessed: `${who} acessou o perfil do paciente`,
    },
    caregiver: {
      created: `${who} foi adicionado como cuidador`,
      updated: `${who} teve o papel atualizado`,
      deleted: `${who} foi removido da família`,
    },
    caregiver_invite: {
      created: `${who} criou um convite para novo cuidador`,
      deleted: `${who} revogou um convite`,
    },
    session: {
      created: `${who} fez login`,
      deleted: `${who} encerrou a sessão`,
    },
    data_export: {
      created: `${who} exportou os dados da família`,
    },
    deletion_request: {
      created: `${who} solicitou a exclusão dos dados`,
      deleted: `${who} cancelou a solicitação de exclusão`,
    },
    user: {
      created: `Nova conta cadastrada`,
    },
  };

  return messages[entityType]?.[action] ?? `${who} realizou uma ação (${entityType}:${action})`;
}

router.get("/activity", requireAuth, async (req, res): Promise<void> => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);

  const entries = await db
    .select()
    .from(auditLogTable)
    .where(eq(auditLogTable.familyId, getAuth(req).familyId))
    .orderBy(desc(auditLogTable.createdAt))
    .limit(limit);

  if (entries.length === 0) {
    res.json([]);
    return;
  }

  // Resolve nomes dos cuidadores pelos actorIds
  const caregiverIds = [
    ...new Set(
      entries
        .filter((e) => e.actorType === "caregiver" && e.actorId)
        .map((e) => Number(e.actorId))
        .filter((id) => !isNaN(id))
    ),
  ];

  const caregiverMap = new Map<number, string>();
  if (caregiverIds.length > 0) {
    const caregivers = await db
      .select({ id: caregiversTable.id, name: caregiversTable.name })
      .from(caregiversTable)
      .where(inArray(caregiversTable.id, caregiverIds));
    for (const c of caregivers) caregiverMap.set(c.id, c.name);
  }

  const feed = entries.map((entry) => {
    const actorName =
      entry.actorType === "caregiver" && entry.actorId
        ? (caregiverMap.get(Number(entry.actorId)) ?? "Cuidador")
        : "Sistema";

    return {
      id: entry.id,
      text: buildMessage(entry.entityType, entry.action, actorName),
      entityType: entry.entityType,
      action: entry.action,
      actorName,
      timestamp: entry.createdAt,
    };
  });

  res.json(feed);
});

export default router;
