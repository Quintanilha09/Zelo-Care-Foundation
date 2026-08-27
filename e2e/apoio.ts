import type { Page, APIRequestContext } from "@playwright/test";
import { expect } from "@playwright/test";

/**
 * Apoio para os testes de ponta a ponta — Issue #7.
 *
 * ── Conta criada pela API, sessão aberta pela TELA ────────────────────────
 *
 * Criar a conta pela interface em todo teste custaria segundos por caso e
 * quebraria por motivos que nada têm a ver com o que está sendo testado.
 * A conta nasce pela API; o login acontece pela tela, porque o login **é**
 * parte do que precisa funcionar.
 *
 * ── Dado fictício óbvio ───────────────────────────────────────────────────
 *
 * Invariante 7 do produto: dado de teste tem que gritar que é de teste.
 * Nomes daqui saem como "Ana Fictícia E2E" e "Dona Maria Teste" — se algum
 * vazar para um banco de verdade, ninguém confunde com pessoa real.
 */

/** Sufixo único por execução. Dois testes nunca disputam o mesmo e-mail. */
function marca(): string {
  return `${Date.now()}${Math.floor(Math.random() * 1000)}`;
}

export interface ContaDeTeste {
  email: string;
  senha: string;
  nome: string;
  familia: string;
}

/**
 * Cria uma conta de cuidador principal pela API.
 *
 * Em desenvolvimento o cadastro não exige verificação de e-mail — é o que
 * `allowsDevelopmentShortcuts()` libera. Em produção esta chamada exigiria
 * provedor de e-mail configurado e responderia 503, que é o comportamento
 * correto lá.
 */
export async function criarConta(request: APIRequestContext): Promise<ContaDeTeste> {
  const m = marca();
  const conta: ContaDeTeste = {
    email: `e2e-${m}@zelo.test`,
    senha: "senha-de-teste-123",
    nome: "Ana Fictícia E2E",
    familia: "Família Fictícia E2E",
  };

  const res = await request.post("/api/auth/register", {
    data: {
      name: conta.nome,
      email: conta.email,
      password: conta.senha,
      consentTerms: true,
      consentHealthData: true,
      consentRepresentative: "legal_representative",
      familyName: conta.familia,
    },
  });

  // Mensagem explícita: se o cadastro quebrar, o teste seguinte falharia num
  // ponto distante e confuso.
  expect(
    res.ok(),
    `cadastro pela API falhou (${res.status()}): ${await res.text()}`
  ).toBeTruthy();

  return conta;
}

/** Entra pela TELA e espera a tela inicial aparecer. */
export async function entrar(page: Page, conta: ContaDeTeste): Promise<void> {
  await page.goto("/");
  await page.getByLabel(/E-mail/i).first().fill(conta.email);
  await page.getByLabel(/^Senha/i).first().fill(conta.senha);

  // `exact` é obrigatório aqui: existe uma ABA "Entrar" além do botão, e
  // /entrar/i casaria também com "Entrar com Google". Foi a primeira coisa
  // que este teste pegou — do próprio teste, não do app.
  await page.getByRole("button", { name: "Entrar", exact: true }).click();

  // O sinal de que entrou é o link do cabeçalho, buscado por HREF e não por
  // texto: o rótulo "Pacientes" tem `hidden sm:inline`, some no celular, e um
  // seletor por texto passaria no desktop e falharia no telefone.
  await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible({
    timeout: 15_000,
  });
}

/**
 * Um access token novo, numa sessão de API separada da do navegador.
 *
 * **Nunca leia o token do `localStorage` do app para reaproveitar aqui.** Ver
 * o aviso longo em `criarPaciente`: `POST /auth/refresh` rotaciona o par, e
 * mexer nele pelo teste derruba a sessão da tela sem dar erro nenhum.
 */
export async function tokenDaConta(
  request: APIRequestContext,
  conta: ContaDeTeste
): Promise<string> {
  const login = await request.post("/api/auth/login", {
    data: { email: conta.email, password: conta.senha },
  });
  expect(login.ok(), `login pela API falhou: ${await login.text()}`).toBeTruthy();
  return ((await login.json()) as { accessToken: string }).accessToken;
}

/**
 * Cria um paciente pela API, **sem encostar na sessão do navegador**.
 *
 * ── O erro que custou meia hora, registrado ───────────────────────────────
 *
 * A primeira versão lia o refresh token do `localStorage` do app e chamava
 * `POST /auth/refresh` para obter um access token. Parecia esperto e
 * **derrubava a sessão do próprio teste**: a rota rotaciona o par de tokens,
 * então o valor que o app tinha guardado virava lixo no instante seguinte.
 *
 * O sintoma era enganoso — o paciente era criado com sucesso (201) e depois
 * simplesmente não aparecia em tela nenhuma, porque o app tinha perdido a
 * sessão sem avisar.
 *
 * Agora o login acontece numa sessão de API **separada**, que não compartilha
 * nada com o navegador.
 */
export async function criarPaciente(
  request: APIRequestContext,
  conta: ContaDeTeste,
  nome = "Dona Maria Teste"
): Promise<number> {
  const accessToken = await tokenDaConta(request, conta);

  const res = await request.post("/api/patients", {
    headers: { Authorization: `Bearer ${accessToken}` },
    data: {
      name: nome,
      timezone: "America/Sao_Paulo",
      healthConsent: { givenBy: "legal_representative", version: "v1.0" },
    },
  });

  expect(
    res.status(),
    `criar paciente falhou: ${await res.text()}`
  ).toBe(201);

  return ((await res.json()) as { id: number }).id;
}

/**
 * Confere que a página não rola na horizontal.
 *
 * Três dos defeitos relatados pelo fundador eram disso: conteúdo mais largo
 * que a tela. Num celular, isso é a diferença entre usar e não usar.
 */
export async function naoRolaNaHorizontal(page: Page): Promise<void> {
  const estouro = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(estouro, "a página não pode rolar na horizontal").toBeLessThanOrEqual(1);
}
