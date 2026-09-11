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

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * O MOTIVO DE TER PULADO — Issue #166.
 *
 * "Pular" era um toque e nada mais, e o relatório do médico recebia só
 * "Pulado". O motivo é metade da informação: "acabou o remédio" e "estava
 * passando mal" são duas conversas diferentes na consulta.
 *
 * O que só a tela prova é a ordem: a dose é registrada NO TOQUE, e a oferta
 * do motivo vem depois. Perguntar antes transformaria um toque em dois.
 * ═══════════════════════════════════════════════════════════════════════════
 */
test.describe("O motivo de ter pulado", () => {
  let conta: ContaDeTeste;
  let pacienteId: number;

  test.beforeEach(async ({ request }) => {
    conta = await criarConta(request);
    pacienteId = await criarPaciente(request, conta);
    await criarTratamentoHoje(request, conta, pacienteId);
  });

  test("pular e um toque, e o motivo vem DEPOIS", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });

    const pular = page.getByRole("button", { name: "Pular", exact: true });
    // A dose das 00:01 já passou, então os botões grandes estão na tela. Se
    // não estiverem, é a das 23:59 — e aí este caso não tem o que exercitar.
    test.skip(!(await pular.count()), "sem dose de agora nesta hora do dia");

    await pular.click();

    // A dose entrou no toque — isto primeiro, porque é o que não pode faltar.
    await expect(page.getByText("Pulado", { exact: true })).toBeVisible({ timeout: 15_000 });

    // E só então a oferta. Ela é uma faixa, não um modal: ignorá-la é uma
    // resposta legítima, e provavelmente a mais comum.
    await expect(page.getByText(/Quer dizer por que a dose não foi dada/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Acabou o remédio" })).toBeVisible();
  });

  test("agora nao fecha a oferta e nao desfaz nada", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });

    const pular = page.getByRole("button", { name: "Pular", exact: true });
    test.skip(!(await pular.count()), "sem dose de agora nesta hora do dia");
    await pular.click();

    await page.getByRole("button", { name: "Agora não" }).click();
    await expect(page.getByText(/Quer dizer por que a dose não foi dada/)).toHaveCount(0);
    // Seguir em frente sem dizer nada não é falha de ninguém — e a dose
    // continua registrada.
    await expect(page.getByText("Pulado", { exact: true })).toBeVisible();
  });
});
