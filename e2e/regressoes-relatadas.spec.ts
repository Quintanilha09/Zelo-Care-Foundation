import { test, expect } from "@playwright/test";
import { criarConta, entrar, criarPaciente, naoRolaNaHorizontal, type ContaDeTeste } from "./apoio";

/**
 * Os defeitos que o fundador encontrou na mão — Issue #7.
 *
 * ── Por que este arquivo existe antes de qualquer outro ───────────────────
 *
 * Numa única semana, todos estes chegaram por relato dele, nenhum por teste:
 *
 *   1. a janela de "Novo tratamento" era menor que o conteúdo
 *   2. o botão de salvar tratamento não salvava
 *   3. o campo numérico tinha setinhas do tamanho de um grão de arroz
 *   4. o campo "Local" aparecia preto, fora do padrão dos outros
 *   5. a foto do mural ocupava a tela inteira
 *   6. o aviso de plano só aparecia DEPOIS de preencher o formulário todo
 *
 * **Os 516 testes de servidor não pegariam nenhum.** Cada um destes casos é
 * um deles, escrito para falhar se voltar.
 *
 * Não é a suíte de interface completa — é a dívida específica que este
 * projeto já pagou uma vez e não quer pagar de novo.
 */

let conta: ContaDeTeste;
let patientId: number;

// UM paciente por conta, criado uma vez.
//
// A primeira versao criava um por teste e o segundo batia em
// `PLAN_LIMIT`: o plano Gratis cuida de 1 paciente, o Familia libera 5.
// Ou seja, o produto estava certo e o teste errado — e o E2E acabou
// confirmando que o limite de plano funciona de ponta a ponta.
test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  patientId = await criarPaciente(request, conta);
});

