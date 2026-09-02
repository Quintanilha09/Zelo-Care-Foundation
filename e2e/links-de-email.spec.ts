import { expect, test } from "@playwright/test";

/**
 * Onde os links do e-mail aterrissam — Issue #73.
 *
 * ── O que estava quebrado ─────────────────────────────────────────────────
 *
 * `App.tsx` deixa quatro caminhos fora do portão de autenticação: `/status`,
 * `/admin`, `/convite` e `/acesso`. **Qualquer outro**, sem sessão, cai em
 * `<AuthPage />` — a tela de login, que ignora a query string inteira.
 *
 * Então `/verificar-email?token=…` e `/redefinir-senha?token=…` levavam a
 * pessoa a um formulário de login com o token válido na barra de endereço, e
 * nada na tela dizendo o que fazer. Pior no primeiro caso: entrar exige
 * `emailVerified`, e a única forma de verificar era aquele link. Beco sem
 * saída perfeito.
 *
 * Ninguém percebeu porque **e-mail nenhum saía** — a integração com o provedor
 * só existe desde a Issue #73. O defeito estava lá desde sempre, sem tráfego.
 *
 * ── Por que os testes são estes, e não o caminho feliz ────────────────────
 *
 * Confirmar uma conta de verdade não dá para exercitar daqui: em
 * desenvolvimento o cadastro auto-verifica e queima o token na mesma transação
 * (ver `routes/auth.ts`), então não sobra token válido para a tela usar. Quem
 * cobre aquele lado é `src/tests/auth.test.ts`, contra o banco.
 *
 * O que **só** este arquivo alcança é a regressão de verdade: estas URLs param
 * de cair na tela de login. `typecheck` não vê isso, e nenhum teste de servidor
 * chega perto.
 */

/**
 * Como saber que caímos na tela de login.
 *
 * A aba "Entrar" (`role="tab"`) existe só no `AuthPage`. O título do cartão
 * NÃO serve: `CardTitle` renderiza uma `<div>`, então procurar por um heading
 * daria zero em qualquer página — a asserção passaria sempre, provando nada.
 * O teste de controle logo abaixo é o que garante que este seletor acha o
 * login quando o login está mesmo na tela.
 */
const ABA_DE_LOGIN = { role: "tab" as const, name: "Entrar" };

test.describe("O seletor de controle", () => {
  test("uma rota qualquer sem sessão AINDA cai no login — o seletor não é vazio", async ({
    page,
  }) => {
    await page.goto("/pacientes");

    await expect(
      page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
      "sem este caso, os `toHaveCount(0)` abaixo passariam mesmo com o seletor errado",
    ).toBeVisible();
  });
});

test.describe("Link de confirmação de e-mail", () => {
  test("com token inválido, explica — e não joga na tela de login", async ({ page }) => {
    await page.goto("/verificar-email?token=token-que-nao-existe");

    await expect(
      page.getByText("Confirmação de e-mail", { exact: true }),
      "a tela de confirmação precisa existir",
    ).toBeVisible();

    await expect(
      page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
      "cair no login era o defeito: o token ia junto na URL e ninguém o lia",
    ).toHaveCount(0);

    await expect(page.getByText(/já foi usado ou passou das 24 horas/)).toBeVisible();
  });

  test("sem token, diz que o link veio incompleto", async ({ page }) => {
    await page.goto("/verificar-email");

    await expect(page.getByText(/link está incompleto/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Ir para a tela de entrada" })).toBeVisible();
  });
});

test.describe("Link de nova senha", () => {
  test("com token, mostra o formulário — e não a tela de login", async ({ page }) => {
    await page.goto("/redefinir-senha?token=token-qualquer");

    await expect(page.getByText("Nova senha", { exact: true })).toBeVisible();
    await expect(
      page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
    ).toHaveCount(0);

    await expect(page.getByLabel(/^Senha nova/)).toBeVisible();
    await expect(page.getByLabel(/^Repita a senha nova/)).toBeVisible();
  });

  test("sem token, nem mostra o formulário", async ({ page }) => {
    await page.goto("/redefinir-senha");

    await expect(page.getByText(/link está incompleto/)).toBeVisible();
    // Preencher uma senha inteira para descobrir no fim que o endereço estava
    // quebrado é gasto de paciência que a tela pode evitar.
    await expect(page.getByLabel(/^Senha nova/)).toHaveCount(0);
  });

  test("senhas diferentes são barradas antes de qualquer ida ao servidor", async ({ page }) => {
    await page.goto("/redefinir-senha?token=token-qualquer");

    await page.getByLabel(/^Senha nova/).fill("senha-boa-123");
    await page.getByLabel(/^Repita a senha nova/).fill("senha-boa-124");
    await page.getByRole("button", { name: "Trocar a senha" }).click();

    // O token é de uso único: gastá-lo num erro de digitação custaria à pessoa
    // o pedido de um e-mail inteiro de novo.
    await expect(page.getByText("As duas senhas não são iguais.", { exact: true })).toBeVisible();
  });

  test("a regra da senha aparece antes do erro, não depois", async ({ page }) => {
    await page.goto("/redefinir-senha?token=token-qualquer");

    await expect(
      page.getByText("Pelo menos 8 caracteres.", { exact: true }),
      "a regra fica escrita desde o início",
    ).toBeVisible();

    await page.getByLabel(/^Senha nova/).fill("curta");
    await page.getByLabel(/^Repita a senha nova/).fill("curta");
    await page.getByRole("button", { name: "Trocar a senha" }).click();

    // `exact` de propósito: sem ele o texto do aviso e o do erro casariam com
    // o mesmo seletor, e o teste quebraria por ambiguidade em vez de por falha.
    await expect(
      page.getByText("A senha precisa ter pelo menos 8 caracteres.", { exact: true }),
    ).toBeVisible();
  });

  test("token recusado pelo servidor vira recado com o caminho de volta", async ({ page }) => {
    await page.goto("/redefinir-senha?token=token-que-nao-existe");

    await page.getByLabel(/^Senha nova/).fill("senha-boa-1234");
    await page.getByLabel(/^Repita a senha nova/).fill("senha-boa-1234");
    await page.getByRole("button", { name: "Trocar a senha" }).click();

    await expect(page.getByText(/já foi usado ou passou de 1 hora/)).toBeVisible();
  });
});
