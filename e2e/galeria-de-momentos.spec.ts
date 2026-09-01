import { expect, test, type APIRequestContext } from "@playwright/test";
import { criarConta, criarPaciente, entrar, PNG_1X1, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * Momentos vira galeria de verdade — Issue #63.
 *
 * ── Por que este arquivo substitui `grade-com-teto.spec.ts` ───────────────
 *
 * Aquele testava que a grade da ficha do paciente tinha `max-height` e rolava
 * por dentro. O teste passava e **o problema continuava na tela**: o teto era
 * `60vh`, e com 10 fotos em 4 colunas o conteúdo dava ~544px contra ~557px de
 * teto. Nunca engatava.
 *
 * Testar "existe um teto" não é testar "a página não cresce". Este arquivo
 * mede a coisa certa: **a altura da ficha não pode mudar com o número de
 * fotos.** É uma medição que não depende de eu ter escolhido o teto certo.
 */

/** A ficha mostra 8. O número vive em `momentos-card.tsx` como FOTOS_NA_PREVIA. */
const FOTOS_NA_PREVIA = 8;

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
        arquivo: { name: `foto-${i}.png`, mimeType: "image/png", buffer: PNG_1X1 },
      },
    });
    expect(envio.status(), `publicar a ${i + 1}ª falhou: ${await envio.text()}`).toBe(201);
  }
}

/**
 * Altura do cartão de Momentos dentro da ficha do paciente.
 *
 * Localizado pela `region` com nome, e não caçando `div` por texto: o cartão
 * ganhou `role="region"` nesta mesma Issue justamente para o teste ter um
 * handle que não quebra na próxima mudança de markup.
 */
async function alturaDoCartao(page: import("@playwright/test").Page): Promise<number> {
  const cartao = page.getByRole("region", { name: /^Momentos de / });
  const caixa = await cartao.boundingBox();
  expect(caixa, "o cartão de Momentos precisa estar na tela").not.toBeNull();
  return caixa!.height;
}

test.describe("Galeria de Momentos", () => {
  test("a ficha do paciente não cresce com o número de fotos", async ({ page, request }) => {
    const conta = await criarConta(request);
    const token = await tokenDaConta(request, conta);
    const pacienteId = await criarPaciente(request, conta);

    const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
    });
    expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

    // Doze: passa da prévia, então o botão "Ver todas as fotos" já aparece.
    // Comparar 8 com 20 mediria também o aparecimento do botão, e aí a
    // diferença de altura teria explicação inocente.
    await publicarVarias(request, conta, pacienteId, 12);

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(
      page.getByRole("button", { name: "Ver todas as fotos" })
    ).toBeVisible({ timeout: 15_000 });

    const comDoze = await alturaDoCartao(page);

    // Mais oito. Na versão antiga isto acrescentava duas linhas de miniatura
    // à ficha inteira.
    await publicarVarias(request, conta, pacienteId, 8);
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Ver todas as fotos" })
    ).toBeVisible({ timeout: 15_000 });

    const comVinte = await alturaDoCartao(page);

    expect(
      Math.abs(comVinte - comDoze),
      `a ficha cresceu de ${comDoze}px para ${comVinte}px ao dobrar as fotos`
    ).toBeLessThanOrEqual(2);

    // E a prévia mostra exatamente o que promete, nem mais.
    await expect(page.getByRole("button", { name: /^Abrir a foto de / })).toHaveCount(
      FOTOS_NA_PREVIA
    );
  });

  test("a galeria abre, rola por dentro e volta da foto para a grade", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request);
    const token = await tokenDaConta(request, conta);
    const pacienteId = await criarPaciente(request, conta);

    const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
    });
    expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

    await publicarVarias(request, conta, pacienteId, 12);

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);

    await page.getByRole("button", { name: "Ver todas as fotos" }).click();

    const janela = page.getByRole("dialog");
    await expect(janela).toBeVisible();

    // A galeria mostra o acervo, não a prévia.
    const naGaleria = janela.getByRole("button", { name: /^Abrir a foto de / });
    await expect(naGaleria).toHaveCount(12);

    // E é ELA que rola, não a ficha por baixo.
    const grade = janela.getByRole("region", { name: /^Todos os momentos de / });
    const contrato = await grade.evaluate((el) => ({
      overflowY: getComputedStyle(el).overflowY,
      maxHeightPx: Number.parseFloat(getComputedStyle(el).maxHeight),
      alturaDaJanela: window.innerHeight,
    }));
    expect(Number.isFinite(contrato.maxHeightPx), "a galeria precisa ter teto de altura").toBe(true);
    expect(contrato.maxHeightPx).toBeLessThanOrEqual(contrato.alturaDaJanela * 0.7);
    expect(contrato.overflowY).toBe("auto");

    // Entrar numa foto e voltar, sem fechar a galeria.
    await naGaleria.first().click();
    await expect(janela.getByRole("button", { name: "Próximo momento" })).toBeVisible();

    await janela.getByRole("button", { name: "Todas as fotos" }).click();
    await expect(naGaleria).toHaveCount(12);
    await expect(janela).toBeVisible();
  });

  test("as setas ficam no mesmo lugar mesmo com legenda — o caso que a #50 deixou passar", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request);
    const token = await tokenDaConta(request, conta);
    const pacienteId = await criarPaciente(request, conta);
    const cabecalho = { Authorization: `Bearer ${token}` };

    const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
      headers: cabecalho,
      data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
    });
    expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

    // Uma SEM legenda e outra COM. Era exatamente esta diferença que movia as
    // setas depois da #50: a legenda entrava entre a foto e os controles.
    for (const legenda of [undefined, "Clube"]) {
      const envio = await request.post("/api/media", {
        headers: cabecalho,
        multipart: {
          patientId: String(pacienteId),
          ...(legenda ? { caption: legenda } : {}),
          arquivo: { name: "foto.png", mimeType: "image/png", buffer: PNG_1X1 },
        },
      });
      expect(envio.status(), await envio.text()).toBe(201);
    }

    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await page.getByRole("button", { name: /^Abrir a foto de / }).first().click();

    const proxima = page.getByRole("button", { name: "Próximo momento" });
    await expect(proxima).toBeVisible();

    const antes = await yQuandoParar(proxima);
    await proxima.click();
    const depois = await yQuandoParar(proxima);

    expect(
      Math.abs(depois - antes),
      `a seta se moveu de y=${antes} para y=${depois} — a legenda ainda desloca os controles`
    ).toBeLessThanOrEqual(1);
  });
});

/**
 * O `y` do elemento depois que ele para de se mexer.
 *
 * O diálogo do shadcn abre com `zoom-in-95` e `slide-in-from-top`, em 200ms.
 * Medir antes disso lê uma posição do meio da animação — foi o que reprovou a
 * primeira versão do teste da #50.
 */
async function yQuandoParar(alvo: import("@playwright/test").Locator): Promise<number> {
  let anterior = Number.NaN;
  for (let tentativa = 0; tentativa < 40; tentativa++) {
    const caixa = await alvo.boundingBox();
    const y = caixa?.y ?? Number.NaN;
    if (Number.isFinite(y) && y === anterior) return y;
    anterior = y;
    await alvo.page().waitForTimeout(50);
  }
  throw new Error("a posição do elemento não estabilizou em 2 segundos");
}
