import { test, expect } from "@playwright/test";
import { criarConta, entrar, pngSolido, type ContaDeTeste } from "./apoio";

/**
 * Recortar a foto antes de enviar — Issue #137.
 *
 * ── O pedido ──────────────────────────────────────────────────────────────
 *
 * Do fundador, em 10/09/2026: *"poder cortar ela para o tamanho que eu quero
 * e o que é permitido, para que ela não fique muito puxada ou pequena"*.
 *
 * A metade "puxada" foi a #132 (`object-cover` — a foto deixou de ser
 * espremida). Esta issue é a outra metade: **escolher qual pedaço vira o
 * rosto**, em vez de aceitar o centro geométrico da foto.
 *
 * ── O que só a tela prova ─────────────────────────────────────────────────
 *
 * Que existe um passo entre escolher e enviar, que dá para desistir dele, e
 * que uma foto pequena demais é recusada **antes** de a pessoa enquadrar
 * alguma coisa — que é o oposto de fazê-la trabalhar à toa.
 */

/** Retangular: é a foto não-quadrada que faz o recorte existir. */
const FOTO = { name: "rosto.png", mimeType: "image/png", buffer: pngSolido(400, 300) };

/** Abaixo do piso de 200 px. */
const FOTO_MINUSCULA = { name: "minuscula.png", mimeType: "image/png", buffer: pngSolido(80, 80) };

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

test.describe("Recortar a foto de perfil", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes/perfil");
    await expect(page.getByRole("heading", { name: "Seu perfil" })).toBeVisible({ timeout: 15_000 });
  });

  test("escolher a foto abre o recorte, e nao envia nada ainda", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FOTO);

    await expect(page.getByRole("dialog")).toContainText("Enquadre o seu rosto", { timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Usar esta foto" })).toBeVisible();

    // Nada subiu: o avatar continua nas iniciais de "Ana Fictícia E2E".
    await expect(page.locator('main img[src*="/caregivers/foto/"]')).toHaveCount(0);
  });

  test("cancelar nao deixa foto nenhuma para tras", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FOTO);
    await expect(page.getByRole("dialog")).toBeVisible({ timeout: 15_000 });

    await page.getByRole("button", { name: "Cancelar" }).click();

    await expect(page.getByRole("dialog")).toBeHidden();
    await expect(page.locator('main img[src*="/caregivers/foto/"]')).toHaveCount(0);
    await expect(page.getByText("AE").first()).toBeVisible();
  });

  test("confirmar envia, e a foto aparece de verdade", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FOTO);
    await page.getByRole("button", { name: "Usar esta foto" }).click();

    // A imagem tem que CARREGAR, não só existir no DOM: o Radix só troca as
    // iniciais pela `<img>` depois do `load`.
    const noPerfil = page.locator('main img[src*="/caregivers/foto/"]');
    await expect(noPerfil).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("dialog")).toBeHidden();

    // E o que chegou é QUADRADO — foi o recorte que produziu o arquivo, e
    // não o CSS fingindo que um retângulo é redondo.
    const proporcao = await noPerfil.evaluate(
      (el) => (el as HTMLImageElement).naturalWidth / (el as HTMLImageElement).naturalHeight,
    );
    expect(proporcao, "o arquivo enviado precisa ser quadrado").toBeCloseTo(1, 1);
  });

  test("foto pequena demais e recusada ANTES de enquadrar", async ({ page }) => {
    await page.locator('input[type="file"]').setInputFiles(FOTO_MINUSCULA);

    // Deixar escolher o enquadramento de uma imagem de 80 px para só então
    // dizer que não serve é fazer a pessoa trabalhar à toa.
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toContainText("pelo menos 200", { timeout: 15_000 });
    await expect(dialogo.getByRole("button", { name: "Usar esta foto" })).toBeDisabled();
  });
});
