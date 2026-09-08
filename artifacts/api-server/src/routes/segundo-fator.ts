/**
 * Segundo fator: ativação, códigos de recuperação e aparelhos — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A ORDEM DESTAS ROTAS É A REGRA DE SEGURANÇA. GERAR OS CÓDIGOS, MOSTRAR,
 * CONFIRMAR QUE GUARDOU — E SÓ ENTÃO A TRANCA PASSA A VALER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O fundador decidiu que o segundo fator é obrigatório. Enquanto era opcional,
 * quem não quisesse simplesmente não ligava; obrigatório, essa saída não
 * existe — e quem perder o acesso ao e-mail perde a conta. Num app de
 * medicamento de idoso isso é cuidador trancado do lado de fora com a dose
 * para registrar.
 *
 * Por isso `POST /ativar` recusa quem não gerou os códigos antes. Não é
 * validação de formulário: é a única coisa que impede esta função de piorar o
 * produto.
 *
 * ── O que estas rotas deliberadamente NÃO têm ─────────────────────────────
 *
 * Não existe rota que desative o segundo fator. `users.segundo_fator_ativo_em`
 * é de mão única: nulo significa "ainda não ativou", nunca "desligou".
 */

import { Router } from "express";
import { z } from "zod";
import { and, eq, isNull, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, recoveryCodesTable, trustedDevicesTable } from "@workspace/db";

import { requireAuth } from "../middleware/require-auth";
import { getAuth } from "../lib/auth-types.ts";
import { verifyPassword } from "../lib/password";
import { Clock } from "../lib/clock";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { mensagemDeValidacao } from "../lib/erro-de-validacao.ts";
import { registrarAparelho, DIAS_DE_CONFIANCA } from "../lib/aparelho-confiavel.ts";
import {
  gerarCodigosDeRecuperacao,
  hashDoCodigoDeRecuperacao,
  normalizarCodigoDeRecuperacao,
  QUANTOS_CODIGOS,
  AVISAR_ABAIXO_DE,
} from "../lib/codigos-de-recuperacao.ts";

const router = Router();

/** Quantos códigos ainda valem para esta pessoa. */
async function codigosRestantes(userId: number): Promise<number> {
  const linhas = await db
    .select({ id: recoveryCodesTable.id })
    .from(recoveryCodesTable)
    .where(and(eq(recoveryCodesTable.userId, userId), isNull(recoveryCodesTable.usedAt)));
  return linhas.length;
}

// ── Estado ────────────────────────────────────────────────────────────────

router.get("/account/segundo-fator", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;

  const [user] = await db
    .select({ ativoEm: usersTable.segundoFatorAtivoEm, reserva: usersTable.recoveryEmail })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const restantes = await codigosRestantes(userId);

  res.json({
    ativoEm: user?.ativoEm ?? null,
    codigosRestantes: restantes,
    /** A tela avisa antes de acabar — descobrir no zero é descobrir tarde. */
    poucosCodigos: restantes > 0 && restantes < AVISAR_ABAIXO_DE,
    temEmailDeRecuperacao: Boolean(user?.reserva),
    diasDeConfianca: DIAS_DE_CONFIANCA,
  });
});

// ── Gerar os códigos ──────────────────────────────────────────────────────

const GerarBody = z.object({
  /**
   * Só exigida para REGERAR, e a assimetria é de propósito.
   *
   * Na primeira geração a pessoa acabou de entrar com a senha e ainda não tem
   * nenhuma proteção — pedir a senha de novo é atrito sem ganho. Depois de
   * ativado, gerar um jogo novo **invalida o antigo**, e uma sessão sequestrada
   * poderia usar isso para trocar as chaves reservas da conta sem saber a
   * senha. É o mesmo raciocínio do e-mail de recuperação (#87), onde apagar
   * exige senha e cadastrar não.
   */
  senhaAtual: z.string().optional(),
});

router.post("/account/segundo-fator/codigos", requireAuth, async (req, res): Promise<void> => {
  const body = GerarBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: mensagemDeValidacao(body.error) }); return; }

  const userId = getAuth(req).userId;
  const [user] = await db
    .select({ ativoEm: usersTable.segundoFatorAtivoEm, hash: usersTable.passwordHash })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  if (user.ativoEm) {
    const senha = body.data.senhaAtual ?? "";
    const confere = user.hash && user.hash !== "!" ? await verifyPassword(user.hash, senha) : false;
    if (!confere) {
      res.status(401).json({
        error: "Digite sua senha atual para gerar códigos novos — os antigos deixam de valer.",
      });
      return;
    }
  }

  const codigos = gerarCodigosDeRecuperacao();

  // Apagar antes de inserir: quem pede um jogo novo está dizendo que o antigo
  // se perdeu, ou vazou. Manter os dois válidos manteria viva exatamente a
  // lista que a pessoa quis anular.
  await db.transaction(async (tx) => {
    await tx.delete(recoveryCodesTable).where(eq(recoveryCodesTable.userId, userId));
    await tx.insert(recoveryCodesTable).values(
      codigos.map((codigo) => ({
        userId,
        codeHash: hashDoCodigoDeRecuperacao(userId, normalizarCodigoDeRecuperacao(codigo) ?? codigo),
      })),
    );
  });

  safeLog.info({ action: "codigos_de_recuperacao_gerados", userId }, "Codigos de recuperacao gerados");
  await audit({
    familyId: getAuth(req).familyId,
    entityType: "recovery_codes",
    entityId: String(userId),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip ?? undefined,
  });

  // A única vez que os códigos crus existem fora do papel da pessoa.
  res.json({ codigos, quantos: codigos.length });
});

