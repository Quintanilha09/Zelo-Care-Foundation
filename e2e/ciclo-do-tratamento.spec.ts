import { test, expect, type Page } from "@playwright/test";
import {
  criarConta, entrar, criarPaciente, criarTratamentoHoje, registrarUmaDoseHoje,
  type ContaDeTeste,
} from "./apoio";

/**
 * Um tratamento sabe acabar — QUI-16.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Até esta história, um tratamento só sabia **nascer** e **ser editado**.
 * Quem terminava um antibiótico de sete dias sem ter cadastrado data de fim
 * continuava recebendo lembrete para sempre, e a única saída era editar o
 * tratamento e inventar uma data no passado.
 *
 * O servidor aceitava os quatro estados desde a ZELO-20. **A tela nunca
 * chamou com `status`** — e o que nenhuma tela chama ninguém percebe quando
 * quebra. Metade do ciclo (o "Reativar" dos encerrados) já existia; a outra
 * metade, não.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. concluir move o cartão para os encerrados e tira a dose de hoje
 *   2. pausar para o lembrete, e retomar traz de volta
 *   3. "Excluir" só aparece enquanto ninguém registrou dose nenhuma
 */

/**
 * O cartão do TRATAMENTO, e não o cartão da DOSE.
 *
 * Os dois são `rounded-xl` e os dois têm um `h3` com o nome do medicamento —
 * filtrar só pelo nome devolve os dois. O botão "Editar" é o que existe
 * apenas no cartão de tratamento.
 */
function cartaoDoTratamento(page: Page, medicamento: string) {
  return page
    .locator("div.rounded-xl")
    .filter({ has: page.getByRole("heading", { name: medicamento, exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Editar" }) });
}

test.describe("Concluir um tratamento", () => {
  let conta: ContaDeTeste;
  let patientId: number;
  let medicamento: string;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
    ({ medicamento } = await criarTratamentoHoje(request, conta, patientId));
  });

  test("tira a dose de hoje e guarda o tratamento nos encerrados", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    // A dose de hoje existe antes. Sem esta âncora, o teste passaria mesmo
    // que a página nunca tivesse carregado nada.
    await expect(page.getByRole("heading", { name: "Hoje", exact: true })).toBeVisible({
      timeout: 15_000,
    });

    await cartaoDoTratamento(page, medicamento).getByRole("button", { name: "Concluir" }).click();

    // O lembrete para: o servidor limpa as doses pendentes, e a seção "Hoje"
    // só existe quando há dose. É este o defeito que a história conserta —
    // antes, o único jeito era inventar uma data de fim no passado.
    await expect(
      page.getByRole("heading", { name: "Hoje", exact: true }),
      "concluir precisa parar o lembrete de hoje"
    ).toHaveCount(0);

    // E o tratamento não some: vira histórico.
    await expect(
      page.getByText(/Tratamentos encerrados \(1\)/),
      "o tratamento concluído precisa continuar no histórico"
    ).toBeVisible();
  });
});

test.describe("Pausar e retomar", () => {
  let conta: ContaDeTeste;
  let patientId: number;
  let medicamento: string;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
    ({ medicamento } = await criarTratamentoHoje(request, conta, patientId));
  });

  test("pausa para o lembrete, e retomar traz de volta", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    const cartao = cartaoDoTratamento(page, medicamento);
    await expect(cartao.getByText("Ativo", { exact: true })).toBeVisible({ timeout: 15_000 });

    await cartao.getByRole("button", { name: "Pausar" }).click();

    await expect(
      cartao.getByText("Pausado", { exact: true }),
      "o cartão precisa dizer que está pausado"
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Hoje", exact: true }),
      "pausa que continua avisando não é pausa"
    ).toHaveCount(0);

    // Pausado continua entre os ATIVOS de propósito: é um estado de quem
    // ainda está em tratamento, não de quem terminou.
    await cartao.getByRole("button", { name: "Retomar" }).click();

    await expect(cartao.getByText("Ativo", { exact: true })).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Hoje", exact: true }),
      "retomar precisa regenerar a dose de hoje"
    ).toBeVisible();
  });
});

test.describe("Excluir tratamento", () => {
  let conta: ContaDeTeste;
  let patientId: number;
  let comHistorico: string;
  let semHistorico: string;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
    // O plano Grátis cuida de 3 medicamentos — dois cabem.
    ({ medicamento: comHistorico } = await registrarUmaDoseHoje(request, conta, patientId));
    ({ medicamento: semHistorico } = await criarTratamentoHoje(request, conta, patientId, "B"));
  });

  test("só é oferecido enquanto ninguém registrou dose nenhuma", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    const novo = cartaoDoTratamento(page, semHistorico);
    await expect(novo).toBeVisible({ timeout: 15_000 });

    await expect(
      novo.getByRole("button", { name: "Excluir" }),
      "tratamento sem dose registrada pode ser apagado"
    ).toBeVisible();

    // O servidor recusa este com 409 — apagar levaria junto, por cascade, a
    // dose já tomada, e o relatório de adesão passaria a mentir sobre um
    // período que de fato aconteceu. A tela nem oferece.
    await expect(
      cartaoDoTratamento(page, comHistorico).getByRole("button", { name: "Excluir" }),
      "tratamento com histórico não pode oferecer um botão que o servidor vai negar"
    ).toHaveCount(0);
  });

  test("apaga de verdade quando confirmado", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    const novo = cartaoDoTratamento(page, semHistorico);
    await expect(novo).toBeVisible({ timeout: 15_000 });
    await novo.getByRole("button", { name: "Excluir" }).click();

    // Excluir é a única ação do ciclo que não dá para desfazer — as outras
    // três têm "Reativar" logo ali. Por isso é a única que pergunta antes.
    const janela = page.getByRole("alertdialog");
    await expect(janela).toBeVisible();
    await janela.getByRole("button", { name: "Excluir", exact: true }).click();

    await expect(
      page.getByRole("heading", { name: semHistorico, exact: true }),
      "o tratamento cadastrado por engano precisa sumir de verdade"
    ).toHaveCount(0);

    // E o que tinha histórico continua exatamente onde estava.
    await expect(cartaoDoTratamento(page, comHistorico)).toBeVisible();
  });
});
