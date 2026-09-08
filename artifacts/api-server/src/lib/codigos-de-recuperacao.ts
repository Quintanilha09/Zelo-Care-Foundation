/**
 * Códigos de recuperação — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTES CÓDIGOS ENTRAM NO LUGAR DO CÓDIGO DO E-MAIL. QUEM TIVER UM DELES E A
 * SENHA ENTRA NA CONTA. SÃO CREDENCIAL, NÃO LEMBRETE — E O TAMANHO DELES É A
 * ÚNICA DEFESA QUE ELES TÊM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O código de 6 dígitos do e-mail pode ser curto porque morre em 10 minutos e
 * tem contador de tentativas. Estes valem até serem usados, e não têm contador
 * próprio. A conta precisa fechar sozinha:
 *
 *   32 símbolos ^ 10 posições ≈ 1,1 quatrilhão (2^50)
 *
 * Mesmo com o limitador de login desligado por engano, adivinhar um é
 * inviável. Encurtar para caber melhor na tela é o tipo de "melhoria" que
 * derruba isso sem sintoma nenhum.
 */

import { randomInt, createHash } from "node:crypto";

/**
 * O alfabeto, sem os caracteres que a pessoa vai copiar errado.
 *
 * Fora: **I, O, 0 e 1**. Estes códigos são pensados para serem impressos e
 * digitados à mão, às vezes por alguém que não vê bem — e "zero ou ó?" é uma
 * dúvida que custa uma tentativa em papel amassado, seis meses depois, no dia
 * em que a pessoa está sem acesso à conta. Trinta e dois símbolos também dão
 * exatamente 5 bits cada, o que torna a conta acima exata.
 */
const ALFABETO = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** Dez posições, em dois grupos de cinco: `ABCDE-FGHJK`. Como o GitHub. */
const POSICOES = 10;
const TAMANHO_DO_GRUPO = 5;

/**
 * Quantos códigos a pessoa recebe.
 *
 * Dez cobre a vida real de quem troca de celular e reinstala o navegador
 * algumas vezes sem nunca pensar nisto de novo. Menos faria a lista acabar
 * calada, e "acabou" aqui significa conta perdida.
 */
export const QUANTOS_CODIGOS = 10;

/**
 * Abaixo de quantos códigos restantes a tela avisa.
 *
 * O aviso existe porque o custo de descobrir tarde é alto demais: quem chega a
 * zero sem perceber só descobre no dia em que o e-mail já se perdeu.
 */
export const AVISAR_ABAIXO_DE = 3;

/**
 * Sorteia um jogo de códigos.
 *
 * `randomInt` do módulo `crypto`, nunca `Math.random()` — isto é credencial, e
 * `Math.random()` é previsível a partir de algumas saídas observadas.
 *
 * `randomInt(0, 32)` também é uniforme de verdade: usar `% 32` sobre um byte
 * enviesaria o alfabeto (256 não é múltiplo de 32 para qualquer alfabeto, e a
 * armadilha é clássica).
 */
export function gerarCodigosDeRecuperacao(quantos: number = QUANTOS_CODIGOS): string[] {
  const codigos: string[] = [];
  for (let i = 0; i < quantos; i += 1) {
    let bruto = "";
    for (let p = 0; p < POSICOES; p += 1) bruto += ALFABETO[randomInt(0, ALFABETO.length)];
    codigos.push(formatar(bruto));
  }
  return codigos;
}

/** `ABCDEFGHJK` → `ABCDE-FGHJK`. O hífen é só para os olhos. */
function formatar(bruto: string): string {
  return `${bruto.slice(0, TAMANHO_DO_GRUPO)}-${bruto.slice(TAMANHO_DO_GRUPO)}`;
}

/**
 * Aceita o que a pessoa realmente digita, e recusa o resto.
 *
 * Passa: `abcde-fghjk`, `ABCDE FGHJK`, `ABCDEFGHJK`. O hífen é decoração, o
 * espaço vem do copiar-e-colar, e minúscula é como metade dos teclados de
 * celular começa. Nada disso muda o segredo, e recusar por causa disso seria
 * transformar a chave reserva em armadilha.
 *
 * Não passa: qualquer coisa com I, O, 0 ou 1 — eles não existem no alfabeto,
 * então quem os digitou errou de fato. **Não corrigimos por adivinhação**
 * (trocar O por 0, por exemplo): isso multiplicaria silenciosamente as
 * tentativas válidas por palpite.
 */
export function normalizarCodigoDeRecuperacao(bruto: unknown): string | null {
  if (typeof bruto !== "string") return null;
  const limpo = bruto.replace(/[\s-]/g, "").toUpperCase();
  if (limpo.length !== POSICOES) return null;
  for (const c of limpo) if (!ALFABETO.includes(c)) return null;
  return formatar(limpo);
}

/**
 * Hash do código, preso ao usuário.
 *
 * O sal é o mesmo de `codigo-de-verificacao.ts`, e pela mesma razão: separar
 * usuários, para que o código de um nunca case com a linha do outro. Aqui não
 * é ofuscação — com 2^50 possibilidades, SHA-256 sem sal já seria inquebrável
 * na prática.
 *
 * Recebe o código **normalizado**; guardar o hash do que a pessoa digitou
 * cru faria `abcde-fghjk` e `ABCDEFGHJK` virarem segredos diferentes.
 */
export function hashDoCodigoDeRecuperacao(userId: number, codigoNormalizado: string): string {
  return createHash("sha256").update(`${userId}:${codigoNormalizado}`).digest("hex");
}
