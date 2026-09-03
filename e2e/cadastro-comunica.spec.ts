import { expect, test } from "@playwright/test";
import { criarConta } from "./apoio";

/**
 * O que a tela de cadastro diz, e por quanto tempo — Issue #81.
 *
 * ── Os dois defeitos ──────────────────────────────────────────────────────
 *
 * 1. **Erro vago.** Tentar se cadastrar com um e-mail que já tem conta
 *    respondia *"Não foi possível criar a conta com esses dados"*. A pessoa
 *    não sabia se errou o e-mail, a senha, um consentimento — ou se já tinha
 *    conta. A justificativa era não confirmar existência de conta; ela não se
 *    sustentava (ver o comentário em `routes/auth.ts`), porque aquela mensagem
 *    era **exclusiva desse caso** e portanto dizia "existe" a quem soubesse ler.
 *
 * 2. **Mensagem que some.** Depois de cadastrar, `setTimeout(…, 3000)` trocava
 *    a tela sozinho. Três segundos para ler um recado que às vezes muda o
 *    caminho da pessoa — e num produto feito para famílias com idoso.
 *
 * ── Por que há espera de verdade aqui ─────────────────────────────────────
 *
 * `waitForTimeout` costuma ser cheiro de teste frágil. Aqui **a passagem do
 * tempo é o objeto do teste**: o defeito era exatamente algo sumindo sozinho
 * depois de três segundos. Esperar mais que isso e verificar que a mensagem
 * continua na tela é a única forma de provar que o `setTimeout` não voltou.
 */

/** Maior que os 3 s do `setTimeout` removido — é isso que o teste vigia. */
const MAIS_QUE_O_ANTIGO_TIMEOUT = 4500;

async function preencherCadastro(
  page: import("@playwright/test").Page,
  dados: { nome: string; email: string; senha: string },
): Promise<void> {
  await page.getByRole("tab", { name: "Criar conta" }).click();
  await page.getByLabel(/^Nome completo/).fill(dados.nome);
  await page.getByLabel(/^E-mail/).fill(dados.email);
  await page.getByLabel(/^Senha \(mínimo 8 caracteres\)/).fill(dados.senha);
  await page.locator("#consent-terms").click();
  await page.locator("#consent-health").click();
  await page.getByRole("button", { name: "Criar conta", exact: true }).click();
}

test.describe("E-mail que já tem conta", () => {
  test("diz o que aconteceu, e oferece o caminho de volta", async ({ page, request }) => {
    const existente = await criarConta(request);

    await page.goto("/");
    await preencherCadastro(page, {
      nome: "Ana Fictícia Repetida",
      email: existente.email,
      senha: "senha-de-teste-123",
    });

    await expect(
      page.getByText(/já tem uma conta no ZELO/),
      "a pessoa precisa saber que o problema é o e-mail, não a senha nem o consentimento",
    ).toBeVisible();

    // Ler "já existe" e ter que descobrir sozinho onde clicar é meio caminho
    // de ajuda.
    await expect(page.getByRole("button", { name: "Ir para a entrada" })).toBeVisible();
  });

  test("o texto genérico antigo não voltou", async ({ page, request }) => {
    const existente = await criarConta(request);

    await page.goto("/");
    await preencherCadastro(page, {
      nome: "Ana Fictícia Repetida",
      email: existente.email,
      senha: "senha-de-teste-123",
    });

    await expect(page.getByText(/já tem uma conta no ZELO/)).toBeVisible();
    await expect(
      page.getByText("Não foi possível criar a conta com esses dados"),
      "esta mensagem não escondia nada e confundia todo mundo",
    ).toHaveCount(0);
  });
});

test.describe("Mensagem de conta criada", () => {
  test("continua na tela depois do tempo em que sumia", async ({ page }) => {
    const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    await page.goto("/");
    await preencherCadastro(page, {
      nome: "Ana Fictícia Mensagem",
      email: `e2e-msg-${marca}@zelo.test`,
      senha: "senha-de-teste-123",
    });

    const recado = page.getByText(/Conta criada/);
    await expect(recado).toBeVisible();

    // O teste inteiro é esta espera. Antes, aqui a tela já teria trocado.
    await page.waitForTimeout(MAIS_QUE_O_ANTIGO_TIMEOUT);

    await expect(
      recado,
      "a mensagem não pode sumir sozinha — quem decide quando sair é a pessoa",
    ).toBeVisible();
  });

  test("quem sai da mensagem é a pessoa, pelo botão", async ({ page }) => {
    const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    await page.goto("/");
    await preencherCadastro(page, {
      nome: "Ana Fictícia Botao",
      email: `e2e-btn-${marca}@zelo.test`,
      senha: "senha-de-teste-123",
    });

    await page.getByRole("button", { name: "Ir para a entrada" }).click();

    // Volta para a aba de entrar, com o formulário de login à mostra.
    await expect(page.getByLabel(/^Senha/).first()).toBeVisible();
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
  });

  test("não fala em 'conta ativada automaticamente'", async ({ page }) => {
    const marca = `${Date.now()}${Math.floor(Math.random() * 1000)}`;

    await page.goto("/");
    await preencherCadastro(page, {
      nome: "Ana Fictícia Jargao",
      email: `e2e-jargao-${marca}@zelo.test`,
      senha: "senha-de-teste-123",
    });

    await expect(page.getByText(/Conta criada/)).toBeVisible();
    // Ninguém deveria precisar saber o que é ambiente de desenvolvimento para
    // entender uma tela.
    await expect(page.getByText(/ativada automaticamente/)).toHaveCount(0);
  });
});
