import { test, expect } from "@playwright/test";
import {
  criarConta, entrar, criarPaciente, publicarUmMomento, abrirPrimeiroMomento,
  type ContaDeTeste,
} from "./apoio";

/**
 * O coração do mural — QUI-10 (Issue #24).
 *
 * ── O que precisa ser provado NA TELA ─────────────────────────────────────
 *
 * O servidor já é testado em `momento-aviso.test.ts`: a resposta traz nomes
 * e nenhum campo de total. Mas a regra da CON-012 é sobre o que a **pessoa
 * vê**, e nada impediria a tela de escrever `quemReagiu.length` ao lado do
 * coração.
 *
 * Daí este arquivo: ele olha o texto renderizado e reprova se aparecer um
 * número onde deveria aparecer um nome.
 */

let conta: ContaDeTeste;
let patientId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  patientId = await criarPaciente(request, conta);
  await publicarUmMomento(request, conta, patientId);
});

test.describe("Mandar um coração", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);
    // QUI-18 — o mural virou grade: o coração mora no visualizador agora,
    // e não embaixo de cada foto.
    await abrirPrimeiroMomento(page);
  });

  test("o coração alterna, e quem reagiu aparece por NOME", async ({ page }) => {
    const botao = page.getByRole("button", { name: "Mandar um coração" });
    await expect(botao, "o visualizador precisa oferecer o coração").toBeVisible();

    // Antes de reagir não existe linha de quem reagiu — mural sem reação é
    // mural sem reação, e está tudo bem (CON-011: nada cobra ninguém).
    await expect(page.getByText(/mandou um coração/)).toHaveCount(0);

    await botao.click();

    // O nome de quem reagiu, por extenso. É o recurso inteiro.
    await expect(
      page.getByText(/Ana Fictícia E2E mandou um coração/),
      "quem reagiu aparece por nome — é a diferença entre carinho e placar"
    ).toBeVisible();

    // O botão vira "tirar", que é o estado pressionado.
    const tirar = page.getByRole("button", { name: "Tirar seu coração" });
    await expect(tirar).toBeVisible();
    await expect(tirar).toHaveAttribute("aria-pressed", "true");

    await tirar.click();
    await expect(page.getByText(/mandou um coração/)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Mandar um coração" })).toBeVisible();
  });

  test("nenhum número aparece perto do coração", async ({ page }) => {
    const botao = page.getByRole("button", { name: /coração/ });
    await expect(botao).toBeVisible();

    // Garante o estado com reação — é nele que um contador apareceria.
    if (await page.getByRole("button", { name: "Mandar um coração" }).count()) {
      await page.getByRole("button", { name: "Mandar um coração" }).click();
      await expect(page.getByText(/mandou um coração/)).toBeVisible();
    }

    const linha = await page.getByText(/mandou um coração/).first().innerText();

    // A frase é EXATAMENTE o nome mais a ação. Nada antes, nada depois — é
    // assim que se prova que ninguém pendurou um contador na ponta.
    expect(linha.trim()).toBe(`${conta.nome} mandou um coração`);

    // E, por segurança, nenhum dígito **fora do nome**.
    //
    // A primeira versão procurava dígito na linha inteira e reprovava sozinha:
    // a conta de teste se chama "Ana Fictícia E2E", e o "2" do E2E entrava na
    // conta. O teste acusava o app de um defeito que era do próprio teste.
    const semNome = linha.replace(conta.nome, "");
    expect(
      /\d/.test(semNome),
      `sobrou número fora do nome na linha de quem reagiu: "${linha}"`
    ).toBeFalsy();
  });

  test("o coração não usa vermelho", async ({ page }) => {
    const botao = page.getByRole("button", { name: /coração/ });
    await expect(botao).toBeVisible();

    // Invariante 5 do produto. Vermelho neste app é ação destrutiva, e um
    // coração de carinho ao lado do botão de apagar não pode ter a mesma cor
    // — no celular, com pressa, é o tipo de confusão que apaga uma foto.
    const cor = await botao.evaluate((el) => getComputedStyle(el).color);
    const m = cor.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (m) {
      const [r, g, b] = [Number(m[1]), Number(m[2]), Number(m[3])];
      expect(
        r > 170 && g < 90 && b < 90,
        `o coração não pode ser vermelho (invariante 5): ${cor}`
      ).toBeFalsy();
    }
  });
});
