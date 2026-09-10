import { useEffect, useState } from "react";

/**
 * O prazo de desfazer uma dose — Issue #135.
 *
 * ── O que isto substitui, e por quê ───────────────────────────────────────
 *
 * Antes, a tela inicial guardava um `undoableRecordId` no estado do React e
 * o apagava com um `setTimeout` de 60 s. Três defeitos vinham juntos:
 *
 *   1. **Recarregar a página perdia o desfazer**, mesmo dentro do prazo — o
 *      estado morria com a aba.
 *   2. Só existia para quem tinha **vencido a corrida** do registro; outro
 *      cuidador que visse o engano não tinha botão nenhum.
 *   3. A ficha do paciente não tinha nada disso.
 *
 * Agora a fonte é o **servidor**: `today-doses` manda `desfazerAte`, um
 * instante pronto, em toda dose já registrada. Não há estado a perder, não
 * há dono do registro, e as duas telas leem a mesma coisa.
 *
 * ── Por que um pulso na página, e não um hook por dose ───────────────────
 *
 * As doses são renderizadas num `map`, e hook dentro de laço é proibido —
 * a quantidade de doses muda entre renderizações. Então o hook fica **uma
 * vez** na página, devolvendo "agora", e a decisão por dose é uma função
 * pura.
 *
 * ── E por que precisa de relógio ─────────────────────────────────────────
 *
 * Uma comparação feita só na renderização acertaria apenas naquele instante:
 * quem registra e fica olhando a tela veria o botão vivo muito depois de o
 * prazo vencer, e o toque devolveria 409. O tique faz o botão sumir sozinho,
 * na hora certa.
 *
 * O temporizador **só existe enquanto há prazo aberto**: ele nasce quando
 * alguma dose é registrada e morre no segundo em que o último prazo vence.
 * Uma tela parada, sem registro recente, não fica com nada rodando.
 */
export function usePulsoDeDesfazer(ultimoPrazo: number | null): number {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    if (ultimoPrazo === null || ultimoPrazo <= Date.now()) return;

    const id = setInterval(() => {
      const t = Date.now();
      setAgora(t);
      if (t > ultimoPrazo) clearInterval(id);
    }, 1000);

    return () => clearInterval(id);
  }, [ultimoPrazo]);

  return agora;
}

/**
 * O instante em que o último prazo de desfazer da lista vence, ou `null` se
 * não há nenhum aberto. É o que o pulso acima precisa saber para se desligar.
 */
export function ultimoPrazoDeDesfazer(
  doses: Array<{ desfazerAte?: string | null }>,
): number | null {
  let maior: number | null = null;
  for (const d of doses) {
    if (!d.desfazerAte) continue;
    const t = new Date(d.desfazerAte).getTime();
    if (!Number.isFinite(t)) continue;
    if (maior === null || t > maior) maior = t;
  }
  return maior;
}

/** Decisão por dose. Pura de propósito — dá para chamar dentro do `map`. */
export function podeDesfazer(
  desfazerAte: string | null | undefined,
  agora: number,
): boolean {
  if (!desfazerAte) return false;
  const limite = new Date(desfazerAte).getTime();
  return Number.isFinite(limite) && limite > agora;
}
