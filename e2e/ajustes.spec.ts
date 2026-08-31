import { test, expect } from "@playwright/test";
import { criarConta, entrar, naoRolaNaHorizontal, type ContaDeTeste } from "./apoio";

/**
 * Ajustes agrupado por dono — QUI-19.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Ajustes era uma lista plana. Com a chegada de "Seus dados" (QUI-17) ela
 * ficou com quatro itens heterogêneos e nenhuma hierarquia, e "Cuidadores"
 * continuava existindo só no cabeçalho — quem procura "como convido minha
 * irmã" procura em Ajustes.
 *
 * As seções respondem a **de quem é a coisa**: a conta, a família, o titular,
 * a ajuda. É isso que faz alguém achar o ajuste sem ler todos.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. as quatro seções existem e estão na ordem certa
 *   2. a conta em que a pessoa está aparece por nome e e-mail
 *   3. cada linha leva de fato para a tela dela
 *   4. nada disso faz a página rolar de lado
 */

const SECOES = ["Conta", "Família", "Seus dados", "Ajuda"];

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

  test("mostra as quatro seções, na ordem", async ({ page }) => {
    // Ordem importa: agrupar por dono é diferente de empilhar por ordem de
    // chegada, e é a ordem que carrega essa diferença.
    const titulos = await page.locator("main h3").allInnerTexts();
    expect(titulos, "as quatro seções, nesta ordem").toEqual(SECOES);
  });

  test("diz em qual conta a pessoa está", async ({ page }) => {
    // Pergunta que aparece de verdade em quem cuida de duas famílias.
    const principal = page.locator("main");
    await expect(principal.getByText(conta.nome, { exact: true })).toBeVisible();
    await expect(principal.getByText(conta.email, { exact: true })).toBeVisible();
    await expect(principal.getByText(conta.familia, { exact: true })).toBeVisible();
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

    const linha = page.locator(`main a[href="${href}"]`);
    await expect(linha, `a linha de "${rotulo}" precisa existir`).toBeVisible({ timeout: 15_000 });
    await expect(linha, "o rótulo tem que bater com o destino").toContainText(rotulo);

    await linha.click();
    await expect(page).toHaveURL(caminho);
  });
}