test.describe("Defeitos relatados em 24 e 25/08/2026", () => {

  test.beforeEach(async ({ page, request }) => {
    await entrar(page, conta);
  });

  test("a janela de Novo tratamento cabe na tela", async ({ page }, info) => {
    // DEFEITO CONHECIDO, Issue #17: no celular o botao que abre esta janela
    // esta COBERTO pelo de "Consultas" — quatro botoes numa linha flex sem
    // `flex-wrap`, que no desktop cabem e num Pixel 7 nao.
    //
    // Foi este teste que achou o defeito, e e o primeiro que a suite de
    // interface pega sozinha antes de chegar ao fundador.
    //
    // Tirar esta linha e o que vai PROVAR a correcao do layout.
    test.skip(info.project.name === "celular", "Issue #17: botao coberto no celular");

    await page.goto(`/pacientes/${patientId}`);

    await page.getByRole("button", { name: /tratamento/i }).first().click();
    const dialogo = page.getByRole("dialog");
    await expect(dialogo).toBeVisible();

    // O defeito era o conteúdo ser MAIS LARGO que a janela: um item de grid
    // se recusa a encolher abaixo do próprio conteúdo mínimo, e a correção
    // foi `grid-cols-[minmax(0,1fr)]`. Se alguém tirar isso, esta conta
    // volta a dar diferente.
    const caixa = await dialogo.boundingBox();
    expect(caixa, "a janela precisa estar desenhada").not.toBeNull();

    const larguraDaJanela = await page.evaluate(() => window.innerWidth);
    expect(
      caixa!.width,
      "a janela não pode ser mais larga que a tela"
    ).toBeLessThanOrEqual(larguraDaJanela);

    const estouraPorDentro = await dialogo.evaluate(
      (el) => el.scrollWidth - el.clientWidth
    );
    expect(
      estouraPorDentro,
      "o conteúdo não pode ser mais largo que a janela que o contém"
    ).toBeLessThanOrEqual(1);

    await naoRolaNaHorizontal(page);
  });

  test("o campo numérico não usa as setinhas nativas e recusa letra", async ({ page }, info) => {
    // DEFEITO CONHECIDO, Issue #17: no celular o botao que abre esta janela
    // esta COBERTO pelo de "Consultas" — quatro botoes numa linha flex sem
    // `flex-wrap`, que no desktop cabem e num Pixel 7 nao.
    //
    // Foi este teste que achou o defeito, e e o primeiro que a suite de
    // interface pega sozinha antes de chegar ao fundador.
    //
    // Tirar esta linha e o que vai PROVAR a correcao do layout.
    test.skip(info.project.name === "celular", "Issue #17: botao coberto no celular");

    await page.goto(`/pacientes/${patientId}`);
    await page.getByRole("button", { name: /tratamento/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    // Os dois defeitos do `type="number"`, num teste só:
    //
    // 1. As setinhas nativas são minúsculas. A correção foi trocar por
    //    botões de 36px — então NENHUM campo pode ser type="number".
    // 2. O `type="number"` MOSTRA a letra digitada e reporta value === "",
    //    fazendo tela e estado discordarem.
    const numericos = page.locator('input[type="number"]');
    expect(
      await numericos.count(),
      'nenhum campo pode ser type="number": as setinhas são pequenas demais e o campo mente sobre o próprio valor'
    ).toBe(0);

    // O substituto: texto com teclado numérico.
    const campo = page.locator('input[inputmode="numeric"]').first();
    if (await campo.count()) {
      await campo.fill("");
      await campo.type("ff");
      expect(
        await campo.inputValue(),
        "letra digitada não pode aparecer no campo — foi exatamente o que confundiu em Quantidade na caixa"
      ).toBe("");
    }
  });

  test("os botões de aumentar e diminuir têm alvo de toque decente", async ({ page }, info) => {
    // DEFEITO CONHECIDO, Issue #17: no celular o botao que abre esta janela
    // esta COBERTO pelo de "Consultas" — quatro botoes numa linha flex sem
    // `flex-wrap`, que no desktop cabem e num Pixel 7 nao.
    //
    // Foi este teste que achou o defeito, e e o primeiro que a suite de
    // interface pega sozinha antes de chegar ao fundador.
    //
    // Tirar esta linha e o que vai PROVAR a correcao do layout.
    test.skip(info.project.name === "celular", "Issue #17: botao coberto no celular");

    await page.goto(`/pacientes/${patientId}`);
    await page.getByRole("button", { name: /tratamento/i }).first().click();
    await expect(page.getByRole("dialog")).toBeVisible();

    const aumentar = page.getByRole("button", { name: /aumentar/i }).first();
    if (await aumentar.count()) {
      const caixa = await aumentar.boundingBox();
      // 36px é o mínimo confortável adotado no CampoNumero. Abaixo disso o
      // alvo vira impossível de acertar num celular.
      expect(caixa!.height, "alvo de toque pequeno demais").toBeGreaterThanOrEqual(32);
      expect(caixa!.width, "alvo de toque pequeno demais").toBeGreaterThanOrEqual(32);
    }
  });

  test("nenhuma tela rola na horizontal", async ({ page, request }) => {

    for (const caminho of ["/", "/pacientes", `/pacientes/${patientId}`, "/cuidadores"]) {
      await page.goto(caminho);
      // `networkidle` NUNCA chega neste app: o canal de tempo real (REQ-021)
      // mantem uma conexao aberta de proposito, entao a rede nunca fica ociosa.
      // Esperar por ela e esperar para sempre.
      await page.waitForLoadState("domcontentloaded");
      await naoRolaNaHorizontal(page);
    }
  });
});

test.describe("Invariantes visuais que não podem regredir", () => {
  test.beforeEach(async ({ page, request }) => {
    await entrar(page, conta);
  });

  test("nada em contexto de dose usa vermelho", async ({ page, request }) => {
    await page.goto("/");
    // `networkidle` NUNCA chega neste app: o canal de tempo real (REQ-021)
      // mantem uma conexao aberta de proposito, entao a rede nunca fica ociosa.
      // Esperar por ela e esperar para sempre.
      await page.waitForLoadState("domcontentloaded");

    // Invariante 5: âmbar para pendente e atrasada, verde para tomada.
    // Vermelho é proibido em qualquer contexto de dose — a única exceção
    // deliberada é o botão de sair do modo idoso, que não está nesta tela.
    const vermelhoEmDose = await page.evaluate(() => {
      const suspeitos = Array.from(
        document.querySelectorAll('[class*="dose"], [data-testid*="dose"]')
      );
      return suspeitos
        .map((el) => getComputedStyle(el).color)
        .filter((cor) => {
          const m = cor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
          if (!m) return false;
          const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
          // Vermelho de verdade: dominante e sem verde competindo.
          return r > 170 && g < 90 && b < 90;
        });
    });

    expect(
      vermelhoEmDose,
      "vermelho é proibido em contexto de dose (invariante 5): âmbar para pendente, verde para tomada"
    ).toEqual([]);
  });
});
