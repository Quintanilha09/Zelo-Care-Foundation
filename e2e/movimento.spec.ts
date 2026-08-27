import { test, expect, type Page, type APIRequestContext } from "@playwright/test";
import { criarConta, entrar, criarPaciente, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * Esqueleto de carregamento em toda tela — Issue #5.
 *
 * ── Por que isto precisa de teste, e não de olhada ────────────────────────
 *
 * O esqueleto só existe durante o carregamento. Numa máquina rápida com banco
 * local ele dura 40ms — some antes de qualquer pessoa conseguir olhar. Foi
 * exatamente assim que cinco telas ficaram meses com `<p>Carregando…</p>` sem
 * ninguém notar: quem revisou nunca viu o estado que estava revisando.
 *
 * Aqui a resposta da API é **segurada de propósito**, então o estado fica
 * parado o tempo que o teste precisar. É a única forma honesta de afirmar
 * que a tela tem esqueleto.
 *
 * ── O que cada teste prova ────────────────────────────────────────────────
 *
 *   1. as cinco telas mostram esqueleto no formato do conteúdo, não texto
 *   2. o esqueleto se anuncia para leitor de tela (`aria-busy` + rótulo)
 *   3. **com movimento reduzido, o esqueleto continua VISÍVEL** — só para de
 *      se mexer. Sumir junto com a animação apagaria a informação "estou
 *      carregando" de quem já tem menos pistas na tela.
 */

let conta: ContaDeTeste;
let patientId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  patientId = await criarPaciente(request, conta);
});

/**
 * Segura a resposta de uma rota até o teste mandar soltar.
 *
 * `route.fetch()` acontece só depois da liberação, então o app fica com a
 * requisição pendente de verdade — não é um atraso simulado no cliente.
 */
function segurar(page: Page, padrao: string): { soltar: () => void } {
  let liberar: () => void = () => {};
  const portao = new Promise<void>((resolver) => {
    liberar = resolver;
  });

  void page.route(padrao, async (rota) => {
    await portao;
    await rota.continue();
  });

  return { soltar: () => liberar() };
}

/**
 * O contrato do esqueleto, igual em toda tela.
 *
 * `aria-busy` é o que um leitor de tela usa para anunciar que a região está
 * carregando — as barras cinzas são `aria-hidden`, então sem ele a pessoa
 * ouviria silêncio absoluto e não saberia se travou.
 */
async function esperaEsqueleto(page: Page, rotulo: RegExp): Promise<void> {
  const area = page.locator('[aria-busy="true"]').first();
  await expect(area, "a tela precisa marcar a região como carregando").toBeVisible({
    timeout: 15_000,
  });
  await expect(area.getByText(rotulo)).toBeAttached();
  await expect(
    area.locator(".zelo-esqueleto").first(),
    "o esqueleto precisa desenhar o formato do conteúdo, não escrever Carregando"
  ).toBeVisible();
}

test.describe("Toda tela que carrega mostra esqueleto", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("Pacientes", async ({ page }) => {
    const portao = segurar(page, "**/api/patients");
    await page.goto("/pacientes");
    await esperaEsqueleto(page, /Carregando os pacientes/i);

    portao.soltar();
    await expect(page.getByText(/Dona Maria Teste/).first()).toBeVisible({ timeout: 15_000 });
    // O esqueleto tem que SAIR quando o conteúdo chega. Esqueleto que fica é
    // pior que nenhum: a pessoa acha que a tela travou com dado na frente.
    await expect(page.locator('[aria-busy="true"]')).toHaveCount(0);
  });

  test("Ficha do paciente — tratamentos", async ({ page }) => {
    const portao = segurar(page, `**/api/patients/${patientId}/treatments`);
    await page.goto(`/pacientes/${patientId}`);
    await esperaEsqueleto(page, /Carregando os tratamentos/i);
    portao.soltar();
  });

  test("Consultas", async ({ page }) => {
    const portao = segurar(page, `**/api/patients/${patientId}/appointments`);
    await page.goto(`/pacientes/${patientId}/consultas`);
    await esperaEsqueleto(page, /Carregando as consultas/i);
    portao.soltar();
  });

  test("Cuidadores", async ({ page }) => {
    const portao = segurar(page, "**/api/caregivers");
    await page.goto("/cuidadores");
    await esperaEsqueleto(page, /Carregando quem cuida com você/i);
    portao.soltar();
  });

  test("Histórico — calendário de adesão", async ({ page }) => {
    const portao = segurar(page, "**/api/patients/*/adherence-calendar*");
    await page.goto(`/pacientes/${patientId}/historico`);
    await esperaEsqueleto(page, /Carregando o calendário de adesão/i);
    portao.soltar();
  });

  test("nenhuma das telas escreve Carregando…", async ({ page }) => {
    // O texto que o esqueleto substituiu. Se voltar em qualquer uma delas,
    // este teste conta qual.
    for (const caminho of [
      "/pacientes",
      `/pacientes/${patientId}`,
      `/pacientes/${patientId}/consultas`,
      "/cuidadores",
      `/pacientes/${patientId}/historico`,
    ]) {
      await page.goto(caminho);
      // Espera a tela assentar antes de medir: procurar por texto ausente
      // numa página em branco passa sem provar nada.
      await expect(page.locator('a[href="/pacientes"]').first()).toBeVisible();
      await expect(
        page.getByText("Carregando…", { exact: true }),
        `${caminho} voltou a usar texto no lugar do esqueleto`
      ).toHaveCount(0);
    }
  });
});

