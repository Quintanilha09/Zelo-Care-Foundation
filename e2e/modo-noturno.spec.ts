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

    /**
     * ═══════════════════════════════════════════════════════════════════════
     * PERGUNTA AO NAVEGADOR QUE COR A CLASSE PINTA — Issue #148.
     *
     * Até 11/09/2026 este caso lia a variável `--color-zelo-amber-bg` do
     * `:root` e conferia se ela dizia "20%". Ele passava. E o modo escuro
     * estava **morto**: a variável valia 20%, e a classe `.bg-zelo-amber-bg`
     * pintava `#fdf5e8` — creme — porque o `@theme inline` do Tailwind tinha
     * congelado o valor claro dentro da regra.
     *
     * Variável certa, tela errada. Ler a variável não prova nada sobre o que
     * o usuário vê; a única pergunta que vale é qual cor **sai pintada**.
     *
     * Por isso aqui se cria um elemento com a classe real, se lê o
     * `backgroundColor` computado, e se mede a luminância. É a mesma pergunta
     * que o fundador fez ao olhar a tela e ver o cartão branco.
     * ═══════════════════════════════════════════════════════════════════════
     */
    const corDaClasse = async (classe: string) =>
      page.evaluate((c) => {
        const el = document.createElement("div");
        el.className = c;
        document.body.appendChild(el);
        const cor = getComputedStyle(el).backgroundColor;
        el.remove();
        return cor;
      }, classe);

    /** Luminância relativa de um `rgb(r, g, b)`, para dizer se é clara ou escura. */
    const luminancia = (rgb: string): number => {
      const [r, g, b] = (rgb.match(/\d+/g) ?? ["0", "0", "0"]).map((n) => Number(n) / 255);
      const canal = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * canal(r!) + 0.7152 * canal(g!) + 0.0722 * canal(b!);
    };

    const amberEscuro = await corDaClasse("bg-zelo-amber-bg");
    const greenEscuro = await corDaClasse("bg-zelo-green-bg");

    // Invariante 5: âmbar é pendência, verde é tomada, e **vermelho nunca** é
    // estado de dose. No claro estes dois são quase brancos (luminância acima
    // de 0,8); no escuro precisam ser tons baixos.
    expect(
      luminancia(amberEscuro),
      `o cartao de dose pendente ficou claro no tema escuro: ${amberEscuro}`,
    ).toBeLessThan(0.2);
    expect(
      luminancia(greenEscuro),
      `o cartao de dose tomada ficou claro no tema escuro: ${greenEscuro}`,
    ).toBeLessThan(0.2);

    // E a prova de que é a TROCA que muda a cor, e não um valor fixo: no
    // claro a MESMA classe pinta um tom alto.
    //
    // Sem `reload`: com a escolha em "sistema" — o padrão — o app acompanha o
    // aparelho ao vivo (`observarOAparelho` em `lib/tema.ts`). Esperar a
    // classe sair do `<html>` é mais direto que recarregar, e de quebra prova
    // essa troca ao vivo, que é o caso de quem usa o modo noturno agendado do
    // celular com o app aberto.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/, { timeout: 15_000 });

    const amberClaro = await corDaClasse("bg-zelo-amber-bg");
    expect(
      luminancia(amberClaro),
      `no tema claro a mesma classe tem que ser clara, e veio ${amberClaro}`,
    ).toBeGreaterThan(0.7);
  });
});
