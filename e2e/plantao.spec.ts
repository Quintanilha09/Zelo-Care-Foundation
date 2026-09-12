import { test, expect } from "@playwright/test";
import { criarConta, entrar, criarPaciente, type ContaDeTeste } from "./apoio";

/**
 * A escala de plantão na tela — Issue #177.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Os testes de servidor já provam a conta de "de quem é a vez", o turno que
 * atravessa a madrugada e o primeiro lembrete indo para quem está de plantão.
 * O que só o navegador responde é se a família **consegue montar a escala** e
 * se a frase certa aparece para a pessoa certa.
 *
 * ── E o último teste é o que mais importa ────────────────────────────────
 *
 * Sem escala nenhuma, a tela não pode ter mudado em nada. Família que não
 * reveza não pode nem ver o assunto — e é a esmagadora maioria.
 */

test.describe("Combinar de quem e a vez", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
  });

  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("sem escala, a ficha so oferece o assunto num link discreto", async ({ page }) => {
    await page.goto(`/pacientes/${patientId}`);

    const link = page.getByRole("button", { name: "Combinar de quem é a vez (plantão)" });
    await expect(link).toBeVisible({ timeout: 15_000 });

    // Fechado: nenhum campo de escala aparece antes de alguém pedir.
    await expect(page.locator("#pl-quem")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "De quem é a vez" })).toHaveCount(0);
  });

  test("sem escala, a tela inicial nao mostra linha de plantao nenhuma", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Hoje é a sua vez")).toHaveCount(0);
    await expect(page.getByText(/Hoje é a vez de/)).toHaveCount(0);
  });

  test("dá para marcar um turno, e a tela inicial passa a dizer que a vez e sua", async ({ page }) => {
    await page.goto(`/pacientes/${patientId}`);
    await page.getByRole("button", { name: "Combinar de quem é a vez (plantão)" }).click();

    await expect(page.getByRole("heading", { name: "De quem é a vez" })).toBeVisible();

    // A frase que impede o mal-entendido inteiro precisa estar à vista.
    await expect(
      page.getByText(/Ninguém perde acesso a nada por não estar de plantão/),
    ).toBeVisible();

    // Uma troca pontual para HOJE: é o caminho mais curto para ver o efeito
    // na tela inicial sem depender de que dia da semana a suíte roda.
    const hoje = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date());

    await page.locator("#pl-quem").click();
    await page.getByRole("option").first().click();

    await page.locator("#pl-tipo").click();
    await page.getByRole("option", { name: "Um dia só (troca)" }).click();

    await page.locator("#pl-data").fill(hoje);
    await page.getByRole("button", { name: "Adicionar turno" }).click();

    // O turno entra na lista sem recarregar a página.
    await expect(page.getByText(new RegExp(hoje.split("-").reverse().join("/")))).toBeVisible({
      timeout: 15_000,
    });

    await page.goto("/");
    await expect(page.getByText("Hoje é a sua vez")).toBeVisible({ timeout: 15_000 });
  });

  test("estar de plantao nao esconde nem desabilita nada", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("Hoje é a sua vez")).toBeVisible({ timeout: 15_000 });

    // ── A linha que não se cruza ──────────────────────────────────────────
    //
    // A escala responde "de quem é a vez?", nunca "quem pode?". A tela
    // inicial continua inteira: o paciente na lista, o acesso à ficha, tudo.
    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByRole("button", { name: /tratamento/i }).first()).toBeEnabled();

    // E a escala é combinação da família: quem está nela pode desfazê-la.
    await expect(page.getByRole("button", { name: /Remover o turno de/ })).toBeVisible();
  });

  test("dá para remover o turno, e a tela inicial volta ao que era", async ({ page }) => {
    await page.goto(`/pacientes/${patientId}`);
    await page.getByRole("button", { name: /Remover o turno de/ }).first().click();

    await expect(page.getByRole("button", { name: /Remover o turno de/ })).toHaveCount(0, {
      timeout: 15_000,
    });

    await page.goto("/");
    await expect(page.getByText("Hoje é a sua vez")).toHaveCount(0);
  });
});
