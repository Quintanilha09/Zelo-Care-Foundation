import { test, expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { criarConta, criarPaciente, criarTratamentoHoje, entrar } from "./apoio";

/**
 * Desfazer um registro de dose — Issue #135.
 *
 * ── O que só a tela prova ─────────────────────────────────────────────────
 *
 * O servidor sempre soube desfazer. O defeito era a tela **não chegar lá**:
 * a ficha do paciente não tinha botão nenhum, e o da tela inicial vivia num
 * `undoableRecordId` com `setTimeout` — recarregar a página perdia o
 * desfazer mesmo dentro do minuto.
 *
 * Um teste de servidor não pega nenhuma das duas coisas. O segundo caso
 * abaixo é o que importa: **recarregar e o botão continuar lá.**
 *
 * ── Conta própria por caso, e não `beforeAll` ────────────────────────────
 *
 * Cada caso precisa de uma dose **ainda não registrada**, e o primeiro deles
 * a registra. Compartilhar o cenário faria o segundo caso depender da ordem
 * de execução — e o plano Grátis cuida de 1 paciente, então "outra dose" na
 * mesma conta também não serve. É o mesmo motivo escrito no
 * `cartao-de-dose.spec.ts`.
 */

/** Cria conta, paciente e tratamento novos, e abre a ficha. */
async function cenarioLimpo(page: Page, request: import("@playwright/test").APIRequestContext) {
  const conta = await criarConta(request);
  const pacienteId = await criarPaciente(request, conta);
  const { horaAgendada } = await criarTratamentoHoje(request, conta, pacienteId);

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);
  await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });

  return { horaAgendada };
}

/**
 * Registra a dose pela TELA, passando pela confirmação de antecipação
 * quando ela aparecer.
 *
 * A dose que a geração cria é quase sempre a das 23:59 (#134), então há
 * **três** caminhos possíveis até o registro, e todos terminam igual:
 *
 *   1. dose distante: botão discreto **e** a pergunta do servidor;
 *   2. dose a menos de uma hora: botão discreto, **sem** pergunta;
 *   3. dose já vencida (madrugada, quando a gerada é a das 00:01): os
 *      botões grandes de sempre.
 *
 * Esta função cobre os três sem depender da hora em que o CI rodar.
 */
async function registrarPelaTela(page: Page) {
  const adiantada = page.getByRole("button", { name: "Já dei este remédio" });
  if (await adiantada.count()) {
    await adiantada.click();

    /**
     * ── A pergunta é OPCIONAL aqui, e o CI de 11/09 ensinou por quê ──────
     *
     * "A tela mostra o botão discreto" e "o servidor vai perguntar" **não
     * são a mesma condição**, e entre elas cabe até uma hora:
     *
     *   - a tela troca os botões grandes pelo discreto quando
     *     `scheduledAt > agora`;
     *   - o servidor só pergunta quando `scheduledAt - agora > 1 h`.
     *
     * A dose gerada pelo fixture é a das 23:59 no fuso do paciente. Quando o
     * CI roda **entre 22:59 e 23:59** nesse fuso, ela está a menos de uma
     * hora: o botão discreto aparece e o servidor aceita direto, sem
     * diálogo nenhum.
     *
     * Foi exatamente o que aconteceu às 02:19 UTC (23:19 em São Paulo), e
     * derrubou este arquivo inteiro. O app estava certo nas duas pontas — o
     * teste é que tratava as duas condições como uma só.
     *
     * Aqui não importa por qual caminho a dose foi registrada; importa que
     * ela esteja registrada no fim.
     */
    const confirmar = page.getByRole("alertdialog").getByRole("button", { name: "Sim, já dei" });
    if (await confirmar.count()) await confirmar.click();
  } else {
    await page.getByRole("button", { name: "✓ Tomou" }).first().click();
  }
  await expect(page.getByText("Tomado", { exact: true })).toBeVisible({ timeout: 15_000 });
}

test.describe("Desfazer na ficha do paciente", () => {
  test("o botao aparece depois de registrar — esta tela nao tinha nenhum", async ({ page, request }) => {
    await cenarioLimpo(page, request);

    await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
    await registrarPelaTela(page);
    await expect(page.getByRole("button", { name: "Desfazer" })).toBeVisible();
  });

  test("RECARREGAR a pagina nao perde o desfazer", async ({ page, request }) => {
    await cenarioLimpo(page, request);
    await registrarPelaTela(page);
    await expect(page.getByRole("button", { name: "Desfazer" })).toBeVisible();

    // O caso que o desenho antigo não tinha como passar: o prazo morava na
    // memória da aba, e um F5 o levava junto.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });
    await expect(
      page.getByRole("button", { name: "Desfazer" }),
      "o prazo vem do servidor, entao recarregar nao pode perde-lo",
    ).toBeVisible({ timeout: 15_000 });
  });

  test("desfazer devolve a dose para pendente", async ({ page, request }) => {
    await cenarioLimpo(page, request);
    await registrarPelaTela(page);

    await page.getByRole("button", { name: "Desfazer" }).click();

    await expect(page.getByText("Pendente", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Tomado", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Desfazer" })).toHaveCount(0);
  });
});
