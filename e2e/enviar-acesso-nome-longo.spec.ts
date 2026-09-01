import { expect, test } from "@playwright/test";
import { criarConta, criarPaciente, entrar, naoRolaNaHorizontal, tokenDaConta } from "./apoio";

/**
 * O bloco de "Modo idoso" aguenta um nome longo — Issue #55.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * `patient-access-card.tsx:89` escrevia o rótulo do botão como
 * `Enviar acesso para ${patientName}`, sem `max-w`, sem `truncate` e sem
 * `min-w-0`. Nome longo saía da caixa.
 *
 * A linha logo acima tinha o mesmo problema por outro caminho: o nome num
 * `<p>` dentro de um flex, ao lado do selo "recomendado", sem nada que
 * impedisse o nome de empurrar o selo para fora.
 *
 * ── Por que o rótulo virou estático ───────────────────────────────────────
 *
 * Não é só encurtar por encurtar: o nome é dito **duas vezes** nas linhas
 * imediatamente acima do botão ("No celular de X" e "X abre no próprio
 * celular"). O botão repetia uma terceira vez e pagava o preço do estouro.
 *
 * ── A régua é a da QUI-15 ─────────────────────────────────────────────────
 *
 * O mesmo padrão de medição do cabeçalho da ficha: `scrollWidth` contra
 * `clientWidth`, e a página não pode rolar de lado. Aquela história provou
 * que isto pega defeito de verdade — este bloco só não estava no escopo dela.
 */

/** 56 caracteres, 7 palavras: cabe no teto de 60 da #56 e ainda assim dói. */
const NOME_LONGO = "Maria Aparecida da Conceicao Nascimento Ferreira Andrade";

test.describe("Modo idoso com nome longo", () => {
  test("o botão de enviar acesso não estoura, e a página não rola de lado", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request);
    const pacienteId = await criarPaciente(request, conta, NOME_LONGO);
    const token = await tokenDaConta(request, conta);

    // O bloco só existe com o modo idoso ligado. Ligar pela API mantém o
    // teste sobre o layout, e não sobre o interruptor.
    const ligado = await request.patch(`/api/patients/${pacienteId}/elder-mode`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { enabled: true },
    });
    expect(ligado.ok(), `ligar o modo idoso falhou: ${await ligado.text()}`).toBeTruthy();

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);

    const botao = page.getByRole("button", { name: "Enviar acesso", exact: true });
    await expect(botao).toBeVisible({ timeout: 15_000 });

    // O conteúdo do botão cabe dentro do botão. Era isto que falhava.
    const estoura = await botao.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(estoura, "o rótulo do botão está mais largo que o botão").toBeLessThanOrEqual(1);

    // E o selo "recomendado" continua na linha, não empurrado para fora pelo
    // nome que vem antes dele.
    await expect(page.getByText("recomendado")).toBeVisible();

    await naoRolaNaHorizontal(page);
  });
});
