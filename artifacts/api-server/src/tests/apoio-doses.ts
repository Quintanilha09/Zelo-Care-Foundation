/**
 * Apoio de fixture para testes que registram dose — Issue #134.
 *
 * ── Por que este arquivo precisou existir ─────────────────────────────────
 *
 * A geração de doses só cria dose **do agora para a frente**
 * (`lib/dose-generation.ts`). Por isso quase todo fixture da suíte usa a
 * posologia `["00:01", "23:59"]`: garante que existe uma dose hoje, a
 * qualquer hora que o CI rode. O efeito colateral é que essa dose é, quase
 * sempre, a das **23:59** — ou seja, horas à frente.
 *
 * Até a #134 isso não importava, porque registrar dose não olhava o horário
 * agendado. Agora olha: uma dose muito adiantada exige `confirmarAntecipacao`.
 *
 * ── A escolha, e por que não foi a outra ─────────────────────────────────
 *
 * Havia dois caminhos:
 *
 *   1. pôr `confirmarAntecipacao: true` nas ~45 chamadas de `dose-records`
 *      espalhadas pela suíte;
 *   2. **fazer o fixture produzir uma dose que já chegou.**
 *
 * O primeiro parece menor, e é pior: cada um daqueles testes deixaria de
 * exercer o caminho normal — o de quem aperta o botão na hora certa — e
 * passaria a exercer o caminho excepcional, sem que o nome de nenhum deles
 * dissesse isso. Uma regressão futura no caminho normal não seria vista por
 * nenhum dos 45.
 *
 * Este arquivo é o segundo caminho. O teste que precisa provar a **recusa**
 * simplesmente não chama isto — é o que o `dose-antecipada.test.ts` faz.
 */

import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { scheduledDosesTable } from "@workspace/db";
import { Clock } from "../lib/clock.ts";

/**
 * Traz uma dose agendada para o instante de agora, para o fixture ter uma
 * dose **que chegou** em vez de uma lá das 23:59.
 *
 * Só mexe em `scheduledAt`. `scheduledLocalTime` continua sendo a etiqueta
 * que o tratamento gerou — nenhum teste depende de as duas baterem, e
 * mudá-la faria o fixture mentir sobre a posologia.
 */
export async function puxarDoseParaAgora(doseId: number): Promise<void> {
  await db
    .update(scheduledDosesTable)
    .set({ scheduledAt: Clock.now() })
    .where(eq(scheduledDosesTable.id, doseId));
}
