import { test, expect } from "@playwright/test";
import type { Page, APIRequestContext } from "@playwright/test";
import { criarConta, criarPaciente, registrarUmaDoseHoje, entrar } from "./apoio";

/**
 * Corrigir um registro de dose — Issue #136.
 *
 * ── O que só a tela prova ─────────────────────────────────────────────────
 *
 * Que existe um caminho depois do prazo de desfazer, que ele **não fala em
 * apagar**, e que a correção **deixa marca visível**. Um teste de servidor
 * prova que a coluna foi gravada; só a tela prova que alguém lendo o
 * histórico vê que houve emenda.
 *
 * ── Conta própria por caso ────────────────────────────────────────────────
 *
 * Cada caso corrige o registro, e o plano Grátis cuida de 1 paciente. Mesmo
 * motivo do `cartao-de-dose.spec.ts`.
 */

/** Cria conta, paciente e uma dose JÁ registrada, e abre a ficha. */
async function cenarioComDoseRegistrada(page: Page, request: APIRequestContext) {
  const conta = await criarConta(request);
  const pacienteId = await criarPaciente(request, conta);
  await registrarUmaDoseHoje(request, conta, pacienteId, "taken");

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);
  await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });
}

test.describe("Corrigir um registro de dose", () => {
  test("depois do prazo o caminho e CORRIGIR, e nao apagar", async ({ page, request }) => {
    await cenarioComDoseRegistrada(page, request);

    // O registro veio pela API há mais de um instante, mas o prazo é de 60 s:
    // o que importa aqui é que "Corrigir" existe e que a palavra "apagar"
    // não aparece em lugar nenhum deste caminho.
    const corrigir = page.getByRole("button", { name: "Corrigir" });
    await expect(corrigir).toBeVisible({ timeout: 15_000 });

    await corrigir.click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toContainText("Corrigir o registro");
    await expect(
      dialogo,
      "a tela precisa dizer que o original NAO e apagado",
    ).toContainText("não é apagado");
    await expect(dialogo.getByText(/apagar/i)).toHaveCount(0);
  });

  test("o formulario abre no estado REAL do registro", async ({ page, request }) => {
    await cenarioComDoseRegistrada(page, request);

    await page.getByRole("button", { name: "Corrigir" }).click();

    // A dose foi registrada como tomada: o botão "Tomou" abre marcado. Um
    // formulário em branco faria a pessoa reconstruir de memória o que veio
    // consertar.
    await expect(
      page.getByRole("dialog").getByRole("button", { name: "Tomou" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("corrigir para Pulou muda o cartao e DEIXA MARCA", async ({ page, request }) => {
    await cenarioComDoseRegistrada(page, request);

    await page.getByRole("button", { name: "Corrigir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Pulou" }).click();
    await page.getByRole("button", { name: "Salvar correção" }).click();

    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText("Pulado", { exact: true })).toBeVisible({ timeout: 15_000 });

    // A marca é o ponto da issue: registro corrigido sem marca visível é
    // pior que registro errado, porque quem lê confia no que não deve.
    await expect(
      page.getByText(/^Corrigido/),
      "quem le o historico precisa ver que houve emenda",
    ).toBeVisible();
  });

  test("cancelar nao muda nada", async ({ page, request }) => {
    await cenarioComDoseRegistrada(page, request);

    await page.getByRole("button", { name: "Corrigir" }).click();
    await page.getByRole("dialog").getByRole("button", { name: "Pulou" }).click();
    await page.getByRole("button", { name: "Cancelar" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.getByText("Tomado", { exact: true })).toBeVisible();
    await expect(page.getByText(/^Corrigido/)).toHaveCount(0);
  });
});
