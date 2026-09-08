/**
 * Em que conta eu estou — Issue #78.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * DUAS CONTAS DA MESMA PESSOA FICAM COM O MESMO NOME DE FAMÍLIA POR
 * CONSTRUÇÃO. O E-MAIL É O ÚNICO DADO QUE AS SEPARA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Em 02/09/2026 o fundador reportou que uma conta recém-criada já vinha com um
 * paciente — o que seria uma falha grave de isolamento. Não era: ele estava
 * numa conta antiga e não percebeu, porque o cabeçalho mostrava exatamente o
 * mesmo texto nas duas. Custou uma sessão inteira de investigação.
 *
 * Estas contas de teste reproduzem a situação sem esforço nenhum: `criarConta`
 * dá a **todas** elas o mesmo nome de família, "Família Fictícia E2E". Antes
 * desta Issue, duas delas eram indistinguíveis na tela.
 */
import { test, expect } from "@playwright/test";
import { criarConta, entrar, sair, naoRolaNaHorizontal } from "./apoio";

test.describe("Saber em que conta se está", () => {
  test("duas contas com o mesmo nome de família se distinguem na tela", async ({ page, request }) => {
    const primeira = await criarConta(request);
    const segunda = await criarConta(request);

    // O cenário exato da Issue: o nome da família não diferencia nada.
    expect(primeira.familia).toBe(segunda.familia);
    expect(primeira.email).not.toBe(segunda.email);

    await entrar(page, primeira);
    await expect(page.getByTestId("email-da-conta")).toHaveText(primeira.email);

    await sair(page);
    await entrar(page, segunda);
    await expect(page.getByTestId("email-da-conta")).toHaveText(segunda.email);
  });

  test("o e-mail está visível sem sair da tela, em qualquer tela", async ({ page, request }) => {
    // "Sem navegar" é o critério inteiro: antes, o único lugar do app onde se
    // via o e-mail era Ajustes, a dois toques de distância — e quem não
    // desconfia não dá esses dois toques.
    const conta = await criarConta(request);
    await entrar(page, conta);

    for (const caminho of ["/", "/pacientes", "/cuidadores"]) {
      await page.goto(caminho);
      await expect(page.getByTestId("email-da-conta")).toBeVisible();
    }
  });

  test("e-mail comprido não empurra o cabeçalho para fora da tela", async ({ page, request }) => {
    // O risco de pôr um endereço no cabeçalho é este, e ele aparece só no
    // celular. `min-w-0` mais `truncate` é o que segura — mesma lição da #88,
    // onde um nome de paciente comprido estourou a largura em 73px.
    const conta = await criarConta(request);
    await entrar(page, conta);

    await naoRolaNaHorizontal(page);

    const email = page.getByTestId("email-da-conta");
    await expect(email).toBeVisible();

    // Truncar não pode virar "sumir": o texto continua no DOM inteiro, e o
    // `title` entrega o endereço completo para quem passar o mouse.
    await expect(email).toHaveAttribute("title", conta.email);
  });
});
