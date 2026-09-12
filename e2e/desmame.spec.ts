import { test, expect, type Page } from "@playwright/test";
import { criarConta, entrar, criarPaciente, type ContaDeTeste } from "./apoio";

/**
 * O desmame na tela — Issue #172.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * "40mg por 5 dias, 20mg por 5, 10mg por 5, depois para." Receita comum de
 * corticoide, e também de ansiolítico e antidepressivo sendo retirados. Até
 * a #172, cadastrar isso significava criar quatro tratamentos e encerrar
 * cada um à mão — e **cada transição era uma chance de esquecer**.
 *
 * Os testes de servidor já provam que cada dose nasce com a dose do degrau
 * dela e que o aviso de véspera sai. O que só o navegador responde é se o
 * formulário **deixa cadastrar isso**, se a conta de dias aparece à vista, e
 * se os degraus voltam quando o tratamento é reaberto para edição.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. o bloco abre, aceita degraus, e mostra quantos dias dá ao todo
 *   2. "Usar como data de fim" preenche o campo de fim com essa conta
 *   3. salvar e reabrir devolve os degraus exatamente como foram digitados
 *   4. em `every_n_hours` o atalho não aparece — ali ele não seria salvo
 */

const NOME_DO_REMEDIO = "Corticoide Ficticio Desmame (ficticio)";

async function abrirONovoTratamento(page: Page, patientId: number) {
  await page.goto(`/pacientes/${patientId}`);
  await page.getByRole("button", { name: /tratamento/i }).first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/** Preenche um degrau pelo rótulo acessível da linha (1-based). */
async function preencherDegrau(page: Page, n: number, dose: string, dias: string) {
  await page.getByLabel(`Dose do ${n}º degrau`).fill(dose);
  await page.getByLabel(`Dias do ${n}º degrau`).fill(dias);
}

test.describe("Cadastrar um desmame", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
  });

  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("o bloco abre e mostra quantos dias o desmame dura", async ({ page }) => {
    await abrirONovoTratamento(page, patientId);

    // Fechado por padrão: a maioria dos tratamentos tem dose única, e este
    // formulário já é a tela de maior atrito do app. Se o bloco passasse a
    // vir aberto, todo mundo pagaria o preço de um caso que é minoria.
    await expect(page.getByLabel("Dose do 1º degrau")).toHaveCount(0);

    await page.getByRole("button", { name: "A dose vai diminuindo (desmame)" }).click();

    // Nasce com dois degraus: um degrau só não é desmame, é um tratamento
    // normal — e começar com um obrigaria a pessoa a descobrir sozinha que
    // precisa de outro.
    await expect(page.getByLabel("Dose do 1º degrau")).toBeVisible();
    await expect(page.getByLabel("Dose do 2º degrau")).toBeVisible();

    await preencherDegrau(page, 1, "40mg", "5");
    await preencherDegrau(page, 2, "20mg", "5");

    // A conta fica À VISTA. É ela que a pessoa confere contra a receita
    // antes de salvar — escondê-la faria aceitar um número que não dá para
    // conferir.
    await expect(page.getByText(/10 dias ao todo/)).toBeVisible();

    await page.getByRole("button", { name: "Mais um degrau" }).click();
    await preencherDegrau(page, 3, "10mg", "3");
    await expect(page.getByText(/13 dias ao todo/)).toBeVisible();

    // Com três degraus dá para remover um; com dois, não — o botão some para
    // não deixar desmontar o que acabou de ser montado.
    await page.getByRole("button", { name: "Remover o 3º degrau" }).click();
    await expect(page.getByText(/10 dias ao todo/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Remover o \dº degrau/ })).toHaveCount(0);
  });

  test('"Usar como data de fim" preenche o campo de fim', async ({ page }) => {
    await abrirONovoTratamento(page, patientId);

    const inicio = page.locator("#tf-start");
    await inicio.fill("2026-03-01");

    await page.getByRole("button", { name: "A dose vai diminuindo (desmame)" }).click();
    await preencherDegrau(page, 1, "40mg", "5");
    await preencherDegrau(page, 2, "20mg", "5");

    // 1 de março + 10 dias de desmame = o último dia é 10 de março, não 11.
    // O primeiro dia do tratamento É o primeiro dia do desmame, e um
    // off-by-one aqui daria uma dose a mais de corticoide.
    await expect(page.getByText("10 dias ao todo, terminando em 10/03/2026.")).toBeVisible();

    await page.getByRole("button", { name: "Usar como data de fim" }).click();
    await expect(page.locator("#tf-end")).toHaveValue("2026-03-10");

    // Preenchido o fim, o atalho some: ele só existe enquanto a conta e o
    // campo discordam.
    await expect(page.getByRole("button", { name: "Usar como data de fim" })).toHaveCount(0);
  });

  test("salvar e reabrir devolve os degraus como foram digitados", async ({ page }) => {
    await abrirONovoTratamento(page, patientId);

    await page.locator("#tf-med").fill(NOME_DO_REMEDIO);
    await page.locator("#tf-dose").fill("40mg");

    await page.getByRole("button", { name: "A dose vai diminuindo (desmame)" }).click();
    await preencherDegrau(page, 1, "40mg", "5");
    await preencherDegrau(page, 2, "20mg", "4");
    await page.getByRole("button", { name: "Mais um degrau" }).click();
    await preencherDegrau(page, 3, "10mg", "3");

    await page.getByRole("button", { name: "Salvar tratamento" }).click();
    await expect(page.getByRole("dialog")).toBeHidden({ timeout: 15_000 });

    // Reabrir pela edição é o que prova que os degraus foram REALMENTE
    // salvos. Um bloco que aceita o que se digita e não persiste é pior que
    // bloco nenhum: a pessoa sai achando que cadastrou o desmame.
    const cartao = page
      .locator("div.rounded-xl")
      .filter({ has: page.getByRole("heading", { name: NOME_DO_REMEDIO, exact: true }) })
      .filter({ has: page.getByRole("button", { name: "Editar" }) });
    await cartao.getByRole("button", { name: "Editar" }).click();
    await expect(page.getByRole("dialog")).toBeVisible();

    await expect(page.getByLabel("Dose do 1º degrau")).toHaveValue("40mg");
    await expect(page.getByLabel("Dias do 1º degrau")).toHaveValue("5");
    await expect(page.getByLabel("Dose do 2º degrau")).toHaveValue("20mg");
    await expect(page.getByLabel("Dias do 2º degrau")).toHaveValue("4");
    await expect(page.getByLabel("Dose do 3º degrau")).toHaveValue("10mg");
    await expect(page.getByLabel("Dias do 3º degrau")).toHaveValue("3");
  });

  test("em intervalo de horas o atalho nao aparece", async ({ page }) => {
    await abrirONovoTratamento(page, patientId);

    // `every_n_hours` não tem lista de horários, e o formulário não manda os
    // degraus nesse tipo. Mostrar o campo ali seria oferecer algo que o app
    // engole e não salva — pior que não oferecer.
    await page.getByRole("button", { name: "A dose vai diminuindo (desmame)" }).click();
    await preencherDegrau(page, 1, "40mg", "5");

    // Escopado ao diálogo: a ficha atrás dele também tem combobox, e o
    // overlay do diálogo intercepta o clique nele.
    await page.getByRole("dialog").getByRole("combobox").first().click();
    await page.getByRole("option", { name: "A cada X horas" }).click();

    await expect(page.getByLabel("Dose do 1º degrau")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "A dose vai diminuindo (desmame)" })
    ).toHaveCount(0);
  });
});
