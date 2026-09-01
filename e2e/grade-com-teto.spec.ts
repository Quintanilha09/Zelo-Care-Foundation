import { expect, test } from "@playwright/test";
import {
  criarConta,
  criarPaciente,
  entrar,
  naoRolaNaHorizontal,
  publicarUmMomento,
} from "./apoio";

/**
 * A grade de Momentos não estica a ficha do paciente — Issue #52.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * A QUI-18 resolveu metade do problema: antes era uma coluna de fotos em
 * tamanho grande, o que era pior. Mas a grade continua crescendo com o acervo,
 * e o mural guarda 90 dias. Em três colunas no celular, **cada 3 fotos
 * acrescentam uma linha à página inteira**.
 *
 * O mural vive na ficha do paciente, junto de tratamento, dose e consulta.
 * Seção que cresce sem limite empurra para longe o que o produto vende.
 *
 * ── O que este teste prova, e o que ele NÃO prova ─────────────────────────
 *
 * Prova o contrato: a grade é uma região com teto de altura em relação à
 * janela, que rola por dentro e é alcançável por teclado. Antes da correção
 * `max-height` era `none`, e o teste cai.
 *
 * Não prova o comportamento com cinquenta fotos. Publicar cinquenta pela API
 * levaria minutos e a altura ainda dependeria da janela do runner — muito
 * preparo para uma medição frágil. O que se quer trancar é a regressão.
 *
 * ── O botão de paginação fica FORA da caixa ───────────────────────────────
 *
 * Decisão de layout, e `NÃO COBERTA` por este teste: com uma foto só não há
 * página seguinte, então o botão nem é renderizado. Cobrir exigiria publicar
 * mais fotos que o tamanho da página do servidor.
 *
 * Fica registrado o porquê da decisão: dentro da região que rola, o botão
 * sumiria de vista assim que a pessoa rolasse a grade — e o mural passaria a
 * parecer que acabou quando não acabou.
 */

test("a grade de Momentos tem teto de altura e rola por dentro", async ({ page, request }) => {
  const conta = await criarConta(request);
  const pacienteId = await criarPaciente(request, conta);
  await publicarUmMomento(request, conta, pacienteId);

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);

  const grade = page.getByRole("region", { name: /^Momentos de / });
  await expect(grade).toBeVisible({ timeout: 15_000 });

  const contrato = await grade.evaluate((el) => {
    const estilo = getComputedStyle(el);
    return {
      overflowY: estilo.overflowY,
      maxHeightPx: Number.parseFloat(estilo.maxHeight),
      alturaDaJanela: window.innerHeight,
      tabIndex: el.tabIndex,
    };
  });

  expect(
    Number.isFinite(contrato.maxHeightPx),
    "a grade precisa ter max-height — sem teto ela estica a ficha do paciente"
  ).toBe(true);

  expect(
    contrato.maxHeightPx,
    `max-height (${contrato.maxHeightPx}px) precisa caber na janela (${contrato.alturaDaJanela}px)`
  ).toBeLessThanOrEqual(contrato.alturaDaJanela * 0.7);

  expect(contrato.overflowY, "sem overflow o teto cortaria as fotos").toBe("auto");
  expect(contrato.tabIndex, "região que rola precisa ser alcançável por teclado").toBeGreaterThanOrEqual(0);

  // A miniatura continua clicável dentro da região — o teto não pode ter
  // quebrado a abertura do visualizador.
  await expect(
    grade.getByRole("button", { name: /^Abrir (a foto|o recado) de / }).first()
  ).toBeVisible();

  await naoRolaNaHorizontal(page);
});
