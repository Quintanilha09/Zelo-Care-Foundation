import { test, expect } from "@playwright/test";
import { criarConta, entrar, type ContaDeTeste } from "./apoio";

/**
 * Modo noturno — Issues #138 e #225.
 *
 * ── Duas decisões do fundador, e a segunda revisou a primeira ─────────────
 *
 * **10/09/2026 (#138):** *"implemente o modo noturno, pois minha visão dói
 * nesse modo claro. Isso tem que ser implementado com cuidado, as cores
 * definidas têm que seguir o padrão do app"*. O motivo era **dor**, não gosto
 * — e foi o que fez o padrão nascer como "igual ao aparelho".
 *
 * **29/09/2026 (#225):** *"Somente no primeiro acesso será o modo claro por
 * padrão."* O padrão passou a ser **claro**, e o aparelho só manda quando a
 * pessoa escolhe "Igual ao aparelho" com todas as letras.
 *
 * Os testes abaixo mudaram de lado por causa disso. O primeiro deles afirmava
 * exatamente o contrário até hoje, e está aqui invertido de propósito — não
 * por descuido.
 *
 * ── O que só a tela prova ─────────────────────────────────────────────────
 *
 * 1. Primeiro acesso nasce claro, mesmo com o celular no escuro.
 * 2. Quem escolhe escuro abre escuro, **sem lampejo branco**.
 * 3. "Igual ao aparelho" devolve o comando ao celular, inclusive ao vivo.
 * 4. A escolha sobrevive a fechar e reabrir.
 *
 * O item 2 é o que mais importa: um lampejo branco a cada abertura é, para
 * quem tem dor de vista, o problema inteiro acontecendo de novo.
 */

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

const escuro = (page: import("@playwright/test").Page) =>
  page.locator("html").evaluate((el) => el.classList.contains("dark"));

/**
 * Deixa uma escolha de tema guardada ANTES de a página carregar.
 *
 * `addInitScript` roda antes de qualquer script da página, inclusive o do
 * `<head>` que aplica o tema. É a única forma de simular "esta pessoa já
 * escolheu" sem passar pela interface — e a interface tem tela própria para
 * isso, testada mais abaixo.
 */
const jaEscolheu = (page: import("@playwright/test").Page, valor: string) =>
  page.addInitScript((v) => {
    try {
      localStorage.setItem("zelo_tema", v);
    } catch {
      /* armazenamento bloqueado: o teste que depende disso falha, e deve */
    }
  }, valor);

test.describe("Modo noturno", () => {
  test("primeiro acesso nasce claro, mesmo com o aparelho no escuro", async ({ page }) => {
    // Este caso afirmava o contrário até 29/09/2026. A inversão é a #225.
    await page.emulateMedia({ colorScheme: "dark" });
    await entrar(page, conta);

    expect(
      await escuro(page),
      "sem escolha guardada o app nasce claro, mesmo com o celular no escuro",
    ).toBe(false);
  });

  test("com o aparelho no claro, o app abre claro", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await entrar(page, conta);

    expect(await escuro(page)).toBe(false);
  });

  test("quem ja escolheu escuro abre escuro, com o aparelho no claro", async ({ page }) => {
    // O espelho do caso acima: a escolha manda nos dois sentidos, e não só
    // quando concorda com o celular.
    await page.emulateMedia({ colorScheme: "light" });
    await jaEscolheu(page, "escuro");
    await entrar(page, conta);

    expect(await escuro(page), "a escolha guardada vence o aparelho").toBe(true);
  });

  test("Igual ao aparelho devolve o comando ao celular", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "dark" });
    await jaEscolheu(page, "sistema");
    await entrar(page, conta);

    expect(await escuro(page), "com 'sistema' guardado, o celular volta a mandar").toBe(true);
  });

  test("a classe e aplicada ANTES da primeira pintura", async ({ page }) => {
    // Com a escolha guardada, e não pelo aparelho: desde a #225 o aparelho
    // sozinho não escurece nada, então o caso do lampejo branco só existe
    // para quem escolheu escuro.
    await jaEscolheu(page, "escuro");
    await entrar(page, conta);
    expect(await escuro(page)).toBe(true);

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

  test("escolher Escuro vence o padrao, e sobrevive a reabrir", async ({ page }) => {
    // Invertido pela #225: antes se provava que "Claro" vencia o aparelho
    // escuro. Agora claro é o padrão, então o que precisa de prova é o
    // caminho contrário — e é o caminho de quem tem dor de vista.
    await page.emulateMedia({ colorScheme: "light" });
    await entrar(page, conta);
    expect(await escuro(page)).toBe(false);

    await page.goto("/ajustes/aparencia");
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("radio", { name: /Escuro/ }).click();
    expect(await escuro(page), "a escolha manual vence o padrão").toBe(true);

    // Reabrir: é aqui que um tema guardado só na memória se perderia.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible({ timeout: 15_000 });
    expect(await escuro(page), "a escolha tem que sobreviver a reabrir").toBe(true);
  });

  test("escolher Igual ao aparelho GRAVA, e nao vira Claro ao reabrir", async ({ page }) => {
    // ── A armadilha da #225 ───────────────────────────────────────────────
    //
    // Até a #225, escolher "Igual ao aparelho" APAGAVA a chave, porque
    // ausência já significava "sistema". Com ausência significando "claro",
    // apagar passaria a ser o mesmo que escolher "Claro" — e a opção
    // continuaria na tela fazendo outra coisa, em silêncio, só na próxima
    // abertura.
    //
    // Por isso o `reload` no meio: sem ele, este caso passa mesmo com o bug.
    await page.emulateMedia({ colorScheme: "dark" });
    await entrar(page, conta);
    expect(await escuro(page)).toBe(false);

    await page.goto("/ajustes/aparencia");
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible({ timeout: 15_000 });

    await page.getByRole("radio", { name: /Igual ao aparelho/ }).click();
    expect(await escuro(page), "escolher 'igual ao aparelho' passa a seguir o celular").toBe(true);

    await page.reload();
    await expect(page.getByRole("heading", { name: "Aparência" })).toBeVisible({ timeout: 15_000 });
    expect(
      await escuro(page),
      "ao reabrir continua seguindo o celular — se virou claro, a escolha foi apagada em vez de gravada",
    ).toBe(true);
  });

  test("as cores de dose continuam com o significado no escuro", async ({ page }) => {
    // `jaEscolheu("sistema")` e não só `emulateMedia`: desde a #225 o
    // aparelho sozinho não escurece nada. Este caso precisa do app escuro E
    // seguindo o celular ao vivo, porque a segunda metade dele prova a troca
    // em tempo real.
    await page.emulateMedia({ colorScheme: "dark" });
    await jaEscolheu(page, "sistema");
    await entrar(page, conta);
    expect(await escuro(page)).toBe(true);

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
    // Sem `reload`: com a escolha em "sistema" o app acompanha o aparelho ao
    // vivo (`observarOAparelho` em `lib/tema.ts`). Esperar a classe sair do
    // `<html>` é mais direto que recarregar, e de quebra prova essa troca ao
    // vivo, que é o caso de quem usa o modo noturno agendado do celular com o
    // app aberto.
    //
    // Desde a #225 "sistema" deixou de ser o padrão e virou escolha — por
    // isso o `jaEscolheu` no topo deste caso.
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).not.toHaveClass(/dark/, { timeout: 15_000 });

    const amberClaro = await corDaClasse("bg-zelo-amber-bg");
    expect(
      luminancia(amberClaro),
      `no tema claro a mesma classe tem que ser clara, e veio ${amberClaro}`,
    ).toBeGreaterThan(0.7);
  });
});
