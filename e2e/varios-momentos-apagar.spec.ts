import { expect, test, type APIRequestContext } from "@playwright/test";
import { criarConta, criarPaciente, entrar, PNG_1X1, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * Selecionar vários momentos e apagar de uma vez — Issue #97.
 *
 * ── O que era ─────────────────────────────────────────────────────────────
 *
 * Um por vez. Limpar o mural depois de um passeio de dez fotos era repetir a
 * confirmação dez vezes.
 *
 * ── O que este teste prova, pela TELA ─────────────────────────────────────
 *
 * 1. O número de selecionadas **não existe** no mural em repouso — nem antes
 *    de entrar na seleção, nem depois de sair. É a linha do CON-012.
 * 2. "Selecionar" abre o modo; tocar nas fotos marca; a confirmação diz
 *    QUANTAS vão sumir.
 * 3. Apagadas somem do mural; as que sobraram continuam lá.
 * 4. "Cancelar" sai do modo sem apagar nada.
 */

async function publicarVarias(
  request: APIRequestContext,
  conta: ContaDeTeste,
  pacienteId: number,
  quantas: number
): Promise<void> {
  const token = await tokenDaConta(request, conta);
  const cabecalho = { Authorization: `Bearer ${token}` };
  for (let i = 0; i < quantas; i++) {
    const envio = await request.post("/api/media", {
      headers: cabecalho,
      multipart: {
        patientId: String(pacienteId),
        arquivo: { name: `momento-${i}.png`, mimeType: "image/png", buffer: PNG_1X1 },
      },
    });
    expect(envio.status(), `publicar a ${i + 1}ª falhou: ${await envio.text()}`).toBe(201);
  }
}

/** Nenhuma forma de "N selecionada(s)" pode aparecer no mural em repouso. */
async function semContagemDeSelecao(page: import("@playwright/test").Page): Promise<void> {
  await expect(page.getByText(/\d+ selecionada/)).toHaveCount(0);
  await expect(page.getByText("Toque nas fotos que quer apagar")).toHaveCount(0);
}

test("selecionar três momentos, apagar dois, e o mural fica com o resto", async ({ page, request }) => {
  const conta = await criarConta(request);
  const token = await tokenDaConta(request, conta);
  const pacienteId = await criarPaciente(request, conta);

  const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

  await publicarVarias(request, conta, pacienteId, 3);

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);

  await expect(page.getByRole("region", { name: /^Momentos de / })).toBeVisible({ timeout: 15_000 });
  const abrir = page.getByRole("button", { name: /^Abrir a foto de / });
  await expect(abrir).toHaveCount(3);

  // Em repouso, antes de qualquer seleção: nenhum número (CON-012).
  await semContagemDeSelecao(page);

  await page.getByRole("button", { name: "Selecionar", exact: true }).click();

  // O modo abre sem nada marcado, e o texto convida — ainda sem número.
  await expect(page.getByText("Toque nas fotos que quer apagar")).toBeVisible();

  const marcaveis = page.getByRole("button", { name: /^Selecionar a foto de / });
  await expect(marcaveis).toHaveCount(3);
  await marcaveis.nth(0).click();
  await marcaveis.nth(1).click();

  // Agora sim o número — é estado da ação, não placar do mural.
  await expect(page.getByText("2 selecionadas")).toBeVisible();

  await page.getByRole("button", { name: "Apagar", exact: true }).click();

  // A confirmação diz QUANTAS vão sumir — é a rede de uma ação sem desfazer.
  const dialogo = page.getByRole("alertdialog");
  await expect(dialogo.getByText("Apagar 2 momentos?")).toBeVisible();
  await dialogo.getByRole("button", { name: /^Apagar/ }).click();

  // Sobrou uma no mural, e o modo de seleção fechou sozinho.
  await expect(abrir).toHaveCount(1, { timeout: 15_000 });
  await semContagemDeSelecao(page);
  await expect(page.getByRole("button", { name: "Selecionar", exact: true })).toBeVisible();
});

test("cancelar sai do modo de seleção sem apagar nada", async ({ page, request }) => {
  const conta = await criarConta(request);
  const token = await tokenDaConta(request, conta);
  const pacienteId = await criarPaciente(request, conta);

  const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

  await publicarVarias(request, conta, pacienteId, 2);

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);

  const abrir = page.getByRole("button", { name: /^Abrir a foto de / });
  await expect(abrir).toHaveCount(2, { timeout: 15_000 });

  await page.getByRole("button", { name: "Selecionar", exact: true }).click();
  await page.getByRole("button", { name: /^Selecionar a foto de / }).first().click();
  await expect(page.getByText("1 selecionada")).toBeVisible();

  await page.getByRole("button", { name: "Cancelar" }).click();

  // Voltou ao mural intacto: as duas fotos, e nenhum número.
  await expect(abrir).toHaveCount(2);
  await semContagemDeSelecao(page);
});
