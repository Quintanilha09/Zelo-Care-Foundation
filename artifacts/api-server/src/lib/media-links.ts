/**
 * Link de leitura de mídia, curto e assinado — QUI-5.
 *
 * ── O problema ────────────────────────────────────────────────────────────
 *
 * A sessão do ZELO é `Authorization: Bearer` com o access token guardado só
 * em memória (nunca em localStorage — ver lib/auth-client.ts do front). Isso
 * protege de XSS, mas cria uma consequência: **`<img src="...">` não manda
 * header nenhum.** Uma rota de imagem atrás de `requireAuth` simplesmente
 * não renderiza numa tag `<img>`.
 *
 * ── A solução, e por que não é um token no banco ──────────────────────────
 *
 * `export_tokens` e `adherence_reports` guardam o hash do token numa linha.
 * Funciona porque cada um é gerado uma vez e usado poucas vezes.
 *
 * Mídia é diferente: abrir um mural com 20 fotos gravaria 20 linhas, toda
 * vez que alguém rolasse a tela, mais um job para limpar. Aqui o link é
 * **sem estado**: id, validade e assinatura viajam no próprio token, e a
 * validade é verificada pela assinatura. Nada é gravado, nada precisa ser
 * limpo.
 *
 * ── Por que isto NÃO repete o erro do ADMIN_PANEL_SECRET ──────────────────
 *
 * Em 23/08/2026 este projeto descobriu que `ADMIN_PANEL_SECRET` igual a
 * `SESSION_SECRET` fazia um token de admin ser aceito como sessão de
 * cuidador. A lição não foi "nunca derive de outro segredo" — foi "duas
 * coisas diferentes não podem ter a mesma chave e o mesmo formato".
 *
 * Aqui as duas condições estão quebradas de propósito:
 *
 *   1. **A chave é outra.** É HMAC-SHA256(SESSION_SECRET, rótulo fixo) —
 *      separação de domínio. O valor derivado nunca é igual ao original, e
 *      a derivação é de mão única: quem tiver a chave de mídia não volta
 *      para o SESSION_SECRET.
 *   2. **O formato é outro.** Este token é `id.exp.assinatura`, não um JWT.
 *      `jwt.verify` recusa antes de olhar a chave, e o verificador daqui
 *      recusa um JWT. Há teste para os dois sentidos.
 *
 * O ganho de não criar um Secret novo é concreto: mais um valor para
 * configurar é mais um jeito de o app subir meio quebrado — que é
 * exatamente a história do `ADMIN_PANEL_SECRET`, ausente por dias.
 *
 * ── Validade ──────────────────────────────────────────────────────────────
 *
 * 10 minutos. Tempo de sobra para carregar um mural inteiro, curto o
 * bastante para que um link copiado de um histórico de navegação não sirva
 * de nada depois.
 */

import crypto from "node:crypto";
import { Clock } from "./clock.ts";

/** Segundos de vida de um link. Curto de propósito. */
export const VALIDADE_DO_LINK_SEGUNDOS = 10 * 60;

const ROTULO_DE_DOMINIO = "zelo:media-link:v1";

let chaveDerivada: Buffer | null = null;

function chave(): Buffer {
  if (chaveDerivada) return chaveDerivada;
  const base = process.env.SESSION_SECRET;
  if (!base) throw new Error("SESSION_SECRET não definido — configure o segredo no vault");
  chaveDerivada = crypto.createHmac("sha256", base).update(ROTULO_DE_DOMINIO).digest();
  return chaveDerivada;
}

function assinar(corpo: string): string {
  return crypto.createHmac("sha256", chave()).update(corpo).digest("base64url");
}

/** Gera o token de leitura de uma mídia. Só chame depois de autorizar o acesso. */
export function gerarTokenDeMidia(assetId: number): { token: string; expiraEm: Date } {
  const expSec = Math.floor(Clock.now().getTime() / 1000) + VALIDADE_DO_LINK_SEGUNDOS;
  const corpo = `${assetId}.${expSec}`;
  return {
    token: `${corpo}.${assinar(corpo)}`,
    expiraEm: new Date(expSec * 1000),
  };
}

/**
 * Devolve o id da mídia, ou `null` se o token for inválido, adulterado ou
 * vencido. Nunca lança — token quebrado é caso comum, não excepcional.
 */
export function lerTokenDeMidia(token: string): number | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;

  const [idBruto, expBruto, assinatura] = partes;
  const corpo = `${idBruto}.${expBruto}`;

  const esperada = Buffer.from(assinar(corpo));
  const recebida = Buffer.from(assinatura);
  // Comparação em tempo constante, e só depois de conferir o tamanho —
  // timingSafeEqual lança se os buffers tiverem comprimentos diferentes.
  if (esperada.length !== recebida.length) return null;
  if (!crypto.timingSafeEqual(esperada, recebida)) return null;

  const expSec = Number(expBruto);
  if (!Number.isSafeInteger(expSec)) return null;
  if (Math.floor(Clock.now().getTime() / 1000) >= expSec) return null;

  const id = Number(idBruto);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

/** Só para teste: força a chave a ser derivada de novo. */
export function reiniciarChaveParaTeste(): void {
  chaveDerivada = null;
}
