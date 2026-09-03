import { expect, test } from "@playwright/test";

/**
 * Onde o e-mail aterrissa — Issues #73 e #77.
 *
 * ── O que estava quebrado (#73) ───────────────────────────────────────────
 *
 * `App.tsx` deixa poucos caminhos fora do portão de autenticação. **Qualquer
 * outro**, sem sessão, cai em `<AuthPage />` — a tela de login, que ignora a
 * query string inteira. Então `/verificar-email` e `/redefinir-senha` levavam a
 * pessoa a um formulário de login que ela ainda não podia usar, porque entrar
 * exige e-mail confirmado. Beco sem saída perfeito, e sem tráfego enquanto
 * e-mail nenhum saía.
 *
 * ── O que mudou depois (#77) ──────────────────────────────────────────────
 *
 * A confirmação deixou de ser link e virou **código de 6 dígitos**. A tela
 * `/verificar-email` continua existindo e continua fora do portão — mas agora
 * pede o código em vez de ler um token da URL.
 *
 * ── O que este arquivo NÃO alcança ────────────────────────────────────────
 *
 * O caminho feliz, ponta a ponta. Em desenvolvimento o cadastro auto-verifica a
 * conta e o servidor responde `precisaDeCodigo: false` — não há código para
 * digitar, e a suíte roda em desenvolvimento. Quem cobre o comportamento do
 * código é `src/tests/verificacao-por-codigo.test.ts`, contra o banco.
 *
 * O que **só** daqui se enxerga é que estas telas existem, abrem sem sessão e
 * não caem no login.
 */

/**
 * Como saber que caímos na tela de login.
 *
 * A aba "Entrar" (`role="tab"`) existe só no `AuthPage`. O título do cartão NÃO
 * serve: `CardTitle` renderiza uma `<div>`, então procurar por um heading daria
 * zero em qualquer página — a asserção passaria sempre, provando nada. O caso
 * de controle logo abaixo é o que garante que este seletor acha o login quando
 * o login está mesmo na tela.
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

test.describe("Tela do código de confirmação", () => {
  const CAMPO_DO_CODIGO = 'input[autocomplete="one-time-code"]';

  test("abre sem sessão — e não é a tela de login", async ({ page }) => {
    await page.goto("/verificar-email");

    await expect(page.getByText("Confirmação de e-mail", { exact: true })).toBeVisible();
    await expect(
      page.getByRole(ABA_DE_LOGIN.role, { name: ABA_DE_LOGIN.name }),
      "cair no login era o defeito da #73",
    ).toHaveCount(0);

    await expect(page.locator(CAMPO_DO_CODIGO)).toBeAttached();
  });

  test("diz o prazo antes de a pessoa perder tempo digitando", async ({ page }) => {
    await page.goto("/verificar-email");
    await expect(page.getByText(/vale 10 minutos/)).toBeVisible();
  });

  test("o botão só acende com os 6 dígitos", async ({ page }) => {
    await page.goto("/verificar-email");

    const confirmar = page.getByRole("button", { name: "Confirmar" });
    await expect(confirmar, "sem código não há o que confirmar").toBeDisabled();

    await page.locator(CAMPO_DO_CODIGO).fill("4829");
    await expect(confirmar, "quatro dígitos ainda não é um código").toBeDisabled();
  });

  test("colar o código inteiro preenche as seis casas", async ({ page }) => {
    await page.goto("/verificar-email");

    // Requisito explícito do fundador: "quero poder copiar e colar o código".
    // `fill` entrega o valor de uma vez, que é o que colar faz.
    await page.locator(CAMPO_DO_CODIGO).fill("482915");

    await expect(page.getByText("Pode colar o código inteiro de uma vez.")).toBeVisible();
    await expect(page.locator(CAMPO_DO_CODIGO)).toHaveValue("482915");
  });

  test("código errado devolve recado — e a mesma resposta para tudo", async ({ page }) => {
    await page.goto("/verificar-email");

    await page.getByLabel(/^E-mail do cadastro/).fill("ninguem-aqui@zelo.test");
    // Com os seis dígitos o envio dispara sozinho: colar o código e ainda ter
    // que procurar um botão é um passo sem função.
    await page.locator(CAMPO_DO_CODIGO).fill("000000");

    await expect(page.getByText(/Código inválido ou expirado/)).toBeVisible();
  });

  test("sem e-mail preenchido, avisa em vez de mandar pedido vazio", async ({ page }) => {
    await page.goto("/verificar-email");

    await page.locator(CAMPO_DO_CODIGO).fill("482915");

    await expect(page.getByText("Digite o e-mail que você usou no cadastro.")).toBeVisible();
  });

  // ── Reenvio — Issue #75 ─────────────────────────────────────────────────

  test("o reenvio nasce em espera, com o tempo à vista", async ({ page }) => {
    await page.goto("/verificar-email");

    // Quem chega aqui ACABOU de receber um código. Botão já aceso convidaria a
    // gastar emissão à toa — e o servidor só concede cinco por hora.
    const botao = page.getByRole("button", { name: /Enviar de novo em \d+s/ });
    await expect(botao).toBeVisible();
    await expect(botao).toBeDisabled();
  });

  test("a espera anda — não é um botão morto", async ({ page }) => {
    await page.goto("/verificar-email");

    const botao = page.getByRole("button", { name: /Enviar de novo em \d+s/ });
    const primeiro = await botao.textContent();

    // Mostrar um número parado seria pior que não mostrar nada: a pessoa não
    // saberia se o app travou.
    await expect
      .poll(async () => (await botao.textContent()) !== primeiro, { timeout: 5000 })
      .toBe(true);
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

    // `exact` de propósito: sem ele o texto do aviso e o do erro casariam com o
    // mesmo seletor, e o teste quebraria por ambiguidade em vez de por falha.
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
