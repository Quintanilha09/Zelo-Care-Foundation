import { test, expect } from "@playwright/test";
import {
  criarConta, criarPaciente, subirPlano, criarTratamentoHoje, entrar,
  type ContaDeTeste,
} from "./apoio";

/**
 * A tela inicial é de TODOS os pacientes — Issue #178.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELA MOSTRAVA UM, E O CUIDADOR TINHA QUATRO.
 *
 * O app abria numa tela chamada "Cuidando de {nome}", com um paciente
 * escolhido e gravado. O fundador, que cuida de quatro: *"a tela inicial
 * mostra que estou cuidando somente de um paciente mas ao clicar na lista
 * mostram os outros"*.
 *
 * Com quatro pacientes, qualquer escolha automática está errada três vezes
 * em quatro. A resposta não era um seletor melhor — era não escolher.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que só a tela prova ─────────────────────────────────────────────────
 *
 * O servidor já é medido em `o-dia-de-todos.test.ts`: ele devolve as doses de
 * todos. O que só o navegador responde é se elas **aparecem juntas**, com o
 * nome de cada um, e se o seletor sumiu de verdade.
 */
test.describe("O dia de todos na tela inicial", () => {
  let conta: ContaDeTeste;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    // O plano Grátis cuida de UM paciente, e esta issue só existe a partir do
    // segundo. Mesma razão do `subirPlano` nos outros specs (#122).
    await subirPlano(request, conta, "professional");

    const jack = await criarPaciente(request, conta, "Jack Chan Teste");
    const jose = await criarPaciente(request, conta, "Jose Souza Teste");
    await criarTratamentoHoje(request, conta, jack, "Jack");
    await criarTratamentoHoje(request, conta, jose, "Jose");
  });

  test("as doses dos dois aparecem juntas, com o nome de cada um", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");

    // O título deixou de nomear um paciente: ele diz o que a tela mostra.
    await expect(
      page.getByRole("heading", { name: "Hoje" }),
      'a tela inicial era "Cuidando de {nome}" — e com dois pacientes isso era falso por omissão',
    ).toBeVisible({ timeout: 15_000 });

    // O defeito inteiro, dito ao contrário: os dois nomes na mesma tela, sem
    // ninguém trocar de paciente.
    await expect(page.getByText(/Jack/).first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Jose/).first()).toBeVisible();
  });

  test("nao ha mais seletor de paciente nem atalho para outra tela do dia", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });

    // O seletor existia só porque a tela era de um paciente. Com ele some a
    // escolha gravada, que fazia o app abrir na pessoa errada no dia seguinte.
    await expect(page.getByRole("combobox", { name: /paciente/i })).toHaveCount(0);
    await expect(page.getByText(/Ver o dia de todos/)).toHaveCount(0);
  });

  test("quem voce cuida fica no rodape, e leva para a ficha", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");

    // É o mapa depois da ação, não antes dela.
    await expect(page.getByRole("heading", { name: "Quem você cuida" })).toBeVisible({ timeout: 15_000 });
    await page.getByRole("link", { name: /Jack/ }).first().click();
    await expect(page).toHaveURL(/\/pacientes\/\d+$/);
  });

  test("a rota antiga /hoje leva para a tela inicial", async ({ page }) => {
    await entrar(page, conta);
    // Notificação antiga e link salvo ainda apontam para cá.
    await page.goto("/hoje");
    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible();
  });
});
