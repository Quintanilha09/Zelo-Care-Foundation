import { expect, test, type Page } from "@playwright/test";

/**
 * As três telas dos documentos legais — Issue #76.
 *
 * ── O que estava quebrado ─────────────────────────────────────────────────
 *
 * O formulário de cadastro **já obrigava** a marcar dois consentimentos, e os
 * três links citados neles — Termos de Uso, Política de Privacidade e política
 * de dados de saúde — levavam a lugar nenhum: as rotas não existiam, e quem
 * clicava caía na tela de login.
 *
 * Aceitar documento que não dá para ler não é consentimento, é um checkbox. E
 * num produto que trata dado de saúde de pessoa vulnerável, o consentimento é a
 * base legal inteira (art. 11 da LGPD).
 *
 * ── Por que o teste é daqui, e não da suíte do servidor ───────────────────
 *
 * O defeito era de **roteamento no navegador**: `App.tsx` só deixa alguns
 * caminhos fora do portão de autenticação, e qualquer outro, sem sessão, cai em
 * `<AuthPage />`. Nada disso existe no servidor — só um navegador de verdade,
 * sem sessão, enxerga.
 *
 * ── O que este arquivo NÃO alcança ────────────────────────────────────────
 *
 * O conteúdo jurídico. Os textos ainda vão passar por revisão de advogado — o
 * que se verifica aqui é que eles **abrem**, dizem qual documento são, e
 * admitem que são rascunho. A revisão do mérito é humana e não é automatizável.
 */

/**
 * Como saber que caímos na tela de login.
 *
 * A aba "Entrar" (`role="tab"`) existe só no `AuthPage`. O título do cartão NÃO
 * serve: `CardTitle` renderiza uma `<div>`, então procurar por um heading daria
 * zero em qualquer página — a asserção passaria sempre, provando nada. O caso
 * de controle logo abaixo é o que garante que este seletor acha o login quando
 * o login está mesmo na tela.
 */
const ABA_DE_LOGIN = { role: "tab" as const, name: "Entrar" };

const DOCUMENTOS = [
  { rota: "/termos", titulo: "Termos de Uso" },
  { rota: "/privacidade", titulo: "Política de Privacidade" },
  { rota: "/consentimento-saude", titulo: "Política de Dados de Saúde" },
] as const;

/** O `document` inteiro não pode transbordar na horizontal. Ver `Tabela`. */
async function naoRolaNaHorizontal(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const raiz = document.documentElement;
    // Um pixel de folga: zoom e arredondamento de subpixel produzem diferenças
    // de fração que não são transbordo nenhum.
    return raiz.scrollWidth <= raiz.clientWidth + 1;
  });
}

test.describe("O seletor de controle", () => {
  test("uma rota qualquer sem sessão AINDA cai no login — o seletor não é vazio", async ({
    page,
  }) => {
    await page.goto("/pacientes");

    await expect(
      page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
      "sem este caso, os `toHaveCount(0)` abaixo passariam mesmo com o seletor errado",
    ).toBeVisible();
  });
});

for (const documento of DOCUMENTOS) {
  test.describe(documento.titulo, () => {
    test("abre sem sessão — e não é a tela de login", async ({ page }) => {
      await page.goto(documento.rota);

      await expect(
        page.getByRole("heading", { level: 1, name: documento.titulo }),
      ).toBeVisible();
      await expect(
        page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
        "cair no login era o defeito da #76",
      ).toHaveCount(0);
    });

    test("mostra a versão e admite que é rascunho", async ({ page }) => {
      await page.goto(documento.rota);

      // "v1.0" é a mesma string que o cadastro grava em `consent_records` e
      // escreve ao lado do checkbox. Divergir aqui seria registrar aceite de
      // uma versão e mostrar outra.
      await expect(page.getByText("Versão v1.0", { exact: true })).toBeVisible();

      // O cadastro já escreve "rascunho, pendente de revisão jurídica" ao lado
      // do consentimento de saúde. Admitir lá e esconder aqui seria pior que
      // não ter o aviso.
      await expect(page.getByText(/revisão jurídica/)).toBeVisible();
    });

    test("cabe na tela — nada empurra a página para o lado", async ({ page }) => {
      await page.goto(documento.rota);
      await expect(
        page.getByRole("heading", { level: 1, name: documento.titulo }),
      ).toBeVisible();

      // As tabelas destes documentos têm até três colunas. Sem o
      // `overflow-x-auto` no envelope, elas empurram a página inteira no
      // celular — o mesmo defeito da Issue #88, por outro caminho. Este teste
      // roda também no projeto "celular" (Pixel 7).
      expect(await naoRolaNaHorizontal(page)).toBe(true);
    });

    test("tem o caminho de volta", async ({ page }) => {
      await page.goto(documento.rota);

      // O link do cadastro abre em aba nova, mas nem todo mundo chega por ele
      // — quem digita o endereço ou vem de um buscador precisa de saída.
      await page.getByRole("link", { name: /Voltar ao ZELO/ }).click();

      await expect(
        page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
      ).toBeVisible();
    });
  });
}

test.describe("Os links do cadastro", () => {
  /**
   * O teste que corresponde exatamente ao defeito relatado.
   *
   * Não basta as rotas existirem: os `href` do formulário precisam apontar para
   * elas. Por isso os endereços são **lidos do formulário** e visitados, em vez
   * de escritos à mão aqui — se alguém trocar um `href` e esquecer a rota (ou o
   * contrário), este teste cai.
   */
  test("os três levam ao documento certo, e nenhum ao login", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("tab", { name: "Criar conta" }).click();

    const esperados = [
      { nome: "Termos de Uso", titulo: "Termos de Uso" },
      { nome: "Política de Privacidade", titulo: "Política de Privacidade" },
      { nome: "política de dados de saúde", titulo: "Política de Dados de Saúde" },
    ];

    for (const { nome, titulo } of esperados) {
      const href = await page.getByRole("link", { name: nome, exact: true }).getAttribute("href");
      expect(href, `o link "${nome}" precisa ter destino`).toBeTruthy();

      await page.goto(href!);
      await expect(
        page.getByRole("heading", { level: 1, name: titulo }),
        `"${nome}" apontava para ${href}`,
      ).toBeVisible();

      await page.goBack();
      await page.getByRole("tab", { name: "Criar conta" }).click();
    }
  });
});

test.describe("Os documentos se citam entre si", () => {
  test("dos Termos dá para chegar aos outros dois sem passar pelo login", async ({ page }) => {
    await page.goto("/termos");

    await page.getByRole("link", { name: "Política de Privacidade" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Política de Privacidade" }),
    ).toBeVisible();

    await page.goBack();

    await page.getByRole("link", { name: "Política de Dados de Saúde" }).click();
    await expect(
      page.getByRole("heading", { level: 1, name: "Política de Dados de Saúde" }),
    ).toBeVisible();
  });
});
