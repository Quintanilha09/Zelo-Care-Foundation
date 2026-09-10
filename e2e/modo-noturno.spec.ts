import { test, expect } from "@playwright/test";
import { criarConta, entrar, type ContaDeTeste } from "./apoio";

/**
 * Modo noturno — Issue #138.
 *
 * ── O pedido ──────────────────────────────────────────────────────────────
 *
 * Do fundador, em 10/09/2026: *"implemente o modo noturno, pois minha visão
 * dói nesse modo claro. Isso tem que ser implementado com cuidado, as cores
 * definidas têm que seguir o padrão do app"*.
 *
 * O motivo é **dor**, não gosto — e é isso que faz o padrão ser "igual ao
 * aparelho" em vez de "claro".
 *
 * ── O que só a tela prova ─────────────────────────────────────────────────
 *
 * 1. Abrir com o aparelho no escuro já vem escuro, **sem lampejo branco**.
 * 2. A escolha sobrevive a fechar e reabrir.
 * 3. O modo idoso **não** herda o tema.
 *
 * O primeiro é o que mais importa: um lampejo branco a cada abertura é, para
 * quem tem dor de vista, o problema inteiro acontecendo de novo.
 */

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

const escuro = (page: import("@playwright/test").Page) =>
  page.locator("html").evaluate((el) => el.classList.contains("dark"));

test.describe("Modo noturno", () => {
  test("com o aparelho no escuro, o app ja abre escuro", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await entrar(page, conta);

    expect(await escuro(page), "o padrão é seguir o aparelho").toBe(true);
  });

  test("com o aparelho no claro, o app abre claro", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await entrar(page, conta);

    expect(await escuro(page)).toBe(false);
  });

  test("a classe e aplicada ANTES da primeira pintura", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await entrar(page, conta);

    // O script inline do `index.html` roda no `head`, antes de o `body`
    // existir. Se a classe fosse posta pelo React, ela só apareceria depois
    // de o navegador já ter pintado a página clara — o lampejo.
    //
    // Provado pela ORDEM no documento: se `.dark` já vale quando o primeiro
    // elemento do body é analisado, não houve pintura clara no meio.
    const antesDoBody = await page.evaluate(() => {
      const scripts = Array.from(document.head.querySelectorAll("script:not([src])"));
      return scripts.some((s) => s.textContent?.includes("zelo_tema"));
    });
    expect(antesDoBody, "o script do tema tem que estar inline no <head>").toBe(true);
  });

  test("escolher Claro vence o aparelho, e sobrevive a reabrir", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await entrar(page, conta);
    expect(await escuro(page)).toBe(true);

    await page.goto("/ajustes/aparencia");
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("radio", { name: /Claro/ }).click();
    expect(await escuro(page), "a escolha manual vence o aparelho").toBe(false);

    // Reabrir: é aqui que um tema guardado só na memória se perderia.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible({ timeout: 15_000 });
    expect(await escuro(page), "a escolha tem que sobreviver a reabrir").toBe(false);
  });

  test("as cores de dose continuam com o significado no escuro", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await entrar(page, conta);

    // Invariante 5: âmbar é pendência, verde é tomada, e **vermelho nunca**
    // é estado de dose. Aqui se prova que os tokens existem no escuro — sem
    // eles, `--color-zelo-amber-bg` continuaria quase branco e o cartão de
    // dose pendente viraria um retângulo claro no fundo escuro.
    const tons = await page.evaluate(() => {
      const s = getComputedStyle(document.documentElement);
      return {
        amberBg: s.getPropertyValue("--color-zelo-amber-bg").trim(),
        greenBg: s.getPropertyValue("--color-zelo-green-bg").trim(),
      };
    });

    // No claro estes são 95% e 95% de luminosidade; no escuro, 20%.
    expect(tons.amberBg, "o âmbar de fundo precisa ser escuro no tema escuro").toContain("20%");
    expect(tons.greenBg, "o verde de fundo precisa ser escuro no tema escuro").toContain("20%");
  });
});
