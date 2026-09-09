import { test, expect } from "@playwright/test";
import { criarConta, entrar, type ContaDeTeste } from "./apoio";

/**
 * Trocar senha e e-mail por revelação — Issues #115 e #99.
 *
 * ── O que era ─────────────────────────────────────────────────────────────
 *
 * Os campos de troca ficavam abertos o tempo todo, e o "Senha atual" vinha
 * PREENCHIDO pelo gerenciador do navegador (`autocomplete="current-password"`).
 * Com o aparelho destravado na mão de outra pessoa, trocar a senha era digitar
 * a nova duas vezes.
 *
 * **O servidor sempre esteve certo** — `POST /api/account/password` exige a
 * senha atual e limita tentativas. O buraco era de tela.
 *
 * ── O que este teste prova ────────────────────────────────────────────────
 *
 * 1. Ao abrir a tela, nenhum campo de senha ou de e-mail existe.
 * 2. O campo "Senha atual" nasce vazio e pede `autocomplete="off"`.
 * 3. "Cancelar" fecha e some com os campos de novo.
 * 4. O caminho da #99 ("não lembro minha senha atual") existe dentro do painel.
 */

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

test.describe("Sua conta — revelação por botão", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes/conta");
    await expect(page.getByRole("heading", { name: "Sua conta" })).toBeVisible({ timeout: 15_000 });
  });

  test("nenhum campo de senha ou de e-mail existe antes do clique", async ({ page }) => {
    // Este é o coração da Issue: o gerenciador de senhas não tem o que
    // preencher num campo que não está no DOM.
    await expect(page.locator("#senha-atual")).toHaveCount(0);
    await expect(page.locator("#senha-nova")).toHaveCount(0);
    await expect(page.locator("#senha-repetida")).toHaveCount(0);
    await expect(page.locator("#email-novo")).toHaveCount(0);
    await expect(page.locator("#senha-para-email")).toHaveCount(0);

    // O que existe são os dois botões que revelam.
    await expect(page.getByRole("button", { name: "Trocar a senha", exact: true })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Trocar o e-mail de acesso", exact: true }),
    ).toBeVisible();
  });

  test("a senha atual nasce vazia e não se oferece ao gerenciador", async ({ page }) => {
    await page.getByRole("button", { name: "Trocar a senha", exact: true }).click();

    const atual = page.locator("#senha-atual");
    await expect(atual).toBeVisible();
    await expect(atual, "o campo não pode vir preenchido").toHaveValue("");
    await expect(
      atual,
      "com `current-password` o gerenciador preenche sozinho — é o defeito da #115",
    ).toHaveAttribute("autocomplete", "off");

    // O botão que envia tem nome próprio: o que revela já se chama
    // "Trocar a senha", e dois botões iguais fazendo coisas diferentes é
    // ambiguidade que só aparece quando alguém erra.
    await expect(page.getByRole("button", { name: "Salvar a senha nova" })).toBeVisible();
  });

  test("Cancelar fecha o painel e leva os campos junto", async ({ page }) => {
    await page.getByRole("button", { name: "Trocar a senha", exact: true }).click();
    await expect(page.locator("#senha-atual")).toBeVisible();

    await page.getByRole("button", { name: "Cancelar" }).first().click();

    await expect(page.locator("#senha-atual")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Trocar a senha", exact: true })).toBeVisible();
  });

  test("o caminho de quem não lembra a senha atual existe — Issue #99", async ({ page }) => {
    await page.getByRole("button", { name: "Trocar a senha", exact: true }).click();

    // Só aparece com o painel aberto: é resposta a um campo que a pessoa
    // acabou de encarar, não um convite solto na tela.
    await expect(
      page.getByRole("button", { name: "Não lembro minha senha atual" }),
    ).toBeVisible();
  });

  test("o painel de e-mail também abre por botão", async ({ page }) => {
    await page.getByRole("button", { name: "Trocar o e-mail de acesso", exact: true }).click();

    await expect(page.locator("#email-novo")).toBeVisible();
    const senhaDoEmail = page.locator("#senha-para-email");
    await expect(senhaDoEmail).toBeVisible();
    await expect(senhaDoEmail).toHaveValue("");
    await expect(senhaDoEmail).toHaveAttribute("autocomplete", "off");
  });
});
