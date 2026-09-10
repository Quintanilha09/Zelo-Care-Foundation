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

/** Segundos de vida de um link de MÍDIA. Curto de propósito. */
export const VALIDADE_DO_LINK_SEGUNDOS = 10 * 60;

/**
 * Segundos de vida do link da FOTO DE PERFIL — Issue #132.
 *
 * ── Por que não são os mesmos 10 minutos ─────────────────────────────────
 *
 * Os 10 minutos acima foram desenhados para o mural: muitas fotos, de
 * paciente, sensíveis, abertas uma vez e nunca mais. A foto de perfil é o
 * oposto — **uma só, da própria pessoa, em toda tela**, e remontada o tempo
 * todo pela navegação do SPA.
 *
 * ── O defeito que isto conserta ──────────────────────────────────────────
 *
 * A rota que serve a foto manda `Cache-Control: private, max-age=86400`, ou
 * seja: *"navegador, guarde por um dia"*. E assinava um token que morria em
 * dez minutos. Os dois números da mesma rota discordavam por **144×**.
 *
 * Enquanto o cache do navegador tem a URL, ninguém percebe. Quando não tem —
 * janela anônima, cache limpo, DevTools com *Disable cache*, outro aparelho,
 * ou a foto sendo a primeira coisa pedida depois de dez minutos de app
 * aberto — a imagem recebe **410** e o Radix cai no `AvatarFallback`: a foto
 * **volta a ser as iniciais, sem erro nenhum na tela**.
 *
 * Foi o que o fundador viu, e o que o fez concluir que a foto não tinha sido
 * salva.
 *
 * ── A regra, agora escrita ───────────────────────────────────────────────
 *
 * **O token tem que viver pelo menos tanto quanto o cache que a própria rota
 * manda o navegador guardar.** Um link que morre antes do cache que ele
 * mesmo autorizou é uma contradição, não uma escolha de segurança. Há um
 * teste que falha se os dois voltarem a discordar.
 *
 * O que a validade maior custa: se esta URL vazar (histórico, log), ela abre
 * o rosto de um cuidador por 24 h em vez de 10 min. É rosto de adulto que
 * escolheu publicá-lo para a própria família — não é a mesma classe de dado
 * que uma foto de paciente no mural, e por isso a conta fecha diferente.
 *
 * ── O que NÃO precisou entrar junto ──────────────────────────────────────
 *
 * Um `?v=` para invalidar o cache quando a foto troca. Ele está prometido
 * num comentário da rota desde a #116 e nunca existiu — e não existe porque
 * **não é preciso**: o token embute o instante de expiração, então muda a
 * cada leitura, e a URL nova já é o que invalida a antiga. Quem trocar isto
 * por um token estável (para o cache passar a valer de verdade) aí sim
 * precisa do `v`; hoje ele seria peça sem função.
 */
export const VALIDADE_DA_FOTO_SEGUNDOS = 24 * 60 * 60;

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

// ── Foto de perfil do cuidador — Issue #116 ──────────────────────────────
//
// Mesmo problema, mesma solução: `<img src>` não manda header, então a foto
// de perfil precisa de um link assinado igual ao da mídia.
//
// ── Por que uma chave PRÓPRIA, e não a de mídia ──────────────────────────
//
// São duas autorizações diferentes. Um token de mídia diz "pode ver o asset
// 7 do mural"; um de foto diz "pode ver o rosto do cuidador 7". Com a mesma
// chave, os dois teriam o mesmo corpo `7.exp` e a MESMA assinatura — um token
// de mídia abriria a foto de um cuidador cujo id coincidisse, e vice-versa.
//
// A separação de domínio é o rótulo abaixo: a chave derivada é outra, então
// um token assinado para mídia simplesmente não verifica aqui. É a lição do
// `ADMIN_PANEL_SECRET` aplicada entre dois usos internos.

const ROTULO_DE_FOTO = "zelo:avatar-link:v1";

let chaveDaFoto: Buffer | null = null;

function chaveParaFoto(): Buffer {
  if (chaveDaFoto) return chaveDaFoto;
  const base = process.env.SESSION_SECRET;
  if (!base) throw new Error("SESSION_SECRET não definido — configure o segredo no vault");
  chaveDaFoto = crypto.createHmac("sha256", base).update(ROTULO_DE_FOTO).digest();
  return chaveDaFoto;
}

function assinarFoto(corpo: string): string {
  return crypto.createHmac("sha256", chaveParaFoto()).update(corpo).digest("base64url");
}

/** Gera o link da foto de um cuidador. Só chame depois de autorizar o acesso. */
export function gerarTokenDeFoto(caregiverId: number): string {
  // #132: `VALIDADE_DA_FOTO_SEGUNDOS`, e não a do mural. Ver o porquê inteiro
  // na declaração da constante — em resumo, o token precisa durar pelo menos
  // o que o `Cache-Control` da própria rota manda o navegador guardar.
  const expSec = Math.floor(Clock.now().getTime() / 1000) + VALIDADE_DA_FOTO_SEGUNDOS;
  const corpo = `${caregiverId}.${expSec}`;
  return `${corpo}.${assinarFoto(corpo)}`;
}

/**
 * Devolve o id do cuidador, ou `null` se o token for inválido, adulterado,
 * vencido — ou assinado para outro uso. Nunca lança.
 */
export function lerTokenDeFoto(token: string): number | null {
  const partes = token.split(".");
  if (partes.length !== 3) return null;

  const [idBruto, expBruto, assinatura] = partes;
  const esperada = Buffer.from(assinarFoto(`${idBruto}.${expBruto}`));
  const recebida = Buffer.from(assinatura);
  if (esperada.length !== recebida.length) return null;
  if (!crypto.timingSafeEqual(esperada, recebida)) return null;

  const expSec = Number(expBruto);
  if (!Number.isSafeInteger(expSec)) return null;
  if (Math.floor(Clock.now().getTime() / 1000) >= expSec) return null;

  const id = Number(idBruto);
  if (!Number.isSafeInteger(id) || id <= 0) return null;
  return id;
}

/** Só para teste: força as chaves a serem derivadas de novo. */
export function reiniciarChaveParaTeste(): void {
  chaveDerivada = null;
  chaveDaFoto = null;
}
