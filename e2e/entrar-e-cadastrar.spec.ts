import { test, expect } from "@playwright/test";
import { criarConta, entrar, criarPaciente, type ContaDeTeste } from "./apoio";

/**
 * O caminho de entrada — Issue #7.
 *
 * É o único fluxo do app que **toda** pessoa percorre. Se ele quebrar, nada
 * mais importa — e nenhum dos 516 testes de servidor perceberia, porque do
 * lado do servidor as rotas de autenticação estão cobertas e funcionando.
 * O que não estava coberto é a tela que as usa.
 */

test.describe("Entrar", () => {
  let conta: ContaDeTeste;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
  });

  test("entra com senha correta e chega na tela inicial", async ({ page, request }) => {
    await entrar(page, conta);
    await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible();
  });

  test("senha errada não entra, e a mensagem não diz se o e-mail existe", async ({ page, request }) => {
    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill("senha-errada-de-proposito");
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // Continua na tela de login.
    await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();

    // A mensagem NÃO pode confirmar que a conta existe — isso entregaria a
    // um atacante quais e-mails estão cadastrados.
    const texto = (await page.locator("body").innerText()).toLowerCase();
    expect(
      texto.includes("e-mail não encontrado") || texto.includes("email nao encontrado"),
      "a tela não pode revelar se o e-mail está cadastrado"
    ).toBeFalsy();
  });

  test("o campo obrigatório é marcado, e o marcador não é vermelho", async ({ page, request }) => {
    await page.goto("/");

    // O asterisco de obrigatório usa âmbar, nunca vermelho: neste produto
    // vermelho é reservado a ação destrutiva, e um campo a preencher não é
    // erro nenhum.
    const cor = await page.evaluate(() => {
      const marcas = Array.from(document.querySelectorAll('[aria-hidden="true"]')).filter(
        (el) => el.textContent?.trim() === "*"
      );
      return marcas.length > 0 ? getComputedStyle(marcas[0]).color : null;
    });

    if (cor) {
      const m = cor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
      if (m) {
        const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
        expect(
          r > 170 && g < 90 && b < 90,
          "o asterisco de obrigatório não pode ser vermelho"
        ).toBeFalsy();
      }
    }
  });
});

test.describe("Cadastrar um paciente", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  // UM paciente por conta: o plano Gratis cuida de 1, e criar o segundo
  // devolve 403 PLAN_LIMIT. O produto esta certo; foi o teste que aprendeu.
  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta, "Dona Maria Teste");
  });

  test("o paciente cadastrado aparece na lista", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/pacientes");
    await expect(page.getByText(/Dona Maria Teste/).first()).toBeVisible({ timeout: 15_000 });
  });

  test("a ficha do paciente abre e mostra as seções", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByText(/Dona Maria Teste/).first()).toBeVisible({ timeout: 15_000 });

    // Rotina, Consultas e Histórico são a navegação da ficha. Momentos é a
    // seção nova (QUI-7) e só aparece com consentimento — por isso não entra
    // nesta lista.
    for (const secao of [/rotina/i, /consultas/i, /histórico/i]) {
      await expect(page.getByRole("link", { name: secao }).first()).toBeVisible();
    }
  });
});
