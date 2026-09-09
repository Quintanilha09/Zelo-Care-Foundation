import { test, expect } from "@playwright/test";
import { criarConta, entrar, PNG_1X1, type ContaDeTeste } from "./apoio";

/**
 * Perfil do cuidador: foto, telefone e parentesco — Issue #116.
 *
 * ── O pedido ──────────────────────────────────────────────────────────────
 *
 * Do fundador, em 08/09/2026: *"quero que cada cuidador consiga adicionar uma
 * imagem ao perfil para que a família tenha noção da aparência de quem está
 * cuidando"*.
 *
 * ── O que este teste prova, pela TELA ─────────────────────────────────────
 *
 * 1. "Seu perfil" existe na lista de Ajustes e abre.
 * 2. A foto escolhida aparece de verdade — a imagem CARREGA, e não é só um
 *    `<img>` com src quebrado. É o que prova o link assinado funcionando:
 *    `<img>` não manda header de sessão.
 * 3. Telefone e parentesco salvos aparecem em `/cuidadores`.
 * 4. Remover a foto volta para as iniciais.
 */

const FOTO = { name: "rosto.png", mimeType: "image/png", buffer: PNG_1X1 };

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

test.describe("Seu perfil", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("a seção existe na lista de Ajustes e abre", async ({ page }) => {
    await page.goto("/ajustes");
    const link = page
      .getByRole("navigation", { name: "Seções dos ajustes" })
      .locator('a[href="/ajustes/perfil"]');

    await expect(link).toBeVisible({ timeout: 15_000 });
    await expect(link).toContainText("Seu perfil");

    await link.click();
    await expect(page).toHaveURL(/\/ajustes\/perfil$/);
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible();
  });

  test("a foto escolhida carrega de verdade, e remover volta às iniciais", async ({ page }) => {
    await page.goto("/ajustes/perfil");
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible({ timeout: 15_000 });

    // Sem foto: o avatar mostra as iniciais de "Ana Fictícia E2E".
    await expect(page.getByText("AE").first()).toBeVisible();

    // O input é `hidden` — o botão é quem o dispara na vida real.
    await page.locator('input[type="file"]').setInputFiles(FOTO);

    // A foto aparece em DOIS lugares, e os dois importam: o perfil, onde a
    // pessoa acabou de escolhê-la, e o avatar do cabeçalho, que precisa
    // acompanhar sem recarregar a página.
    const noPerfil = page.locator('main img[src*="/caregivers/foto/"]');
    const noCabecalho = page.locator('header img[src*="/caregivers/foto/"]');

    // A imagem tem que CARREGAR. O Radix só troca as iniciais pela `<img>`
    // depois do `load`, então vê-la é a prova de que o link assinado abriu
    // sem header de sessão — que é o ponto inteiro do desenho.
    await expect(noPerfil).toBeVisible({ timeout: 15_000 });
    await expect(
      noPerfil,
      "src quebrado deixaria a imagem sem largura natural",
    ).not.toHaveJSProperty("naturalWidth", 0);

    await expect(
      noCabecalho,
      "o avatar do cabeçalho acompanha sem recarregar a página",
    ).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Remover" }).click();

    // Some dos dois lugares, não só de onde foi removida.
    await expect(noPerfil).toHaveCount(0, { timeout: 15_000 });
    await expect(noCabecalho).toHaveCount(0);
    await expect(page.getByText("AE").first()).toBeVisible();
  });

  test("telefone e parentesco salvos aparecem em Cuidadores", async ({ page }) => {
    await page.goto("/ajustes/perfil");
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible({ timeout: 15_000 });

    await page.locator("#perfil-telefone").fill("(21) 98888-7777");

    await page.locator("#perfil-parentesco").click();
    await page.getByRole("option", { name: "Filho ou filha" }).click();

    await page.getByRole("button", { name: "Salvar", exact: true }).click();
    await expect(page.getByText("Salvo", { exact: true })).toBeVisible({ timeout: 15_000 });

    // O valor é da família, e é na tela da família que ele tem função.
    await page.goto("/cuidadores");
    await expect(page.getByText("(21) 98888-7777")).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText("Filho ou filha")).toBeVisible();
  });

  test("o parentesco não se confunde com o papel de acesso", async ({ page }) => {
    await page.goto("/ajustes/perfil");
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible({ timeout: 15_000 });

    // Dito por extenso na tela. Sem isto, alguém escolhe "contratado" e supõe
    // que o app passou a limitar o que ela pode fazer.
    await expect(
      page.getByText(/Não muda nada do que você pode fazer no app/),
    ).toBeVisible();
  });
});
