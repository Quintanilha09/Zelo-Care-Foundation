import { expect, test, type APIRequestContext } from "@playwright/test";
import { abrirPrimeiroMomento, criarConta, criarPaciente, entrar, tokenDaConta } from "./apoio";

/**
 * O visualizador de Momentos não se mexe entre uma foto e outra — Issue #50.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * A foto era `w-full max-h-[60vh] object-contain`, irmã dos controles numa
 * coluna. Com `object-contain` a **altura renderizada varia com a proporção
 * da foto**: uma paisagem larga ocupa pouca altura, um retrato ocupa 60vh.
 * Como as setas vêm depois da imagem no fluxo, elas subiam e desciam a cada
 * troca — e no celular o dedo já está onde a seta estava.
 *
 * A correção põe a foto dentro de uma caixa de altura fixa.
 *
 * ── Por que duas proporções, e não duas fotos quaisquer ───────────────────
 *
 * Com duas imagens de mesma proporção o teste passaria **também no código
 * quebrado** — as duas renderizariam com a mesma altura. É a diferença de
 * proporção que faz a medição significar alguma coisa. Daí 400×100 e 100×400.
 *
 * O `PNG_1X1` de `apoio.ts` não serve aqui: é quadrado, e um só.
 */

/** 400×100, verde-sálvia. Deitada: em `w-full`, altura = largura ÷ 4. */
const FOTO_LARGA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAZAAAABkCAIAAAAnqfEgAAABZ0lEQVR4nO3UQQ0AIBDAsPMvAQFoQB4W+JElTSpgr806GyBhvhcAPDIsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgAzDAjIMC8gwLCDDsIAMwwIyDAvIMCwgw7CADMMCMgwLyDAsIMOwgIwLlXmv/oqycO0AAAAASUVORK5CYII=",
  "base64"
);

/** 100×400, mesma cor. Em pé: em `w-full`, altura = largura × 4, cortada em 60vh. */
const FOTO_ALTA = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAGQAAAGQCAIAAADX9FK4AAACbElEQVR4nO3QQQkAIADAQPtHMIAZjGcFPzKEgwUYN+ZeumzkBx8FCxasPFiwYOXBggUrDxYsWHmwYMHKgwULVh4sWLDyYMGClQcLFqw8WLBg5cGCBSsPFixYebBgwcqDBQtWHixYsPJgwYKVBwsWrDxYsGDlwYIFKw8WLFh5sGDByoMFC1YeLFiw8mDBgpUHCxasPFiwYOXBggUrDxYsWHmwYMHKgwULVh4sWLDyYMGClQcLFqw8WLBg5cGCBSsPFixYebBgwcqDBQtWHixYsPJgwYKVBwsWrDxYsGDlwYIFKw8WLFh5sGDByoMFC1YeLFiw8mDBgpUHCxasPFiwYOXBggUrDxYsWHmwYMHKgwULVh4sWLDyYMGClQcLFqw8WLBg5cGCBSsPFixYebBgwcqDBQtWHixYsPJgwYKVBwsWrDxYsGDlwYIFKw8WLFh5sGDByoMFC1YeLFiw8mDBgpUHCxasPFiwYOXBggUrDxYsWHmwYMHKgwULVh4sWLDyYMGClQcLFqw8WLBg5cGCBSsPFixYebBgwcqDBQtWHixYsPJgwYKVBwsWrDxYsGDlwYIFKw8WLFh5sGDByoMFC1YeLFiw8mDBgpUHCxasPFiwYOXBggUrDxYsWHmwYMHKgwULVh4sWLDyYMGClQcLFqw8WLBg5cGCBSsPFixYebBgvekAuuyv/qbZdpkAAAAASUVORK5CYII=",
  "base64"
);

/**
 * Consentimento de imagem + duas fotos de proporções diferentes.
 *
 * Feito aqui e não em `apoio.ts` de propósito: `publicarUmMomento` publica
 * uma foto quadrada só, e mexer nele faria este arquivo brigar com toda
 * outra branch que encoste no mesmo auxiliar.
 */
async function publicarDuasProporcoes(
  request: APIRequestContext,
  token: string,
  pacienteId: number
): Promise<void> {
  const cabecalho = { Authorization: `Bearer ${token}` };

  const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
    headers: cabecalho,
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(
    consentimento.ok(),
    `consentimento de imagem falhou: ${await consentimento.text()}`
  ).toBeTruthy();

  for (const [nome, buffer] of [
    ["larga.png", FOTO_LARGA],
    ["alta.png", FOTO_ALTA],
  ] as const) {
    const envio = await request.post("/api/media", {
      headers: cabecalho,
      multipart: {
        patientId: String(pacienteId),
        arquivo: { name: nome, mimeType: "image/png", buffer },
      },
    });
    expect(envio.status(), `publicar ${nome} falhou: ${await envio.text()}`).toBe(201);
  }
}

test("as setas do visualizador ficam no mesmo lugar ao trocar de foto", async ({
  page,
  request,
}) => {
  const conta = await criarConta(request);
  const token = await tokenDaConta(request, conta);
  const pacienteId = await criarPaciente(request, conta);
  await publicarDuasProporcoes(request, token, pacienteId);

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);
  await abrirPrimeiroMomento(page);

  const proxima = page.getByRole("button", { name: "Próximo momento" });
  await expect(proxima).toBeVisible();

  const antes = await proxima.boundingBox();
  expect(antes, "a seta de próximo momento precisa estar na tela").not.toBeNull();

  await proxima.click();

  // A imagem trocou de proporção. Se a caixa não fosse de altura fixa, a
  // altura renderizada mudaria e a seta desceria (ou subiria) junto.
  const depois = await proxima.boundingBox();
  expect(depois, "a seta precisa continuar na tela depois de trocar").not.toBeNull();

  // Um pixel de folga para arredondamento de layout; o defeito movia a seta
  // por centenas.
  expect(
    Math.abs(depois!.y - antes!.y),
    `a seta se moveu de y=${antes!.y} para y=${depois!.y} ao trocar de foto`
  ).toBeLessThanOrEqual(1);
});
