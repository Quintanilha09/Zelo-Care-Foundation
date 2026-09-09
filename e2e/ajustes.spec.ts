import { test, expect, type Page } from "@playwright/test";
import { criarConta, entrar, naoRolaNaHorizontal, type ContaDeTeste } from "./apoio";

/**
 * Ajustes com a lista à esquerda — Issue #114 (era QUI-19).
 *
 * ── O que mudou, e o que não mudou ────────────────────────────────────────
 *
 * O agrupamento **por dono** é o mesmo da QUI-19: a conta, a família, o
 * titular, a ajuda. É isso que faz alguém achar o ajuste sem ler todos, e
 * continua sendo o critério.
 *
 * O que mudou foi a forma. Eram cartões empilhados — um destino por vez, sem
 * nunca mostrar o conjunto. Viraram uma lista fixa à esquerda, no padrão que
 * o fundador pediu por nome (GitHub).
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. os quatro grupos existem e estão na ordem certa
 *   2. a conta em que a pessoa está aparece por nome e e-mail
 *   3. cada linha leva de fato para a tela dela
 *   4. a lista fica ao lado do conteúdo no desktop, e vira índice no celular
 *   5. a seção aberta fica marcada na lista
 *   6. nada disso faz a página rolar de lado
 */

const GRUPOS = ["Conta", "Família", "Seus dados", "Ajuda"];

/** O `md` do Tailwind. Abaixo disto a lista e o conteúdo não convivem. */
const LARGURA_DE_DUAS_COLUNAS = 768;

function ehDesktop(page: Page): boolean {
  return (page.viewportSize()?.width ?? 0) >= LARGURA_DE_DUAS_COLUNAS;
}

/** A lista de seções, pelo nome que o leitor de tela anuncia. */
function lista(page: Page) {
  return page.getByRole("navigation", { name: "Seções dos ajustes" });
}

/**
 * Localizados por `href`, e não pelo rótulo.
 *
 * "Notificações" e "Notificações no iPhone" são dois destinos diferentes cujo
 * texto começa igual — buscar por nome pegaria os dois e o teste passaria a
 * depender da ordem do DOM. O `href` é o que o link de fato promete.
 */
const DESTINOS: Array<{ rotulo: string; href: string; caminho: RegExp }> = [
  { rotulo: "Plano", href: "/planos", caminho: /\/planos$/ },
  { rotulo: "Cuidadores", href: "/cuidadores", caminho: /\/cuidadores$/ },
  { rotulo: "Sua conta", href: "/ajustes/conta", caminho: /\/ajustes\/conta$/ },
  { rotulo: "Notificações", href: "/ajustes/notificacoes", caminho: /\/ajustes\/notificacoes$/ },
  { rotulo: "Registro retroativo", href: "/ajustes/registro-retroativo", caminho: /\/ajustes\/registro-retroativo$/ },
  { rotulo: "Baixar ou excluir", href: "/ajustes/seus-dados", caminho: /\/ajustes\/seus-dados$/ },
  { rotulo: "Notificações no iPhone", href: "/notificacoes/ios", caminho: /\/notificacoes\/ios$/ },
];

let conta: ContaDeTeste;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
});

test.describe("Tela de Ajustes", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes");
    await expect(page.getByRole("heading", { name: "Ajustes" })).toBeVisible({ timeout: 15_000 });
  });

  test("mostra os quatro grupos, na ordem", async ({ page }) => {
    // Ordem importa: agrupar por dono é diferente de empilhar por ordem de
    // chegada, e é a ordem que carrega essa diferença.
    //
    // `allTextContents`, nunca `allInnerTexts`: os títulos são desenhados com
    // `uppercase`, e `innerText` devolve o texto DEPOIS do CSS — "CONTA" no
    // lugar de "Conta". O que este teste checa é o conteúdo, não a caixa em
    // que ele aparece.
    const titulos = await lista(page).locator("h2").allTextContents();
    expect(titulos, "os quatro grupos, nesta ordem").toEqual(GRUPOS);
  });

  test("diz em qual conta a pessoa está", async ({ page }) => {
    // Pergunta que aparece de verdade em quem cuida de duas famílias. Fica
    // FORA da grade de duas colunas de propósito: no celular o painel da
    // direita nem renderiza, e é justamente lá que a dúvida aparece.
    const principal = page.locator("main");
    await expect(principal.getByText(conta.nome, { exact: true })).toBeVisible();
    await expect(principal.getByText(conta.email, { exact: true })).toBeVisible();
    await expect(principal.getByText(conta.familia, { exact: true })).toBeVisible();
  });

  test("a lista acompanha o conteúdo no desktop, e vira índice no celular", async ({ page }) => {
    // No índice, a lista aparece nos dois tamanhos — é ela que a pessoa veio ver.
    await expect(lista(page)).toBeVisible();

    await page.goto("/ajustes/notificacoes");
    await expect(page.getByRole("heading", { name: "Notificações" })).toBeVisible({ timeout: 15_000 });

    const voltar = page.getByRole("link", { name: "Ajustes", exact: true });
    if (ehDesktop(page)) {
      // Duas colunas: a lista continua do lado, e não há "voltar" para algo
      // que nunca saiu da tela.
      await expect(lista(page), "a lista fica visível ao lado do conteúdo").toBeVisible();
      await expect(voltar, "sem voltar no desktop").toBeHidden();
    } else {
      // Uma coluna: o conteúdo toma a tela e o voltar devolve ao índice.
      await expect(lista(page), "a lista some para o conteúdo caber").toBeHidden();
      await expect(voltar, "o voltar é o único caminho de volta no celular").toBeVisible();
      await voltar.click();
      await expect(page).toHaveURL(/\/ajustes$/);
      await expect(lista(page)).toBeVisible();
    }
  });

  test("a seção aberta fica marcada na lista", async ({ page }) => {
    // No celular a lista está escondida atrás do voltar — a marcação só tem
    // o que fazer quando as duas convivem. Pular ANTES de navegar.
    test.skip(!ehDesktop(page), "a marcação só existe com as duas colunas");

    await page.goto("/ajustes/seus-dados");

    // Sem esperar por um `heading` aqui: "Seus dados" é ao mesmo tempo um
    // GRUPO da lista e o título da seção, então `getByRole("heading")` acha
    // dois e o modo estrito reprova. A asserção abaixo já espera sozinha.
    const marcada = lista(page).locator('a[aria-current="page"]');
    await expect(marcada).toHaveCount(1, { timeout: 15_000 });
    await expect(marcada).toHaveAttribute("href", "/ajustes/seus-dados");
  });

  test("nada rola de lado", async ({ page }) => {
    await naoRolaNaHorizontal(page);
  });
});

// Um teste por destino: quando um link quebra, o nome do teste que reprova já
// diz qual — em vez de um só "os links de Ajustes", que não diz nada.
for (const { rotulo, href, caminho } of DESTINOS) {
  test(`"${rotulo}" leva para a tela certa`, async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/ajustes");

    const linha = lista(page).locator(`a[href="${href}"]`);
    await expect(linha, `a linha de "${rotulo}" precisa existir`).toBeVisible({ timeout: 15_000 });
    await expect(linha, "o rótulo tem que bater com o destino").toContainText(rotulo);

    await linha.click();
    await expect(page).toHaveURL(caminho);
  });
}
