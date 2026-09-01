import { expect, test } from "@playwright/test";
import { criarConta, criarPaciente, entrar, naoRolaNaHorizontal } from "./apoio";

/**
 * "Atividade recente" não estica a página — Issue #54.
 *
 * ── Uma correção de premissa, antes de tudo ───────────────────────────────
 *
 * O relato foi "a lista cresce infinitamente". **Ela não cresce.**
 * `CaregiversPage.tsx` passa `limit={15}` e `routes/activity.ts` corta em 100.
 *
 * O incômodo é de **altura**, não de quantidade: 15 itens de três linhas cada
 * empurram o fim da página para longe, e o feed fica justamente no fim da
 * tela de Cuidadores. Por isso teto de altura, e **não** paginação —
 * paginação resolveria um problema que não existe.
 *
 * ── O que este teste prova, e o que ele NÃO prova ─────────────────────────
 *
 * Prova que **o teto existe**: a lista é uma região que rola, com altura
 * máxima limitada em relação à janela, alcançável por teclado.
 *
 * **Não prova o comportamento com a lista cheia.** Encher o feed exigiria
 * gerar mais de 15 entradas de `audit_log` — paciente, medicamentos,
 * tratamentos, doses — e mesmo assim a altura resultante dependeria do tamanho
 * da janela do runner. Seria muito preparo para uma medição frágil.
 *
 * O contrato verificado aqui é o que basta para a regressão: se alguém tirar o
 * `max-h` ou o `overflow`, o teste cai. E é isso que se quer trancar.
 */

test("a atividade recente é uma região com teto de altura e rolagem própria", async ({
  page,
  request,
}) => {
  const conta = await criarConta(request);
  // Criar paciente gera entrada no audit_log, então o feed não fica vazio —
  // com zero itens o componente renderiza a mensagem, não a lista.
  await criarPaciente(request, conta);

  await entrar(page, conta);
  await page.goto("/cuidadores");

  const lista = page.getByRole("region", { name: "Atividade recente da família" });
  await expect(lista).toBeVisible({ timeout: 15_000 });

  const contrato = await lista.evaluate((el) => {
    const estilo = getComputedStyle(el);
    return {
      overflowY: estilo.overflowY,
      maxHeightPx: Number.parseFloat(estilo.maxHeight),
      alturaDaJanela: window.innerHeight,
      tabIndex: el.tabIndex,
    };
  });

  // Antes da correção `max-height` era `none` e `Number.parseFloat` daria NaN.
  expect(
    Number.isFinite(contrato.maxHeightPx),
    "a lista precisa ter max-height — sem teto ela estica a página"
  ).toBe(true);

  expect(
    contrato.maxHeightPx,
    `max-height (${contrato.maxHeightPx}px) precisa caber na janela (${contrato.alturaDaJanela}px)`
  ).toBeLessThanOrEqual(contrato.alturaDaJanela * 0.6);

  expect(contrato.overflowY, "sem overflow o teto cortaria o conteúdo").toBe("auto");

  // Região que rola precisa ser alcançável por teclado — senão quem não usa
  // mouse não chega no que está cortado.
  expect(contrato.tabIndex).toBeGreaterThanOrEqual(0);

  await naoRolaNaHorizontal(page);
});
