import { test, expect } from "@playwright/test";
import { criarConta, entrar, sair, criarPaciente, naoRolaNaHorizontal, type ContaDeTeste } from "./apoio";

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
 *   2. o nome ENCURTA em vez de empurrar o resto — e o nome inteiro continua
 *      disponível para o mouse e para o leitor de tela
 *   3. o cabeçalho não engorda: mesma altura com nome curto e com nome longo
 *   4. "+ Tratamento" continua inteiro na tela e continua abrindo a janela
 *   5. as três seções continuam alcançáveis pela faixa que rola
 *
 * ── O que mudou em 03/09/2026 (Issue #88) ────────────────────────────────
 *
 * O item 2 dizia **truncar**, e o teste media `text-overflow: ellipsis`.
 * O fundador decidiu outra coisa: **guardar completo, mostrar curto**.
 * "Maria Aparecida da Concei…" não é o nome de ninguém; "Maria Testes" é.
 *
 * O que este arquivo protege continua igual — o nome não pode empurrar o
 * cabeçalho, e não pode se perder. Só a forma de conseguir isso mudou.
 */

/**
 * 60 caracteres — exatamente o teto do cadastro. Nada de excepcional: é um
 * nome brasileiro comum.
 *
 * Terminava em "E2E" até 31/08/2026, e o `2` passou a ser recusado quando a
 * Issue #56 pôs allow-list de caracteres no nome do paciente. O nome mudou,
 * o tamanho não: 60 continua sendo o pior caso que o cadastro aceita, que é
 * o que este arquivo precisa provar que a tela aguenta.
 */
const NOME_LONGO = "Maria Aparecida do Nascimento Albuquerque Fictícia de Testes";

/**
 * Como o nome acima aparece na tela desde a Issue #88: primeiro nome +
 * último sobrenome. É o que `nomeCurto` devolve, e é por ele que os
 * seletores deste arquivo procuram.
 */
const NOME_NA_TELA = "Maria Testes";

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
    await expect(page.getByRole("heading", { name: NOME_NA_TELA })).toBeVisible({ timeout: 15_000 });
  });

  test("a página não rola de lado", async ({ page }) => {
    // Antes: o bloco do nome não tinha `min-w-0`, então se recusava a
    // encolher e empurrava a faixa de botões para fora da tela.
    await naoRolaNaHorizontal(page);
  });

  test("o nome encurta, e o nome inteiro não se perde", async ({ page }) => {
    const titulo = page.getByRole("heading", { name: NOME_NA_TELA });

    // ── Duas versões anteriores deste teste, e o que cada uma ensinou ─────
    //
    // A primeira pedia `scrollWidth <= clientWidth`, achando que isso
    // significava "cabe". Significa o oposto: com `overflow: hidden`,
    // `scrollWidth` é o tamanho do texto INTEIRO. O teste reprovava
    // exatamente quando a correção estava funcionando.
    //
    // A segunda exigia `text-overflow: ellipsis` — e essa parte deixou de
    // valer na Issue #88, quando o nome passou a ser ENCURTADO em vez de
    // truncado. Reticências não são o nome de ninguém.
    //
    // O que sobrevive às três versões é o que sempre importou: a caixa do
    // título não pode ficar mais larga que a do pai. É isso que impede o
    // nome de empurrar o resto do cabeçalho.
    const dentroDoPai = await titulo.evaluate((el) => {
      const pai = el.parentElement;
      if (!pai) return false;
      return el.getBoundingClientRect().width <= pai.getBoundingClientRect().width + 1;
    });
    expect(dentroDoPai, "o título não pode ser mais largo que a caixa que o contém").toBeTruthy();

    // Encurtar não pode custar a informação. O nome completo fica no `title`
    // — para quem passa o mouse e para quem usa leitor de tela.
    await expect(
      titulo,
      "o nome completo precisa continuar acessível mesmo encurtado"
    ).toHaveAttribute("title", NOME_LONGO);

    // E o nome mostrado precisa ser um NOME, não um pedaço de um. O texto
    // exato prova as duas coisas de uma vez: é o nome curto, e não tem
    // reticências — que foi a alternativa que o fundador recusou.
    //
    // Medido no título, e não na página: "Carregando…" e "Excluindo…" também
    // têm reticências, e são legítimas.
    await expect(titulo).toHaveText(NOME_NA_TELA);
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
    const titulo = await page.getByRole("heading", { name: nome }).boundingBox();
    const acao = await page.getByRole("button", { name: "Tratamento", exact: true }).boundingBox();
    return acao!.y + acao!.height - titulo!.y;
  };

  await entrar(page, outra);
  await page.goto(`/pacientes/${curto}`);
  await expect(page.getByRole("heading", { name: "Ana Teste" })).toBeVisible({ timeout: 15_000 });
  const comNomeCurto = await alturaDoCabecalho("Ana Teste");

  // Sem isto, o segundo `entrar` abriria a tela inicial já autenticado, o
  // formulário de login não existiria, e o teste morreria em timeout de 30s
  // esperando por um campo de e-mail que nunca ia aparecer.
  await sair(page);
  await entrar(page, conta);
  await page.goto(`/pacientes/${patientId}`);
  await expect(page.getByRole("heading", { name: NOME_NA_TELA })).toBeVisible({ timeout: 15_000 });
  const comNomeLongo = await alturaDoCabecalho(NOME_NA_TELA);

  // Esta é a medida do defeito. O nome quebrava em duas ou três linhas e a
  // faixa de botões virava uma escadinha: o cabeçalho dobrava de altura e
  // empurrava a dose de hoje para fora da primeira tela.
  expect(
    comNomeLongo,
    `nome longo engordou o cabeçalho (${comNomeCurto}px → ${comNomeLongo}px)`
  ).toBeLessThanOrEqual(comNomeCurto + 2);
});
