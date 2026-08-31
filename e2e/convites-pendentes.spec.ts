import { expect, test } from "@playwright/test";
import { criarConta, entrar } from "./apoio";

/**
 * Convites pendentes — Issue #47.
 *
 * ── O defeito que este arquivo tranca ─────────────────────────────────────
 *
 * A seção decidia se aparecia olhando UM conjunto e listava OUTRO:
 *
 *   {isPrimary && invites && invites.length > 0 && (   // TODOS os convites
 *      <h3>Convites pendentes</h3>
 *      {invites.filter((i) => i.status === "pending")   // só os pendentes
 *
 * Daí saíam dois comportamentos errados, e este arquivo cobre o segundo:
 *
 *   1. com um convite que não está mais pendente (aceito ou revogado), a
 *      guarda passa e a lista sai vazia — **sobra o título sozinho**
 *   2. com nenhum convite, a seção inteira desaparece — quem nunca convidou
 *      ninguém não descobre que a seção existe
 *
 * ── O que este teste NÃO cobre, e por quê ─────────────────────────────────
 *
 * O caso 1 — o que o fundador viu no navegador — **não é testável em e2e
 * hoje**, e a razão não é preguiça: criar convite passa pelo paywall.
 * `POST /invites` chama `checkCaregiverLimit` (`routes/invites.ts:50`), e o
 * plano Grátis tem `maxCaregivers: 1` (`lib/plan-limits.ts:48`). Uma família
 * recém-criada já tem 1 cuidador, então o primeiro convite responde **403
 * PLAN_LIMIT**.
 *
 * Subir o plano exige escrever direto na tabela `subscriptions`, que é o que
 * os testes de integração fazem (`plan-tiers.test.ts:60`) e o Playwright não
 * tem como fazer — ele fala com o app pela rede, não com o banco.
 *
 * **A correção cobre os dois casos por construção**, porque passou a existir
 * uma lista derivada só: a seção e a lista olham `convitesPendentes`. Mas
 * construção não é teste: o caso 1 fica **sem cobertura automatizada**, e isso
 * está dito aqui em vez de escondido. É bug de renderização, então nenhum
 * teste de servidor o alcança.
 *
 * Se um dia o e2e ganhar como definir plano, o teste que falta é: criar
 * convite, revogar (`DELETE /invites/:id` grava `status: "revoked"` e mantém a
 * linha, `routes/invites.ts:245`), e conferir que aparece a mensagem de vazio
 * em vez do título órfão.
 */

test.describe("Convites pendentes", () => {
  test("sem nenhum convite, a seção existe e diz que não há pendente", async ({
    page,
    request,
  }) => {
    const conta = await criarConta(request);
    await entrar(page, conta);
    await page.goto("/cuidadores");

    // Antes da correção este trecho falhava na primeira linha: com zero
    // convites a guarda `invites.length > 0` derrubava a seção inteira, e o
    // título nem chegava a ser renderizado.
    await expect(page.getByRole("heading", { name: "Convites pendentes" })).toBeVisible();
    await expect(page.getByText("Nenhum convite pendente.")).toBeVisible();

    // E nada de item de convite inventado no lugar.
    await expect(page.getByRole("button", { name: "Revogar" })).toHaveCount(0);
  });
});
