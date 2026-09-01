import { expect, test } from "@playwright/test";
import { criarConta, criarPaciente, entrar, PNG_1X1, tokenDaConta } from "./apoio";

/**
 * Trocar de foto deslizando — Issue #51.
 *
 * ── O que faltava ─────────────────────────────────────────────────────────
 *
 * O visualizador tinha três caminhos para passar de foto: os botões, as setas
 * do teclado e fechar-e-abrir outra. **Nenhum deles é o gesto.** No celular,
 * que é o público real deste app, a única forma de passar a foto era acertar
 * um botão pequeno.
 *
 * ── Por que Pointer Events, e não Touch Events ────────────────────────────
 *
 * Um código só para dedo, mouse e caneta. E é o que o Playwright consegue
 * exercitar nos dois projetos — `mouse.down/move/up` gera pointer events, então
 * o mesmo teste vale no Desktop Chrome e no Pixel 7.
 *
 * ── O gesto ACRESCENTA, nunca substitui ───────────────────────────────────
 *
 * Botões e teclado continuam. Gesto é a única forma de navegar em nenhum app
 * acessível — e este é um app para famílias com idosos.
 */

/** Publica `quantas` fotos pela API. O conteúdo não importa; a ordem sim. */
async function publicar(
  request: import("@playwright/test").APIRequestContext,
  token: string,
  pacienteId: number,
  quantas: number
): Promise<void> {
  const cabecalho = { Authorization: `Bearer ${token}` };
  const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
    headers: cabecalho,
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

  for (let i = 0; i < quantas; i++) {
    const envio = await request.post("/api/media", {
      headers: cabecalho,
      multipart: {
        patientId: String(pacienteId),
        // A legenda identifica a foto: é como o teste sabe em qual está.
        caption: `foto numero ${i + 1}`,
        arquivo: { name: `f${i}.png`, mimeType: "image/png", buffer: PNG_1X1 },
      },
    });
    expect(envio.status(), await envio.text()).toBe(201);
  }
}

/** Arrasta na horizontal, do centro do elemento. `dx` negativo = para a esquerda. */
async function deslizar(
  page: import("@playwright/test").Page,
  alvo: import("@playwright/test").Locator,
  dx: number
): Promise<void> {
  const caixa = await alvo.boundingBox();
  expect(caixa, "o palco da foto precisa estar na tela").not.toBeNull();
  const y = caixa!.y + caixa!.height / 2;
  const x = caixa!.x + caixa!.width / 2;

  await page.mouse.move(x, y);
  await page.mouse.down();
  // Em passos: um único `move` grande pode ser tratado como salto e não como
  // arrasto por alguns navegadores.
  await page.mouse.move(x + dx / 2, y, { steps: 5 });
  await page.mouse.move(x + dx, y, { steps: 5 });
  await page.mouse.up();
}

test.describe("Deslizar para trocar de foto", () => {
  test("arrastar para a esquerda avança, para a direita volta", async ({ page, request }) => {
    const conta = await criarConta(request);
    const token = await tokenDaConta(request, conta);
    const pacienteId = await criarPaciente(request, conta);
    await publicar(request, token, pacienteId, 3);

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await page.getByRole("button", { name: /^Abrir a foto de / }).first().click();

    const janela = page.getByRole("dialog");
    await expect(janela).toBeVisible();

    // A grade vem da mais recente para a mais antiga: a primeira é a nº 3.
    await expect(janela.getByText("foto numero 3")).toBeVisible();

    const palco = janela.locator("div.touch-pan-y").first();

    await deslizar(page, palco, -300);
    await expect(
      janela.getByText("foto numero 2"),
      "arrastar para a esquerda precisa avançar"
    ).toBeVisible();

    await deslizar(page, palco, 300);
    await expect(
      janela.getByText("foto numero 3"),
      "arrastar para a direita precisa voltar"
    ).toBeVisible();
  });

  test("arrasto curto não troca nada — mão trêmula não vira navegação", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request);
    const token = await tokenDaConta(request, conta);
    const pacienteId = await criarPaciente(request, conta);
    await publicar(request, token, pacienteId, 2);

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await page.getByRole("button", { name: /^Abrir a foto de / }).first().click();

    const janela = page.getByRole("dialog");
    await expect(janela.getByText("foto numero 2")).toBeVisible();

    const palco = janela.locator("div.touch-pan-y").first();

    // 20px: bem abaixo do limiar de 50px. É a diferença entre um toque com
    // micro-tremor — regra numa mão idosa, não exceção — e uma decisão.
    await deslizar(page, palco, -20);
    await expect(
      janela.getByText("foto numero 2"),
      "um arrasto curto não pode trocar de foto"
    ).toBeVisible();
  });

  test("as setas e o teclado continuam funcionando — o gesto acrescenta", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request);
    const token = await tokenDaConta(request, conta);
    const pacienteId = await criarPaciente(request, conta);
    await publicar(request, token, pacienteId, 2);

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await page.getByRole("button", { name: /^Abrir a foto de / }).first().click();

    const janela = page.getByRole("dialog");
    await expect(janela.getByText("foto numero 2")).toBeVisible();

    await janela.getByRole("button", { name: "Próximo momento" }).click();
    await expect(janela.getByText("foto numero 1")).toBeVisible();

    await page.keyboard.press("ArrowLeft");
    await expect(janela.getByText("foto numero 2")).toBeVisible();
  });
});
