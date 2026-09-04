import { getAuth } from "../lib/auth-types.ts";
/**
 * Cuidadores — ZELO.
 * familyId vem do token JWT.
 */
import { Router } from "express";
import { eq, and } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiversTable, pushSubscriptionsTable, usersTable, familiesTable } from "@workspace/db";
import { z } from "zod";
import { requireAuth, requirePrimaryCaregiver } from "../middleware/require-auth";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { countPrimaryCaregivers } from "../lib/capabilities";
import { revokeAllAccessTokensForUser } from "../lib/tokens";
import { safeLog } from "../lib/safe-logger";
import { closeConnectionsForUser } from "../lib/realtime.ts";
import { sendRescueNotice } from "../lib/email.ts";

const router = Router();

// Permite promover para primary_caregiver (sempre seguro — nunca reduz o
// número de principais) mas a proteção contra REBAIXAR o último principal
// acontece na rota, não aqui no schema.
const UpdateCaregiverBody = z.object({
  name: z.string().min(2).max(100).optional(),
  role: z.enum(["primary_caregiver", "caregiver", "hired_caregiver", "observer"]).optional(),
});

/** Revoga sessão ativa e push do usuário — reaproveitado por PATCH (rebaixar) e DELETE. */
async function revokeCaregiverAccess(userId: number | null, familyId: number): Promise<void> {
  if (userId === null) return; // cuidador sem conta vinculada (pré-convite) — nada a revogar
  revokeAllAccessTokensForUser(userId);
  await db
    .delete(pushSubscriptionsTable)
    .where(and(eq(pushSubscriptionsTable.userId, userId), eq(pushSubscriptionsTable.familyId, familyId)));
  // ZELO-25: derruba qualquer stream SSE aberto na hora — sem esperar o
  // próximo poll de revalidação. O token de acesso já foi revogado acima;
  // reconectar vai exigir login de novo, com o papel atual.
  closeConnectionsForUser(userId);
}

router.get("/caregivers", requireAuth, async (req, res): Promise<void> => {
  const caregivers = await db
    .select()
    .from(caregiversTable)
    .where(eq(caregiversTable.familyId, getAuth(req).familyId))
    .orderBy(caregiversTable.name);
  res.json(caregivers);
});

router.get("/caregivers/:caregiverId", requireAuth, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const [caregiver] = await db
    .select()
    .from(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!caregiver) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }
  res.json(caregiver);
});

router.patch("/caregivers/:caregiverId", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  const body = UpdateCaregiverBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: body.error.message }); return; }

  const [before] = await db
    .select({ role: caregiversTable.role, userId: caregiversTable.userId })
    .from(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!before) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  const roleChanging = body.data.role !== undefined && body.data.role !== before.role;
  const isDemotionFromPrimary = roleChanging && before.role === "primary_caregiver";

  if (isDemotionFromPrimary) {
    // Sempre existe ao menos 1 cuidador principal por família — contado de
    // verdade, não como efeito colateral de "não pode remover a si mesmo".
    const remaining = await countPrimaryCaregivers(getAuth(req).familyId, caregiverId);
    if (remaining === 0) {
      res.status(400).json({
        error: "Não é possível rebaixar o último cuidador principal da família",
        code: "LAST_PRIMARY_CAREGIVER",
      });
      return;
    }
  }

  const [updated] = await db
    .update(caregiversTable)
    .set({ ...body.data, updatedAt: Clock.now() })
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .returning();

  if (roleChanging) {
    // Token de acesso já emitido carrega o papel antigo por até 15 minutos —
    // revoga para forçar reautenticação com o papel novo na hora.
    await revokeCaregiverAccess(before.userId, getAuth(req).familyId);

    safeLog.info({ action: "role_changed", entityType: "caregiver", familyId: getAuth(req).familyId }, "Papel de cuidador alterado");
    await audit({
      familyId: getAuth(req).familyId,
      entityType: "caregiver",
      entityId: String(caregiverId),
      action: "updated",
      actorId: String(getAuth(req).caregiverId),
      actorType: "caregiver",
      diff: JSON.stringify({ before: { role: before.role }, after: { role: body.data.role } }),
    });
  }

  res.json(updated);
});

