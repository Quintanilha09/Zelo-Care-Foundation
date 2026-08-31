import { test, expect } from "@playwright/test";
import { criarConta, entrar, criarPaciente, naoRolaNaHorizontal, type ContaDeTeste } from "./apoio";

/**
 * O cabeçalho da ficha aguenta um nome de gente de verdade — Issue #28.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Já havia um teste garantindo que "nenhuma tela rola na horizontal", e ele
 * estava **verde enquanto o defeito existia**. O motivo é bobo e vale
 * registrar: o paciente da suíte se chama "Dona Maria Teste", que cabe em
 * qualquer tela.
 *
 * O defeito só aparecia com nome longo — e nome longo é o caso comum, não o
 * excepcional, num país onde a pessoa cuidada costuma ter quatro sobrenomes.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. com 60 caracteres, a página continua sem rolar de lado
 *   2. o nome TRUNCA em vez de empurrar o resto — e o nome inteiro continua
 *      disponível para o mouse e para o leitor de tela
 *   3. o cabeçalho não engorda: mesma altura com nome curto e com nome longo
 *   4. "+ Tratamento" continua inteiro na tela e continua abrindo a janela
 *   5. as três seções continuam alcançáveis pela faixa que rola
 */

/** 60 caracteres. Nada de excepcional — é um nome brasileiro comum. */
const NOME_LONGO = "Maria Aparecida do Nascimento Albuquerque Teste Fictícia E2E";

let conta: ContaDeTeste;
let patientId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  patientId = await criarPaciente(request, conta, NOME_LONGO);
});

test.describe("Ficha de paciente com nome longo", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByRole("heading", { name: NOME_LONGO })).toBeVisible({ timeout: 15_000 });
  });

  test("a página não rola de lado", async ({ page }) => {
    // Antes: o bloco do nome não tinha `min-w-0`, então se recusava a
    // encolher e empurrava a faixa de botões para fora da tela.
    await naoRolaNaHorizontal(page);
  });

  test("o nome trunca, e o nome inteiro não se perde", async ({ page }) => {
    const titulo = page.getByRole("heading", { name: NOME_LONGO });

    // Truncar de verdade: o texto renderizado não pode ser mais largo que a
    // caixa que o contém. Se `truncate` sumir, isto reprova.
    const cabe = await titulo.evaluate((el) => el.scrollWidth <= el.clientWidth + 1);
    expect(cabe, "o título precisa truncar em vez de transbordar").toBeTruthy();

    // E truncar não pode custar a informação. O nome completo fica no
    // `title` — para quem passa o mouse e para quem usa leitor de tela.
    await expect(
      titulo,
      "o nome completo precisa continuar acessível mesmo truncado"
    ).toHaveAttribute("title", NOME_LONGO);
  });

  test('"+ Tratamento" fica inteiro na tela e abre a janela', async ({ page }) => {
    const botao = page.getByRole("button", { name: "Tratamento", exact: true });
    const caixa = await botao.boundingBox();
    expect(caixa, "o botão de tratamento precisa estar na tela").not.toBeNull();

    const largura = page.viewportSize()!.width;
    expect(caixa!.x, "o botão não pode começar fora da tela").toBeGreaterThanOrEqual(0);
    expect(
      caixa!.x + caixa!.width,
      "o botão não pode terminar fora da tela"
    ).toBeLessThanOrEqual(largura + 1);

    // Clicar prova que nada o cobre — foi exatamente o defeito da Issue #17,
    // em que "Consultas" ficava por cima e interceptava o toque.
    await botao.click();
    await expect(page.getByRole("heading", { name: "Novo tratamento" })).toBeVisible();
  });

  test("as três seções continuam alcançáveis", async ({ page }) => {
    const faixa = page.getByRole("navigation", { name: "Seções da ficha" });
    await expect(faixa).toBeVisible();

    for (const secao of ["Rotina", "Consultas", "Histórico"]) {
      const item = faixa.getByRole("button", { name: secao, exact: true });
      // `scrollIntoViewIfNeeded` é o gesto que o usuário faria na faixa. Se
      // ela deixasse de rolar, o item ficaria inalcançável no celular.
      await item.scrollIntoViewIfNeeded();
      await expect(item, `"${secao}" precisa continuar alcançável`).toBeVisible();
    }

    await faixa.getByRole("button", { name: "Rotina", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${patientId}/rotina$`));
  });
});

test("o cabeçalho não engorda com o nome longo", async ({ page, request }) => {
  // Duas contas porque o plano Grátis cuida de UM paciente — a mesma razão
  // que já obrigou os outros arquivos desta suíte a fazer o mesmo.
  const outra = await criarConta(request);
  const curto = await criarPaciente(request, outra, "Ana Teste");

  /** Do topo do nome até a base do botão de ação: o cabeçalho inteiro. */
  const alturaDoCabecalho = async (nome: string): Promise<number> => {
    const titulo = await page.getByRole("heading", { name }).boundingBox();
    const acao = await page.getByRole("button", { name: "Tratamento", exact: true }).boundingBox();
    return acao!.y + acao!.height - titulo!.y;
  };

  await entrar(page, outra);
  await page.goto(`/pacientes/${curto}`);
  await expect(page.getByRole("heading", { name: "Ana Teste" })).toBeVisible({ timeout: 15_000 });
  const comNomeCurto = await alturaDoCabecalho("Ana Teste");

  await entrar(page, conta);
  await page.goto(`/pacientes/${patientId}`);
  await expect(page.getByRole("heading", { name: NOME_LONGO })).toBeVisible({ timeout: 15_000 });
  const comNomeLongo = await alturaDoCabecalho(NOME_LONGO);

  // Esta é a medida do defeito. O nome quebrava em duas ou três linhas e a
  // faixa de botões virava uma escadinha: o cabeçalho dobrava de altura e
  // empurrava a dose de hoje para fora da primeira tela.
  expect(
    comNomeLongo,
    `nome longo engordou o cabeçalho (${comNomeCurto}px → ${comNomeLongo}px)`
  ).toBeLessThanOrEqual(comNomeCurto + 2);
});
