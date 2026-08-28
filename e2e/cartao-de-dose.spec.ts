import { test, expect } from "@playwright/test";
import { criarConta, entrar, criarPaciente, registrarUmaDoseHoje, type ContaDeTeste } from "./apoio";

/**
 * O cartão de dose diz a verdade sobre o próprio estado — Issue #26.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * A frase "às  por" ficou meses na tela — as duas preposições sozinhas, com
 * um buraco em cada lado — e ninguém viu. Não é falta de atenção: **é falta
 * de teste que registre uma dose e olhe o resultado**.
 *
 * Os 545 testes de servidor não pegariam: a API sempre devolveu os dados
 * certos. O defeito era da tela, que não os pedia.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. dose tomada mostra hora E nome, sem preposição solta
 *   2. dose pulada não se disfarça de pendente
 *   3. nenhum estado do cartão usa vermelho (invariante 5)
 */

test.describe("Dose tomada", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
    await registrarUmaDoseHoje(request, conta, patientId, "taken");
  });

  test("mostra a hora e quem registrou, sem preposição solta", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    const selo = page.getByText("Tomado", { exact: true }).first();
    await expect(selo, "a dose registrada precisa aparecer como tomada").toBeVisible({
      timeout: 15_000,
    });

    // A página inteira, e não "o cartão".
    //
    // A primeira versão tentava `locator("div").filter({hasText:/Tomado/}).last()`
    // — e isso devolve o div MAIS PROFUNDO que contém a palavra, que é o
    // próprio selo. A frase não está dentro dele, e o teste reprovava com a
    // correção já funcionando na tela.
    const pagina = await page.locator("body").innerText();

    // O defeito exato que esta issue conserta. Fica primeiro e com mensagem
    // própria: se voltar, quem ler o vermelho entende na hora.
    expect(
      /às\s+por/.test(pagina),
      "voltou a frase quebrada da Issue #26: as preposições sem hora e sem nome"
    ).toBeFalsy();

    // E o que a frase precisa dizer de verdade.
    await expect(
      page.getByText(/às \d{2}:\d{2} por Ana Fictícia E2E/),
      "a dose tomada precisa dizer a hora e quem registrou"
    ).toBeVisible();
  });

  test("a data do tratamento não perde um dia", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    const linha = page.getByText(/desde \d{2}\/\d{2}\/\d{4}/).first();
    await expect(linha).toBeVisible({ timeout: 15_000 });

    // O tratamento foi criado HOJE, no fuso do paciente. A tela lia
    // "2026-08-27" como meia-noite UTC e imprimia no fuso do navegador —
    // três horas antes no Brasil, ou seja, o dia ANTERIOR.
    //
    // Achado por acaso ao ler a saída deste próprio arquivo: a linha dizia
    // "desde 26/08/2026" numa conta criada em 27/08.
    const hoje = new Intl.DateTimeFormat("pt-BR", {
      timeZone: "America/Sao_Paulo",
      day: "2-digit", month: "2-digit", year: "numeric",
    }).format(new Date());

    await expect(
      page.getByText(`desde ${hoje}`).first(),
      "a data de início não pode retroceder um dia por causa do fuso"
    ).toBeVisible();
  });

  test("nenhum estado do cartão usa vermelho", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);
    await expect(page.getByText("Tomado", { exact: true }).first()).toBeVisible({ timeout: 15_000 });

    // Invariante 5: âmbar para pendente e atrasada, verde para tomada,
    // neutro para pulada. Vermelho é proibido em contexto de dose.
    const vermelhos = await page.evaluate(() => {
      const cartoes = Array.from(document.querySelectorAll("h3"))
        .map((h) => h.closest("div.rounded-xl"))
        .filter((el): el is HTMLElement => el !== null);

      return cartoes.flatMap((cartao) =>
        Array.from(cartao.querySelectorAll("*"))
          .map((el) => getComputedStyle(el).color)
          .filter((cor) => {
            const m = cor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
            if (!m) return false;
            const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
            return r > 170 && g < 90 && b < 90;
          })
      );
    });

    expect(vermelhos, "vermelho é proibido em contexto de dose (invariante 5)").toEqual([]);
  });
});

test.describe("Dose pulada", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  // Conta própria: o plano Grátis cuida de 1 paciente, então cada cenário de
  // dose precisa da sua.
  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
    await registrarUmaDoseHoje(request, conta, patientId, "skipped");
  });

  test("não se disfarça de pendente", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);

    // Antes da Issue #26, tudo que não fosse "taken" virava "pending": uma
    // dose pulada de propósito aparecia âmbar, escrita "Pendente", e sem
    // botão nenhum — parecia que a tela tinha travado.
    //
    // O produto já dizia o contrário em outro lugar: pular é uma decisão
    // registrada, e conta como resolvida.
    await expect(
      page.getByText("Pulado", { exact: true }).first(),
      "dose pulada precisa se apresentar como resolvida"
    ).toBeVisible({ timeout: 15_000 });

    await expect(
      page.getByText("Pendente", { exact: true }),
      "a dose pulada não pode continuar contando como pendente"
    ).toHaveCount(0);

    // E não pode oferecer os botões de registrar de novo.
    await expect(page.getByRole("button", { name: /Tomou/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pular", exact: true })).toHaveCount(0);
  });
});