router.delete("/caregivers/:caregiverId", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Não pode remover o próprio cuidador principal
  if (caregiverId === getAuth(req).caregiverId) {
    res.status(400).json({ error: "Você não pode remover sua própria conta de cuidador" });
    return;
  }

  const [target] = await db
    .select({ role: caregiversTable.role, userId: caregiversTable.userId })
    .from(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!target) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  if (target.role === "primary_caregiver") {
    const remaining = await countPrimaryCaregivers(getAuth(req).familyId, caregiverId);
    if (remaining === 0) {
      res.status(400).json({
        error: "Não é possível remover o último cuidador principal da família",
        code: "LAST_PRIMARY_CAREGIVER",
      });
      return;
    }
  }

  const [deleted] = await db
    .delete(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .returning({ id: caregiversTable.id });

  if (!deleted) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  // Revogação com efeito imediato: sessão ativa e push somem na hora,
  // não só na próxima expiração natural do token.
  await revokeCaregiverAccess(target.userId, getAuth(req).familyId);
  safeLog.info({ action: "revoked", entityType: "caregiver", familyId: getAuth(req).familyId }, "Cuidador revogado");

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "caregiver",
    entityId: String(caregiverId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(204).send();
});

// ── RESGATE PELA FAMÍLIA — Issue #87 ─────────────────────────────────────
//
// ═══════════════════════════════════════════════════════════════════════════
// ISTO NÃO CONCEDE PODER NOVO AO CUIDADOR PRINCIPAL — ELE JÁ VÊ E FAZ TUDO
// NESTA FAMÍLIA. O QUE ABRE É UM CAMINHO PARA PULAR O SEGUNDO FATOR DE OUTRA
// PESSOA, E ISSO SÓ IMPORTA PARA QUEM JÁ TEM A SENHA DELA.
// ═══════════════════════════════════════════════════════════════════════════
//
// O produto já modela vários cuidadores por família, com papéis. Deixar o
// principal restaurar o acesso de outro sai quase de graça desse modelo, e é o
// caminho mais limpo que existe aqui.
//
// **O que ele custa.** Um atacante que já tenha a senha de alguém e a
// cumplicidade — ou a conta comprometida — de um cuidador principal ganha um
// caminho para pular o segundo fator. Não dá para eliminar sem tirar o resgate,
// que é justamente o que impede a conta de se perder. Três coisas limitam, e
// nenhuma é opcional:
//
//   1. janela curta — quem pediu ajuda entra logo
//   2. a pessoa resgatada é AVISADA por e-mail, no ato
//   3. fica no registro de auditoria: quem resgatou quem, e quando
//
// **Família com um cuidador só não tem isto**, e é o caso mais comum no
// começo. Para ela o caminho é o e-mail de recuperação, que entrou no mesmo
// PR anterior desta Issue.

/**
 * Quanto tempo o resgate fica armado.
 *
 * Vinte e quatro horas: quem pediu ajuda vai entrar no mesmo dia, e um resgate
 * esquecido não pode ficar valendo para sempre. É o mesmo raciocínio do link de
 * convite, e o oposto do prazo de sete dias da exclusão — lá a espera protege,
 * aqui ela é exposição.
 */
const RESGATE_HORAS = 24;

router.post("/caregivers/:caregiverId/resgate", requirePrimaryCaregiver, async (req, res): Promise<void> => {
  const caregiverId = Number(req.params.caregiverId);
  if (isNaN(caregiverId)) { res.status(400).json({ error: "ID inválido" }); return; }

  // Resgatar a si mesmo não faz sentido: quem chama esta rota está logado.
  if (caregiverId === getAuth(req).caregiverId) {
    res.status(400).json({
      error: "Você já está com acesso — o resgate é para devolver o acesso de outra pessoa da família.",
    });
    return;
  }

  // Invariante 2 do produto: cuidador de outra família responde 404, nunca 403.
  // O `familyId` vem do token, jamais da URL.
  const [alvo] = await db
    .select({ userId: caregiversTable.userId, nome: caregiversTable.name })
    .from(caregiversTable)
    .where(and(eq(caregiversTable.id, caregiverId), eq(caregiversTable.familyId, getAuth(req).familyId)))
    .limit(1);

  if (!alvo) { res.status(404).json({ error: "Cuidador não encontrado" }); return; }

  // Convite aceito ainda não vinculado a uma conta não tem o que resgatar.
  if (alvo.userId === null) {
    res.status(400).json({
      error: "Essa pessoa ainda não criou a conta dela — não há acesso a restaurar.",
      code: "SEM_CONTA",
    });
    return;
  }

  const validoAte = new Date(Clock.now().getTime() + RESGATE_HORAS * 60 * 60 * 1000);

  await db
    .update(usersTable)
    .set({ resgateLiberadoAte: validoAte })
    .where(eq(usersTable.id, alvo.userId));

  // ── O aviso, e por que ele vem antes da resposta ────────────────────────
  //
  // Se a pessoa resgatada não pediu isto, este e-mail é a única coisa que a
  // avisa. Ele não impede o abuso; tira dele o silêncio, que é o que o torna
  // perigoso.
  const [resgatado] = await db
    .select({ email: usersTable.email })
    .from(usersTable)
    .where(eq(usersTable.id, alvo.userId))
    .limit(1);

  const [familia] = await db
    .select({ nome: familiesTable.name })
    .from(familiesTable)
    .where(eq(familiesTable.id, getAuth(req).familyId))
    .limit(1);

  const [quemResgatou] = await db
    .select({ nome: caregiversTable.name })
    .from(caregiversTable)
    .where(eq(caregiversTable.id, getAuth(req).caregiverId))
    .limit(1);

  if (resgatado) {
    await sendRescueNotice(
      resgatado.email,
      quemResgatou?.nome ?? "O cuidador principal",
      familia?.nome ?? "sua família",
      validoAte,
    );
  }

  safeLog.info(
    { action: "updated", entityType: "caregiver", familyId: getAuth(req).familyId },
    "Acesso restaurado pelo cuidador principal",
  );

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "caregiver",
    entityId: String(caregiverId),
    action: "updated",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip ?? undefined,
  });

  res.json({
    message: `Acesso de ${alvo.nome} restaurado. A próxima entrada dela, nas próximas ${RESGATE_HORAS} horas, não vai pedir o código de aparelho novo.`,
    validoAte,
  });
});

export default router;
