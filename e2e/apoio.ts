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
 * Fecha a sessão do NAVEGADOR, para poder entrar com outra conta.
 *
 * ── O erro que isto conserta ──────────────────────────────────────────────
 *
 * Um teste que compara duas contas na mesma `page` chama `entrar` duas vezes.
 * A segunda chamada fazia `goto("/")` **já autenticado** — o app abre direto
 * na tela inicial, o formulário de login não existe, e o `fill` do campo de
 * e-mail ficava esperando por um elemento que nunca ia aparecer. O teste
 * morria em timeout de 30s, com uma mensagem que não dizia nada sobre a causa.
 *
 * O access token vive só em memória; o refresh token, no `localStorage` (ver
 * `lib/auth-client.ts`). Limpar o armazenamento é o que de fato encerra a
 * sessão do lado do navegador.
 */
export async function sair(page: Page): Promise<void> {
  await page.goto("/");
  await page.evaluate(() => {
    localStorage.clear();
    sessionStorage.clear();
  });
  await page.context().clearCookies();
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

/**
 * PNG de 1×1 pixel, transparente.
 *
 * Serve porque o servidor valida o TIPO do arquivo, não o conteúdo — e um
 * arquivo de verdade deixaria o teste dependendo de um binário guardado no
 * repositório.
 */
export const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/**
 * Consentimento de imagem + uma foto no mural, tudo pela API.
 *
 * Devolve o id do momento publicado — a rota do coração precisa dele.
 */
export async function publicarUmMomento(
  request: APIRequestContext,
  conta: ContaDeTeste,
  alvo: number
): Promise<number> {
  const token = await tokenDaConta(request, conta);
  const cabecalho = { Authorization: `Bearer ${token}` };

  // Sem o consentimento de imagem a seção Momentos nem aparece — é o portão
  // da QUI-6, e ele é separado do consentimento de dado de saúde de propósito.
  const consentimento = await request.post(`/api/patients/${alvo}/image-consent`, {
    headers: cabecalho,
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(
    consentimento.ok(),
    `consentimento de imagem falhou: ${await consentimento.text()}`
  ).toBeTruthy();

  const envio = await request.post("/api/media", {
    headers: cabecalho,
    multipart: {
      patientId: String(alvo),
      arquivo: { name: "momento.png", mimeType: "image/png", buffer: PNG_1X1 },
    },
  });
  expect(envio.status(), `publicar momento falhou: ${await envio.text()}`).toBe(201);
  return ((await envio.json()) as { id: number }).id;
}

/**
 * Abre o primeiro momento da grade no visualizador — QUI-18.
 *
 * O mural virou grade: coração, marcador e apagar deixaram de estar embaixo
 * de cada foto e passaram a viver no visualizador, que abre ao tocar numa
 * miniatura. Os testes que agem sobre um momento precisam abrir antes.
 *
 * Localizado pelo rótulo do botão da miniatura, e não por posição: é o que o
 * leitor de tela anuncia, então se ele quebrar o teste quebra junto — que é
 * o comportamento desejado.
 */
export async function abrirPrimeiroMomento(page: Page): Promise<void> {
  const miniatura = page.getByRole("button", { name: /^Abrir (a foto|o recado) de / }).first();
  await expect(
    miniatura,
    "o momento publicado precisa aparecer na grade do mural"
  ).toBeVisible({ timeout: 15_000 });
  await miniatura.click();
  await expect(page.getByRole("dialog")).toBeVisible();
}

/**
 * Um tratamento com dose HOJE, ainda sem nenhum registro — Issue #26, QUI-16.
 *
 * ── Por que os horários são "00:01" e "23:59" ─────────────────────────────
 *
 * `generateDosesForTreatment` só cria dose **do agora para a frente** — a
 * janela começa em `Clock.now()`. Um horário já passado hoje simplesmente
 * não gera nada, e a primeira versão deste auxiliar falhou por isso.
 *
 * Com os dois horários há sempre ao menos uma dose futura dentro do dia
 * civil do paciente, a qualquer hora — **exceto no último minuto do dia**,
 * a mesma janela que a suíte de servidor aceita desde sempre.
 *
 * `sufixo` existe porque o plano Grátis cuida de **3 medicamentos**: um teste
 * que precisa de dois tratamentos precisa de dois nomes distintos.
 */
export async function criarTratamentoHoje(
  request: APIRequestContext,
  conta: ContaDeTeste,
  alvo: number,
  sufixo = ""
): Promise<{ tratamentoId: number; medicamento: string; doseId: number; horaAgendada: string }> {
  const token = await tokenDaConta(request, conta);
  const cabecalho = { Authorization: `Bearer ${token}` };
  const medicamento = `Remedio Ficticio${sufixo ? ` ${sufixo}` : ""} (ficticio)`;

  const med = await request.post("/api/medications", {
    headers: cabecalho,
    data: { name: medicamento, form: "tablet" },
  });
  expect(med.status(), `criar medicamento falhou: ${await med.text()}`).toBe(201);
  const medicationId = ((await med.json()) as { id: number }).id;

  // A data tem que ser HOJE no fuso do paciente, não no do processo.
  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const tratamento = await request.post(`/api/patients/${alvo}/treatments`, {
    headers: cabecalho,
    data: {
      medicationId,
      dose: "1 comprimido",
      scheduleConfig: { scheduleType: "times_per_day", times: ["00:01", "23:59"] },
      startDate: hoje,
    },
  });
  expect(tratamento.status(), `criar tratamento falhou: ${await tratamento.text()}`).toBe(201);
  const tratamentoId = ((await tratamento.json()) as { id: number }).id;

  const hojeRes = await request.get(`/api/patients/${alvo}/today-doses`, { headers: cabecalho });
  expect(hojeRes.ok(), `today-doses falhou: ${await hojeRes.text()}`).toBeTruthy();
  const corpo = (await hojeRes.json()) as {
    doses: Array<{ id: number; treatmentId: number; scheduledLocalTime: string }>;
  };
  const dose = corpo.doses.find((d) => d.treatmentId === tratamentoId);
  expect(
    dose,
    "o tratamento precisa ter gerado ao menos uma dose hoje — se isto falhar, " +
      "confira se a geração só cria dose futura (lib/dose-generation.ts) e se " +
      "não são 23:59 em São Paulo"
  ).toBeTruthy();

  return { tratamentoId, medicamento, doseId: dose!.id, horaAgendada: dose!.scheduledLocalTime };
}

/**
 * O mesmo tratamento acima, com a primeira dose **já registrada** — Issue #26.
 *
 * Existe para os testes que precisam de uma dose **já resolvida** na tela.
 * Sem isto não dá para provar nada sobre o cartão de dose tomada: a ficha
 * recém-criada só tem dose pendente.
 */
export async function registrarUmaDoseHoje(
  request: APIRequestContext,
  conta: ContaDeTeste,
  alvo: number,
  desfecho: "taken" | "skipped" = "taken"
): Promise<{ medicamento: string; horaAgendada: string }> {
  const token = await tokenDaConta(request, conta);
  const { medicamento, doseId, horaAgendada } = await criarTratamentoHoje(request, conta, alvo);

  const registro = await request.post(`/api/patients/${alvo}/dose-records`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { scheduledDoseId: doseId, outcome: desfecho },
  });
  expect(registro.ok(), `registrar dose falhou: ${await registro.text()}`).toBeTruthy();

  return { medicamento, horaAgendada };
}
