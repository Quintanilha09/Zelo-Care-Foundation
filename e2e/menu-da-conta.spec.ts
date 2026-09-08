import { test, expect } from "@playwright/test";
import { criarConta, entrar, type ContaDeTeste } from "./apoio";

/**
 * Menu da conta no avatar — Issue #113.
 *
 * ── O que era ─────────────────────────────────────────────────────────────
 *
 * O cabeçalho tinha um ícone de engrenagem para os Ajustes e um botão "Sair"
 * solto, além do seletor de família. Três coisas competindo por espaço no
 * canto direito.
 *
 * ── O que este teste prova, pela TELA ────────────────────────────────────
 *
 * 1. A engrenagem e o "Sair" solto sumiram do cabeçalho.
 * 2. Pacientes e Cuidadores continuam na barra.
 * 3. O avatar abre um menu com Meu perfil, Ajustes e Sair.
 * 4. "Ajustes" leva para /ajustes; "Sair" desloga.
 */

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

test.describe("Menu da conta", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");
    await expect(page.locator('header a[href="/pacientes"]')).toBeVisible({ timeout: 15_000 });
  });

  test("a barra tem Pacientes e Cuidadores, e não tem mais engrenagem nem Sair solto", async ({ page }) => {
    const header = page.locator("header");
    await expect(header.locator('a[href="/pacientes"]')).toBeVisible();
    await expect(header.locator('a[href="/cuidadores"]')).toBeVisible();

    // A engrenagem era o único link do cabeçalho para /ajustes.
    await expect(header.locator('a[href="/ajustes"]')).toHaveCount(0);
    // O "Sair" era um botão solto; agora só existe dentro do menu.
    await expect(header.getByRole("button", { name: "Sair", exact: true })).toHaveCount(0);
  });

  test("o avatar abre o menu, e Ajustes leva para a tela certa", async ({ page }) => {
    await page.getByRole("button", { name: `Menu de ${conta.nome}` }).click();

    await expect(page.getByRole("menuitem", { name: "Meu perfil" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Ajustes" })).toBeVisible();
    await expect(page.getByRole("menuitem", { name: "Sair" })).toBeVisible();

    await page.getByRole("menuitem", { name: "Ajustes" }).click();
    await expect(page).toHaveURL(/\/ajustes$/);
  });

  test("Sair pelo menu desloga", async ({ page }) => {
    await page.getByRole("button", { name: `Menu de ${conta.nome}` }).click();
    await page.getByRole("menuitem", { name: "Sair" }).click();

    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible({
      timeout: 15_000,
    });
  });
});