/**
 * PNG de 1×1 pixel, transparente.
 *
 * Serve porque o servidor valida o TIPO, não o conteúdo — e um arquivo de
 * verdade deixaria o teste dependendo de um binário guardado no repositório.
 */
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);

/** Consentimento de imagem + uma foto no mural, tudo pela API. */
async function publicarUmMomento(
  request: APIRequestContext,
  conta: ContaDeTeste,
  alvo: number
): Promise<void> {
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
}

test.describe("Apagar um momento sai animado", () => {
  test("o item some encolhendo, e só depois a lista fecha o buraco", async ({ page, request }) => {
    // Conta própria: este teste APAGA conteúdo, e um paciente compartilhado
    // com os outros casos viraria dependência de ordem de execução.
    const minhaConta = await criarConta(request);
    const meuPaciente = await criarPaciente(request, minhaConta);
    await publicarUmMomento(request, minhaConta, meuPaciente);

    await entrar(page, minhaConta);
    await page.goto(`/pacientes/${meuPaciente}`);

    const botaoApagar = page.getByRole("button", { name: "Apagar este momento" });
    await expect(botaoApagar, "o momento publicado precisa aparecer no mural").toBeVisible({
      timeout: 15_000,
    });

    // Segura o recarregamento do mural DEPOIS que ele já carregou uma vez.
    // É o que congela o instante interessante: a saída dura 120ms, curta
    // demais para ser observada sem isto — e um teste que corre atrás de
    // 120ms é um teste instável.
    const portao = segurar(page, `**/api/patients/${meuPaciente}/momentos`);

    await botaoApagar.click();
    await page.getByRole("button", { name: "Apagar", exact: true }).click();

    const saindo = page.locator("li.zelo-sai");
    await expect(saindo, "o item apagado precisa sair animado, não sumir seco").toHaveCount(1);
    await expect(saindo).toHaveCSS("animation-name", "zelo-saida");

    // A ordem importa: enquanto a lista nova não chega, o item continua ali,
    // já invisível. Se o `saindo` fosse limpo antes do recarregamento, ele
    // voltaria inteiro por um quadro — o pisco que a implementação evita.
    portao.soltar();
    await expect(page.getByRole("button", { name: "Apagar este momento" })).toHaveCount(0);
    await expect(page.locator("li.zelo-sai")).toHaveCount(0);
  });
});

test.describe("Movimento reduzido", () => {
  // Quem desligou movimento no sistema desligou por enjoo, sensibilidade
  // vestibular ou dificuldade de foco. Parte do público deste app tem
  // exatamente esses quadros.

  test("o esqueleto continua visível, só para de se mexer", async ({ page }) => {
    // ── Cuidado: `test.use({ reducedMotion: "reduce" })` NÃO funcionou aqui ──
    //
    // A forma documentada é a opção de fixture, e ela foi a primeira tentativa.
    // Nesta configuração (Playwright 1.62.1, projetos partindo de
    // `devices[...]`) a emulação simplesmente não chega à página:
    // `matchMedia("(prefers-reduced-motion: reduce)").matches` continuava
    // `false`, e o teste falhava acusando o CSS de estar errado quando o CSS
    // estava certo.
    //
    // `page.emulateMedia` aplica de fato — medido, não suposto. Se alguém
    // trocar de volta pela opção "mais limpa", este teste volta a mentir.
    await page.emulateMedia({ reducedMotion: "reduce" });

    await entrar(page, conta);
    const portao = segurar(page, "**/api/patients");
    await page.goto("/pacientes");

    const barra = page.locator(".zelo-esqueleto").first();
    await expect(barra, "o esqueleto não pode sumir com movimento reduzido").toBeVisible({
      timeout: 15_000,
    });

    const estilo = await barra.evaluate((el) => {
      const s = getComputedStyle(el);
      return {
        imagem: s.backgroundImage,
        cor: s.backgroundColor,
        duracao: s.animationDuration,
        emulado: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
      };
    });

    // Confere a própria emulação antes de julgar o CSS. Sem isto, uma
    // emulação que não pegou faria o teste acusar o app de um defeito que
    // é do teste — foi exatamente o que aconteceu na primeira versão.
    expect(estilo.emulado, "a emulação de movimento reduzido não chegou à página").toBe(true);

    // O brilho é um `linear-gradient` que atravessa a barra. Com movimento
    // reduzido ele é trocado por cor chapada — a barra fica lá, parada.
    expect(estilo.imagem, "o brilho tem que sumir com movimento reduzido").toBe("none");
    expect(
      estilo.cor,
      "sem o gradiente, a barra precisa de cor própria — senão vira um bloco invisível"
    ).not.toBe("rgba(0, 0, 0, 0)");

    // A animação de 1,6s não pode continuar rodando.
    expect(
      Number.parseFloat(estilo.duracao),
      "a animação precisa parar, não só ficar discreta"
    ).toBeLessThan(0.05);

    portao.soltar();
  });
});