// ── Ativar ────────────────────────────────────────────────────────────────

router.post("/account/segundo-fator/ativar", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;

  const [user] = await db
    .select({ ativoEm: usersTable.segundoFatorAtivoEm })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!user) { res.status(404).json({ error: "Conta não encontrada" }); return; }

  if (user.ativoEm) {
    res.status(409).json({ error: "O segundo fator já está ativo nesta conta.", ativoEm: user.ativoEm });
    return;
  }

  // ── A recusa que sustenta a função inteira ──────────────────────────────
  //
  // Sem códigos guardados, ativar seria trancar a porta e jogar fora a chave
  // reserva. Esta rota é chamada logo depois da tela que mostra os códigos —
  // se ela chegar aqui sem eles, alguma coisa quebrou no caminho, e o certo é
  // não ativar.
  if ((await codigosRestantes(userId)) < QUANTOS_CODIGOS) {
    res.status(400).json({
      error: "Gere e guarde seus códigos de recuperação antes de ativar.",
      code: "SEM_CODIGOS",
    });
    return;
  }

  const agora = Clock.now();
  await db.update(usersTable).set({ segundoFatorAtivoEm: agora }).where(eq(usersTable.id, userId));

  // O aparelho de agora entra confiável junto. Sem isto a pessoa terminaria a
  // ativação e a entrada seguinte, no mesmo navegador, pediria código — o que
  // faria a ativação parecer que deu errado.
  const deviceToken = await registrarAparelho(userId, req.headers["user-agent"] ?? null, req.ip ?? null);

  safeLog.info({ action: "segundo_fator_ativado", userId }, "Segundo fator ativado");
  await audit({
    familyId: getAuth(req).familyId,
    entityType: "second_factor",
    entityId: String(userId),
    action: "created",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
    ipAddress: req.ip ?? undefined,
  });

  res.json({ ativoEm: agora, deviceToken, diasDeConfianca: DIAS_DE_CONFIANCA });
});

// ── Aparelhos ─────────────────────────────────────────────────────────────
//
// "Lista de aparelhos sem botão de revogar é enfeite" — Issue #79. As duas
// rotas abaixo existem por causa dessa frase.

router.get("/account/aparelhos", requireAuth, async (req, res): Promise<void> => {
  const aparelhos = await db
    .select({
      id: trustedDevicesTable.id,
      label: trustedDevicesTable.label,
      createdIp: trustedDevicesTable.createdIp,
      lastUsedAt: trustedDevicesTable.lastUsedAt,
      expiresAt: trustedDevicesTable.expiresAt,
      createdAt: trustedDevicesTable.createdAt,
    })
    .from(trustedDevicesTable)
    .where(
      and(
        eq(trustedDevicesTable.userId, getAuth(req).userId),
        eq(trustedDevicesTable.revoked, false),
      ),
    )
    .orderBy(desc(trustedDevicesTable.lastUsedAt));

  res.json(aparelhos);
});

router.delete("/account/aparelhos/:id", requireAuth, async (req, res): Promise<void> => {
  const id = Number(req.params.id);
  if (isNaN(id)) { res.status(400).json({ error: "ID inválido" }); return; }

  // O `user_id` vem do token, nunca da URL — invariante 2 do produto. Aparelho
  // de outra pessoa responde 404, não 403.
  const [aparelho] = await db
    .select({ id: trustedDevicesTable.id })
    .from(trustedDevicesTable)
    .where(
      and(
        eq(trustedDevicesTable.id, id),
        eq(trustedDevicesTable.userId, getAuth(req).userId),
        eq(trustedDevicesTable.revoked, false),
      ),
    )
    .limit(1);

  if (!aparelho) { res.status(404).json({ error: "Aparelho não encontrado" }); return; }

  await db
    .update(trustedDevicesTable)
    .set({ revoked: true, revokedAt: Clock.now() })
    .where(eq(trustedDevicesTable.id, id));

  safeLog.info({ action: "aparelho_revogado", userId: getAuth(req).userId }, "Aparelho revogado");
  res.json({ revogado: true });
});

router.post("/account/aparelhos/sair-de-todos", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;

  // Inclui o aparelho de quem está pedindo, de propósito. Quem clica nisto
  // está dizendo "não sei mais quem tem acesso" — e a resposta certa a essa
  // frase é pedir código na próxima entrada de todos, inclusive dela.
  const revogados = await db
    .update(trustedDevicesTable)
    .set({ revoked: true, revokedAt: Clock.now() })
    .where(and(eq(trustedDevicesTable.userId, userId), eq(trustedDevicesTable.revoked, false)))
    .returning({ id: trustedDevicesTable.id });

  safeLog.warn({ action: "aparelhos_revogados", userId }, "Todos os aparelhos revogados");
  res.json({ revogados: revogados.length });
});

export default router;
