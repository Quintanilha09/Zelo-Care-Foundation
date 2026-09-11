import { useEffect, useState } from "react";

/**
 * "Agora", atualizado a cada minuto — Issue #153.
 *
 * ── Por que uma tela de dose precisa disto ───────────────────────────────
 *
 * Uma dose vira atrasada **sozinha**, com o tempo passando. Sem um pulso, a
 * tela mostraria "Pendente" para sempre em quem deixou o app aberto — que é
 * justamente o cuidador acompanhando o horário chegar.
 *
 * ── Por que um minuto, e não um segundo ──────────────────────────────────
 *
 * O pulso de desfazer (#135) é de um segundo porque o prazo dele é de
 * sessenta: errar por um segundo lá é errar 1,7% da janela. Aqui a carência é
 * de trinta minutos e o texto fala em minutos — um segundo de precisão não
 * mudaria um pixel, e custaria sessenta vezes mais renderizações.
 *
 * ── Por que não desliga ──────────────────────────────────────────────────
 *
 * Diferente do pulso de desfazer, que morre quando o prazo vence, este não
 * tem fim: sempre existe uma próxima dose podendo atrasar. Um `setInterval`
 * de um minuto é barato o bastante para isso não ser um problema, e a
 * alternativa — ligar e desligar conforme a lista — seria mais código para
 * economizar o que não custa.
 */
export function usePulsoDeMinuto(): number {
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setAgora(Date.now()), 60_000);
    return () => clearInterval(id);
  }, []);

  return agora;
}
