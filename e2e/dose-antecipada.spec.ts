import { test, expect } from "@playwright/test";
import { criarConta, criarPaciente, criarTratamentoHoje, entrar, type ContaDeTeste } from "./apoio";

/**
 * Dose marcada como tomada antes da hora — Issue #134.
 *
 * ── Por que pela TELA, e não só pelo servidor ─────────────────────────────
 *
 * O defeito era da tela. A ficha do paciente oferecia "✓ Tomou" e "Pular"
 * para **toda** dose pendente, sem olhar o relógio: às 00:49 dava para
 * resolver a dose das 23:00 com um toque. Um teste de servidor sozinho não
 * pegaria isso — lá a regra passou a existir e está certa; o que voltaria a
 * quebrar é o botão aparecer onde não devia.
 *
 * ── E este arquivo cobre um caminho que NENHUM teste cobria ──────────────
 *
 * Medido em 10/09/2026: nenhum spec de `e2e/` jamais clicou em "✓ Tomou" ou
 * "Pular". Os que mencionam esses botões só afirmam que eles **não** estão
 * lá (`cartao-de-dose.spec.ts`, para dose já resolvida). Registrar dose pela
 * tela — o gesto central do produto — nunca tinha sido exercido por um
 * navegador. O terceiro caso aqui embaixo é o primeiro que faz isso.
 */

let conta: ContaDeTeste;
let pacienteId: number;
let horaAgendada: string;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  pacienteId = await criarPaciente(request, conta);
  // A geração só cria dose do agora para a frente, e a posologia deste
  // helper é `["00:01", "23:59"]` — então a dose que nasce é, quase sempre,
  // a das 23:59: exatamente o caso do relato.
  ({ horaAgendada } = await criarTratamentoHoje(request, conta, pacienteId));
});

test.describe("Dose antes da hora", () => {
  test.beforeEach(async ({ page }) => {
    // Rodar na primeira dezena de segundos do dia geraria a dose das 00:01,
    // que está DENTRO da janela de antecipação — e aí não há o que provar.
    // É raro, e mentir sobre isso seria pior que pular.
    test.skip(
      horaAgendada === "00:01",
      "a dose gerada nesta hora do dia esta dentro da janela de antecipacao",
    );
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });
  });

  test("a dose que ainda vai demorar nao tem os botoes grandes", async ({ page }) => {
    // O defeito, dito ao contrário: se estes dois voltarem a aparecer para
    // uma dose distante, o toque acidental volta junto.
    await expect(page.getByRole("button", { name: /Tomou/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pular", exact: true })).toHaveCount(0);

    // E o caminho de propósito continua existindo — o produto nunca bloqueia
    // registro de dose, só deixa de oferecê-lo por acidente.
    await expect(page.getByRole("button", { name: "Já dei este remédio" })).toBeVisible();
  });

  test("a pergunta diz o horario da dose, e `Ainda nao` nao registra nada", async ({ page }) => {
    await page.getByRole("button", { name: "Já dei este remédio" }).click();

    // O horário vem do SERVIDOR: a tela não sabe qual é a janela nem que
    // horas a dose é — ela repete o que veio na resposta do 400.
    const pergunta = page.getByRole("alertdialog");
    await expect(pergunta).toContainText(`Esta dose é das ${horaAgendada}`, { timeout: 15_000 });

    await pergunta.getByRole("button", { name: "Ainda não" }).click();
    await expect(pergunta).toBeHidden();

    // A dose continua pendente: desistir da pergunta não pode ter registrado.
    await expect(page.getByText("Pendente", { exact: true })).toBeVisible();
  });

  test("confirmando, a dose entra — o caminho nunca fecha", async ({ page }) => {
    await page.getByRole("button", { name: "Já dei este remédio" }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Sim, já dei" }).click();

    // Primeira vez em toda a suíte que uma dose é registrada pela TELA.
    await expect(page.getByText("Tomado", { exact: true })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole("button", { name: "Já dei este remédio" })).toHaveCount(0);
  });
});
