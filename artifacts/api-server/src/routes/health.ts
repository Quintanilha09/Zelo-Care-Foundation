import { Router, type IRouter } from "express";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

/**
 * As duas perguntas de saúde — Issue #196.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELAS NUNCA FORAM A MESMA, E TRATÁ-LAS ASSIM DERRUBA O APP.
 *
 * Até aqui existia só `/healthz`, e ele consultava o banco. O comentário no
 * próprio arquivo dizia que era usado "por load balancer e monitoramento
 * externo" — duas coisas diferentes recebendo a mesma resposta.
 *
 * O balanceador do Lightsail REINICIA o contêiner que responde fora da faixa
 * saudável. Com a versão antiga, um banco que piscasse por trinta segundos
 * (janela de manutenção da AWS, failover, tempestade de conexões) faria o
 * `/healthz` responder 503, o balanceador concluir que o APP está doente, e o
 * contêiner ser reiniciado.
 *
 * Só que o app não estava doente. E o reinício levaria junto o pg-boss e
 * todas as conexões SSE abertas — transformando uma indisponibilidade curta
 * do banco numa indisponibilidade longa do aplicativo, causada pela própria
 * verificação de saúde.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   GET /healthz  — "este processo está vivo?"    → quem pergunta é o balanceador
 *   GET /readyz   — "ele consegue atender?"       → quem pergunta é o monitoramento
 *
 * As duas são públicas, como antes: nenhuma revela nada que ajude um atacante.
 */
const router: IRouter = Router();

/**
 * Vivo.
 *
 * Responde 200 enquanto o processo estiver de pé e conseguindo atender
 * requisição. Não toca no banco de propósito: banco fora do ar é problema do
 * banco, e reiniciar este contêiner não conserta nenhum deles.
 *
 * Mantém `uptimeSeconds` porque quem investiga uma reinicialização quer saber,
 * na primeira olhada, há quanto tempo o processo subiu.
 */
router.get("/healthz", (_req, res): void => {
  res.status(200).json({
    status: "ok",
    uptimeSeconds: Math.floor(process.uptime()),
  });
});

/**
 * Pronto.
 *
 * É a verificação profunda que o `/healthz` fazia antes: uma consulta mínima
 * ao banco, sem tocar em dado de usuário. 200 quando dá para atender, 503
 * quando não dá.
 *
 * É esta que o monitoramento externo e a página de estado devem olhar — e é
 * ela que responde "o app está de pé mas o banco caiu", que era exatamente a
 * informação que se perdia quando as duas perguntas eram uma só.
 */
router.get("/readyz", async (_req, res): Promise<void> => {
  const comecou = process.hrtime.bigint();

  try {
    await db.execute(sql`SELECT 1`);

    res.status(200).json({
      status: "ok",
      db: "ok",
      uptimeSeconds: Math.floor(process.uptime()),
      dbLatencyMs: Math.round(Number(process.hrtime.bigint() - comecou) / 1_000_000),
    });
  } catch {
    /**
     * A mensagem do driver NÃO sai daqui.
     *
     * Um erro de conexão do `pg` traz host, porta e às vezes o usuário do
     * banco. Numa rota pública, isso é mapa entregue de graça. Quem precisa do
     * detalhe tem o log do servidor; quem chama a rota precisa apenas saber
     * que o banco não respondeu.
     */
    res.status(503).json({
      status: "error",
      db: "error",
      error: "banco de dados não respondeu",
    });
  }
});

export default router;
