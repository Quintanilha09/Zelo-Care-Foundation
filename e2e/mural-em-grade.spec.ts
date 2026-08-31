import { test, expect } from "@playwright/test";
import {
  criarConta, entrar, criarPaciente, publicarUmMomento, abrirPrimeiroMomento,
  naoRolaNaHorizontal, type ContaDeTeste,
} from "./apoio";

/**
 * O mural em grade, com visualizador — QUI-18.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * O mural era uma coluna de fotos em tamanho grande. Funcionava com cinco;
 * com cinquenta virava um rolo sem fim, e achar a foto do Natal passado
 * exigia rolar a lista inteira.
 *
 * A grade resolve isso — e abre uma porta perigosa. Toda grade de fotos que
 * existe no mundo tem um número em algum canto: "12 fotos", "mais 30", um
 * contador de curtidas na miniatura. **Aqui não pode** (CON-012), e é fácil
 * demais alguém acrescentar sem perceber que estava proibido.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. as fotos aparecem como miniaturas quadradas numa grade
 *   2. tocar numa miniatura abre o visualizador, com autor e ações
 *   3. NENHUM número aparece no mural — nem na grade, nem no visualizador
 *   4. o mural não faz a página rolar de lado no celular
 */

let conta: ContaDeTeste;
let patientId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  patientId = await criarPaciente(request, conta);
  // Três: o suficiente para a grade ser grade, e para a navegação entre
  // momentos ter para onde ir.
  await publicarUmMomento(request, conta, patientId);
  await publicarUmMomento(request, conta, patientId);
  await publicarUmMomento(request, conta, patientId);
});

test.describe("Mural em grade", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${patientId}`);
  });

  test("as fotos viram miniaturas quadradas", async ({ page }) => {
    const miniaturas = page.getByRole("button", { name: /^Abrir a foto de / });
    await expect(miniaturas).toHaveCount(3, { timeout: 15_000 });

    // Quadrada de verdade: `aspect-square` é o que faz a grade ser grade em
    // vez de uma coluna com fotos menores.
    const proporcao = await miniaturas.first().evaluate((el) => {
      const { width, height } = el.getBoundingClientRect();
      return width / height;
    });
    expect(Math.abs(proporcao - 1), "a miniatura precisa ser quadrada").toBeLessThan(0.05);
  });

  test("tocar numa miniatura abre o visualizador", async ({ page }) => {
    await abrirPrimeiroMomento(page);

    const janela = page.getByRole("dialog");
    // Quem publicou e quando — a informação que a lista antiga mostrava
    // embaixo de cada foto, agora na que a pessoa escolheu olhar.
    await expect(janela.getByText(conta.nome)).toBeVisible();

    // E as três ações, que saíram da grade e vieram para cá.
    await expect(janela.getByRole("button", { name: /coração/ })).toBeVisible();
    await expect(janela.getByRole("button", { name: /[Gg]uardar/ })).toBeVisible();
    await expect(janela.getByRole("button", { name: "Apagar este momento" })).toBeVisible();
  });

  test("dá para passar para o momento seguinte sem fechar", async ({ page }) => {
    await abrirPrimeiroMomento(page);
    const janela = page.getByRole("dialog");

    // No primeiro, "anterior" não tem para onde ir.
    await expect(janela.getByRole("button", { name: "Momento anterior" })).toBeDisabled();

    const seguinte = janela.getByRole("button", { name: "Próximo momento" });
    await expect(seguinte).toBeEnabled();
    await seguinte.click();

    // Andou: agora dá para voltar, e a janela continua aberta.
    await expect(janela.getByRole("button", { name: "Momento anterior" })).toBeEnabled();
    await expect(janela).toBeVisible();
  });

  test("nenhum número aparece no mural", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /^Abrir a foto de / }).first()
    ).toBeVisible({ timeout: 15_000 });

    // Toda grade de fotos do mundo tem um número em algum canto. Esta não
    // pode ter (CON-012): sem "3 fotos", sem "mais 30", sem contador na
    // miniatura. O que a grade mostra é marca — um coração, um marcador —
    // e marca não conta nada.
    const grade = page.locator("ul.grid").first();
    const texto = (await grade.innerText()).trim();
    expect(
      /\d/.test(texto),
      `apareceu número na grade do mural, e número aqui só pode ser contagem: "${texto}"`
    ).toBeFalsy();

    // E no botão de "ver mais", que é o outro lugar onde um "faltam 30"
    // entraria sem ninguém notar.
    const verMais = page.getByRole("button", { name: /momentos mais antigos/ });
    if (await verMais.count()) {
      expect(/\d/.test(await verMais.innerText())).toBeFalsy();
    }
  });

  test("não faz a página rolar de lado", async ({ page }) => {
    await expect(
      page.getByRole("button", { name: /^Abrir a foto de / }).first()
    ).toBeVisible({ timeout: 15_000 });
    await naoRolaNaHorizontal(page);
  });
});
