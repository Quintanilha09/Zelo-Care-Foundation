/**
 * Entrar de um aparelho novo — Issue #79, pela tela.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A SUÍTE DE SERVIDOR JÁ PROVA AS REGRAS. O QUE SÓ UM NAVEGADOR RESPONDE É SE
 * A PESSOA CONSEGUE ATRAVESSAR ISTO — E SE, AO NÃO CONSEGUIR, ELA ENTENDE O
 * QUE FAZER.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Dois caminhos importam aqui, e os dois terminam dentro do app:
 *
 *   1. **o código do e-mail**, que é o caminho de todo dia
 *   2. **o código de recuperação**, que é o caminho do dia ruim — e-mail que
 *      não chega, caixa perdida, endereço do trabalho antigo
 *
 * O segundo é o que este arquivo exercita de ponta a ponta, porque é o único
 * que o teste pode percorrer sem um provedor de e-mail — e porque é o que, se
 * quebrar, transforma uma função de segurança em conta perdida.
 */
import { test, expect, type APIRequestContext } from "@playwright/test";
import { criarConta, sair, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * Liga o segundo fator pela API, guardando os códigos.
 *
 * O `criarConta` de `apoio.ts` já faz isso para todas as outras specs, mas
 * descarta os códigos — ele só precisa do token do aparelho. Aqui os códigos
 * SÃO o assunto, então as contas nascem com `{ comSegundoFator: false }` e a
 * ativação acontece linha a linha.
 */
async function ligarSegundoFator(
  request: APIRequestContext,
  conta: ContaDeTeste,
): Promise<string[]> {
  const token = await tokenDaConta(request, conta);
  const cabecalho = { Authorization: `Bearer ${token}` };

  const gerados = await request.post("/api/account/segundo-fator/codigos", {
    headers: cabecalho,
    data: {},
  });
  expect(gerados.ok(), `gerar códigos falhou: ${await gerados.text()}`).toBeTruthy();
  const { codigos } = (await gerados.json()) as { codigos: string[] };

  const ativou = await request.post("/api/account/segundo-fator/ativar", {
    headers: cabecalho,
    data: {},
  });
  expect(ativou.ok(), `ativar falhou: ${await ativou.text()}`).toBeTruthy();

  return codigos;
}

test.describe("Aparelho novo", () => {
  test("pede código, aceita um de recuperação, e não pede de novo", async ({ page, request }) => {
    const conta = await criarConta(request, { comSegundoFator: false });
    const codigos = await ligarSegundoFator(request, conta);

    // O navegador nunca viu esta conta: o token do aparelho foi emitido para a
    // sessão de API, que não compartilha `localStorage` com a página.
    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill(conta.senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    // ── 1. A senha certa não basta ────────────────────────────────────────
    // Ancorado na dica que acompanha o campo, e não no rótulo: `CampoLabel`
    // acrescenta um " (obrigatório)" invisível, então o nome acessível do campo
    // é "Código (obrigatório)" — um seletor exato por "Código" não acha nada.
    await expect(page.getByText(/Pode colar o código inteiro/)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[href="/pacientes"]')).toHaveCount(0);

    // ── 2. O caminho do dia ruim ──────────────────────────────────────────
    await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
    await page.getByLabel(/Código de recuperação/i).fill(codigos[0]!);
    await page.getByRole("button", { name: "Entrar com este código" }).click();

    await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible({ timeout: 15_000 });

    // ── 3. O aparelho ficou confiável ─────────────────────────────────────
    //
    // Sem isto, a pessoa veria código a cada entrada — e a função que deveria
    // proteger viraria a que atrapalha. `sair` limpa a sessão, mas o token do
    // aparelho sobrevive de propósito (ver `clearTokens` em auth-client.ts).
    await page.goto("/");
    await page.evaluate(() => {
      localStorage.removeItem("zelo_refresh_token");
      localStorage.removeItem("zelo_user_id");
    });
    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill(conta.senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Pode colar o código inteiro/)).toHaveCount(0);
  });

  test("o código de recuperação usado não serve duas vezes", async ({ page, request }) => {
    // Um código que continuasse valendo seria uma senha permanente escrita num
    // papel — exatamente o que ele não pode ser.
    const conta = await criarConta(request, { comSegundoFator: false });
    const codigos = await ligarSegundoFator(request, conta);

    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill(conta.senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
    await page.getByLabel(/Código de recuperação/i).fill(codigos[0]!);
    await page.getByRole("button", { name: "Entrar com este código" }).click();
    await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible({ timeout: 15_000 });

    // Sai de tudo, inclusive do aparelho — senão a segunda entrada nem pediria
    // código, e o teste passaria sem testar nada.
    await sair(page);

    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill(conta.senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await page.getByRole("button", { name: "Usar um código de recuperação" }).click();
    await page.getByLabel(/Código de recuperação/i).fill(codigos[0]!);
    await page.getByRole("button", { name: "Entrar com este código" }).click();

    await expect(page.getByText(/inválido ou expirado/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.locator('a[href="/pacientes"]')).toHaveCount(0);
  });

  test("a ativação mostra os dez códigos e exige confirmar que guardou", async ({
    page,
    request,
  }) => {
    // O `entrar` de apoio.ts atravessa esta tela em toda spec, mas nenhuma
    // afirma o que ela precisa ter. Estas três coisas são a decisão de produto
    // inteira: dez códigos, visíveis, e um passo que a pessoa não atravessa
    // sem parar para ler.
    const conta = await criarConta(request, { comSegundoFator: false });

    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill(conta.senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();

    const gerar = page.getByRole("button", { name: "Gerar meus códigos" });
    await expect(gerar).toBeVisible({ timeout: 15_000 });
    await gerar.click();

    await expect(page.getByTestId("lista-de-codigos").locator("li")).toHaveCount(10);

    const ativar = page.getByRole("button", { name: "Ativar e continuar" });
    await expect(ativar).toBeDisabled();

    await page.getByLabel("Guardei meus códigos").click();
    await expect(ativar).toBeEnabled();
    await ativar.click();

    await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible({ timeout: 15_000 });
  });

  test("o modo idoso nunca vê pedido de segundo fator", async ({ page, request }) => {
    // ═══════════════════════════════════════════════════════════════════════
    // INVARIANTE 6, NA FORMA MAIS DIRETA QUE ELE TEM.
    // ═══════════════════════════════════════════════════════════════════════
    //
    // O aparelho é do idoso, e quem está ali muitas vezes não tem e-mail
    // nenhum. Em App.tsx o gate da ativação fica DEPOIS do gate do modo idoso,
    // e é só isso que impede a tela do paciente de ser tomada por um pedido de
    // segurança que ele não teria como cumprir.
    //
    // Trocar a ordem das duas checagens não quebra mais nada visível. Este
    // caso é o único lugar onde essa troca aparece.
    const conta = await criarConta(request, { comSegundoFator: false });

    // De propósito NÃO usa `entrar`: aquele helper ativa o segundo fator, e a
    // conta ativada não veria a tela de ativação de qualquer jeito — o teste
    // passaria sem testar nada. Aqui a sessão para na tela de ativação.
    await page.goto("/");
    await page.getByLabel(/E-mail/i).first().fill(conta.email);
    await page.getByLabel(/^Senha/i).first().fill(conta.senha);
    await page.getByRole("button", { name: "Entrar", exact: true }).click();
    await expect(page.getByRole("button", { name: "Gerar meus códigos" })).toBeVisible({
      timeout: 15_000,
    });

    // O mesmo aparelho vira o aparelho do paciente.
    await page.evaluate(() => {
      localStorage.setItem("zelo_elder_mode_patient_id", "1");
    });
    await page.goto("/");

    await expect(page.getByRole("button", { name: "Gerar meus códigos" })).toHaveCount(0);
  });
});
