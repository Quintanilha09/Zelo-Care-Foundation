import { test, expect } from "@playwright/test";
import { criarConta, criarPaciente, entrar, type ContaDeTeste } from "./apoio";

/**
 * Quem é responsável por um paciente — Issue #120.
 *
 * ── O que este teste prova, pela TELA ─────────────────────────────────────
 *
 * 1. A seção existe na ficha do paciente, e começa vazia sem parecer erro.
 * 2. Indicar alguém coloca a pessoa na lista.
 * 3. **A tela diz que isso não muda quem enxerga** — é o aviso que impede
 *    alguém de vincular uma pessoa achando que tirou o acesso das outras.
 * 4. Tirar da responsabilidade devolve a seção ao estado vazio.
 */

let conta: ContaDeTeste;
let pacienteId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  pacienteId = await criarPaciente(request, conta);
});

test.describe("Quem é responsável", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(
      page.getByRole("region", { name: "Quem é responsável" }),
    ).toBeVisible({ timeout: 15_000 });
  });

  test("começa vazia, e diz isso sem parecer defeito", async ({ page }) => {
    const secao = page.getByRole("region", { name: "Quem é responsável" });
    await expect(secao).toContainText("Ninguém foi indicado como responsável");
  });

  test("a tela avisa que o vínculo NÃO muda quem enxerga", async ({ page }) => {
    // O aviso é a defesa contra o engano mais caro possível aqui: alguém
    // vincular uma pessoa e supor que acabou de tirar o acesso das outras.
    const secao = page.getByRole("region", { name: "Quem é responsável" });
    await expect(secao).toContainText("Não muda quem enxerga");
  });

  test("indicar alguém põe a pessoa na lista, e tirar devolve ao vazio", async ({ page }) => {
    const secao = page.getByRole("region", { name: "Quem é responsável" });

    await secao.getByRole("combobox", { name: "Indicar responsável" }).click();
    await page.getByRole("option", { name: conta.nome }).click();

    await expect(secao.getByText(conta.nome)).toBeVisible({ timeout: 15_000 });
    await expect(secao).not.toContainText("Ninguém foi indicado como responsável");

    await secao
      .getByRole("button", { name: new RegExp(`^Tirar ${conta.nome} da responsabilidade`) })
      .click();

    await expect(secao).toContainText("Ninguém foi indicado como responsável", {
      timeout: 15_000,
    });
  });
});
