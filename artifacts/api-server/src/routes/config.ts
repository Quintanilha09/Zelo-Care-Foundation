import { Router } from "express";
import { requireAuth } from "../middleware/require-auth";

/**
 * Capacidades opcionais do app que dependem de configuração externa.
 *
 * Mesmo contrato de `/auth/google/status` e `/auth/email/status`: a tela
 * pergunta se a capacidade existe, e se adapta em vez de oferecer um caminho
 * que não conclui.
 */
const router = Router();

/**
 * Chave do Google Maps para o navegador.
 *
 * ── Por que devolver uma chave pelo endpoint não é vazamento ──────────────
 *
 * A chave do Maps JavaScript API é **pública por construção**: ela roda no
 * navegador, dentro do bundle, e qualquer pessoa com a página aberta a
 * enxerga. Não existe forma de usar o Maps no cliente sem ela ficar visível.
 *
 * O que protege a cota NÃO é esconder a chave — é a **restrição por
 * referenciador HTTP** configurada no Google Cloud, que faz a chave só
 * funcionar a partir do domínio do app. Uma chave copiada não serve para nada
 * fora dele.
 *
 * Entregar pelo endpoint, em vez de embutir no build, tem duas vantagens
 * concretas: a chave pode ser trocada sem rebuild, e o app continua subindo
 * quando ela não existe (o campo vira texto livre em vez de quebrar).
 *
 * `requireAuth` fica mesmo assim: não protege a chave em si, mas evita que
 * qualquer robô anônimo colete o endpoint. Custo zero, ganho pequeno e real.
 *
 * NUNCA colocar aqui uma chave de servidor (Anthropic, VAPID privada,
 * SESSION_SECRET). Este endpoint é exclusivo de chave que já seria pública.
 */
router.get("/config/maps", requireAuth, (_req, res): void => {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const configurado = typeof apiKey === "string" && apiKey.length > 0;

  res.json({
    configured: configurado,
    apiKey: configurado ? apiKey : null,
  });
});

export default router;
