import { test, expect } from "@playwright/test";
import { criarConta, entrar, criarPaciente, type ContaDeTeste } from "./apoio";

/**
 * Levar os dados embora, e sumir do sistema — QUI-17.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * As duas metades da LGPD estavam prontas no servidor desde a REQ-006, com
 * teste de integração e tudo. E **nenhuma tela chamava**.
 *
 * Direito que só existe no servidor não é direito do titular: é uma rota.
 * Ninguém exerce um direito com `curl`.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. a exportação gera um arquivo e entrega o link
 *   2. pedir a exclusão exige digitar o nome da família
 *   3. depois de pedida, a tela mostra a janela de sete dias e deixa cancelar
 *   4. cancelar devolve a conta ao estado normal
 */

test.describe("Exportar os dados", () => {
  let conta: ContaDeTeste;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    await criarPaciente(request, conta);
  });

  test("gera o arquivo e entrega os DOIS formatos", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes/seus-dados");

    await page.getByRole("button", { name: "Gerar o arquivo" }).click();

    // Issue #49: era um link e um formato. Passaram a ser dois, cada um com
    // seu token — baixar o PDF não pode matar o JSON.
    //
    // Portabilidade tem duas audiências: a pessoa, que quer LER, e outro
    // sistema, que quer IMPORTAR. Um formato só perde metade do direito.
    const pdf = page.getByRole("link", { name: /Baixar em PDF/ });
    await expect(pdf, "a exportação precisa entregar o PDF, que é o que se lê").toBeVisible({
      timeout: 15_000,
    });

    const json = page.getByRole("link", { name: /Baixar em JSON/ });
    await expect(json, "o JSON continua, para importar em outro sistema").toBeVisible();

    // Os links NÃO são clicados aqui de propósito: são de uso único e valem
    // uma hora, então baixar dentro do teste queimaria os tokens sem provar
    // nada que a suíte de servidor já não prove melhor.
    await expect(pdf).toHaveAttribute("href", /\/api\/export\/download\/.+formato=pdf/);
    await expect(json).toHaveAttribute("href", /\/api\/export\/download\/[^?]+$/);
  });
});

test.describe("Excluir a conta", () => {
  let conta: ContaDeTeste;

  // Conta própria e descartável: estes testes marcam a família para exclusão.
  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    await criarPaciente(request, conta);
  });

  test("o pedido só é liberado depois de digitar o nome da família", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes/seus-dados");

    await page.getByRole("button", { name: "Pedir a exclusão" }).click();

    const janela = page.getByRole("alertdialog");
    await expect(janela).toBeVisible();

    const confirmar = janela.getByRole("button", { name: "Pedir a exclusão" });
    await expect(
      confirmar,
      "apagar a família inteira não pode ser um toque só"
    ).toBeDisabled();

    // Nome errado continua travado.
    await janela.getByLabel(/Digite/).fill("Família Errada");
    await expect(confirmar).toBeDisabled();

    await janela.getByLabel(/Digite/).fill(conta.familia);
    await expect(confirmar).toBeEnabled();
    await confirmar.click();

    // A janela de sete dias é escolha do produto, não limitação técnica — e
    // a tela diz isso em vez de esconder atrás de um "tem certeza?".
    await expect(page.getByText(/A exclusão já está marcada/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Cancelar a exclusão" })).toBeVisible();

    // Sete dias ainda não passaram: executar agora não pode nem ser oferecido.
    await expect(
      page.getByRole("button", { name: /Excluir agora/ }),
      "a execução só aparece depois que a janela fecha, e quem diz isso é o servidor"
    ).toHaveCount(0);
  });

  test("cancelar devolve a conta ao estado normal", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes/seus-dados");

    await page.getByRole("button", { name: "Cancelar a exclusão" }).click();

    await expect(page.getByText(/A exclusão já está marcada/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pedir a exclusão" })).toBeVisible();
  });
});
