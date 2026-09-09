import { test, expect, type APIRequestContext } from "@playwright/test";
import { criarConta, criarPaciente, entrar, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * Paciente sem cuidador em `/pacientes` — Issue #122.
 *
 * ── O que este teste prova, pela TELA ─────────────────────────────────────
 *
 *   1. quem está descoberto aparece marcado, e a marca é ÂMBAR, não vermelha
 *      (invariante 5 — e este é o caso que mede a cor de verdade, canal a
 *      canal, em vez de conferir o nome de uma classe)
 *   2. quem tem responsável mostra o nome de quem responde por ele
 *   3. o filtro deixa só os descobertos
 *   4. o filtro **some** quando não sobra ninguém descoberto — nada de botão
 *      que só devolve tela vazia
 *   5. paciente descoberto continua abrindo por inteiro: "sem cuidador" é
 *      pendência, nunca bloqueio
 *
 * Cada caso monta a própria conta. Eles mudam o vínculo, e um caso que
 * depende do estado deixado pelo anterior falha na primeira reexecução — que
 * é justamente quando ninguém está olhando.
 */

interface Cenario {
  conta: ContaDeTeste;
  maria: number;
  joao: number;
  cuidadorId: number;
  token: string;
}

async function cenario(request: APIRequestContext): Promise<Cenario> {
  const conta = await criarConta(request);
  const maria = await criarPaciente(request, conta, "Dona Maria Teste");
  const joao = await criarPaciente(request, conta, "Seu João Teste");
  const token = await tokenDaConta(request, conta);

  const res = await request.get("/api/caregivers", {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  const cuidadores = (await res.json()) as Array<{ id: number }>;

  return { conta, maria, joao, cuidadorId: cuidadores[0].id, token };
}

async function vincular(request: APIRequestContext, c: Cenario, patientId: number) {
  const res = await request.post(`/api/patients/${patientId}/caregivers`, {
    headers: { Authorization: `Bearer ${c.token}` },
    data: { caregiverId: c.cuidadorId },
  });
  expect(res.status()).toBe(201);
}

const descobertos = 'a[data-descoberto="sim"]';
const cobertos = 'a[data-descoberto="nao"]';

test.describe("Paciente sem cuidador", () => {
  test("os dois começam descobertos, e a marca é âmbar e não vermelha", async ({
    page,
    request,
  }) => {
    const c = await cenario(request);
    await entrar(page, c.conta);
    await page.goto("/pacientes");

    await expect(page.locator(descobertos)).toHaveCount(2);
    await expect(page.getByText("Ninguém é responsável ainda").first()).toBeVisible();

    /**
     * A cor, medida — invariante 5.
     *
     * Conferir o nome da classe provaria só que a classe está lá. O que a
     * regra proíbe é a COR, então é a cor computada que este caso lê.
     *
     * `--color-zelo-amber-fg` é `hsl(38 82% 35%)`, que dá algo perto de
     * rgb(163 111 16): tem verde no meio. Vermelho não tem — em qualquer
     * tom de vermelho o verde desaba junto com o azul. As duas asserções
     * abaixo separam as duas famílias sem depender do tom exato.
     */
    const aviso = page.getByText("Ninguém é responsável ainda").first();
    const cor = await aviso.evaluate((el) => getComputedStyle(el).color);
    const [r, g, b] = (cor.match(/\d+(\.\d+)?/g) ?? []).slice(0, 3).map(Number);

    expect(g, `cor lida: ${cor}`).toBeGreaterThan(b);
    expect(g / r, `cor lida: ${cor}`).toBeGreaterThan(0.35);
  });

  test("com responsável, a linha diz quem responde pelo paciente", async ({ page, request }) => {
    const c = await cenario(request);
    await vincular(request, c, c.maria);

    await entrar(page, c.conta);
    await page.goto("/pacientes");

    await expect(page.locator(cobertos)).toHaveCount(1);
    await expect(page.locator(cobertos)).toContainText("Responsável:");

    // O nome aparece encurtado, como todo nome de gente nesta tela (#88), e o
    // completo continua no `title` — encurtar não pode perder informação, e
    // com dois ou três responsáveis emendados é onde a linha estouraria.
    await expect(
      page.locator(cobertos).locator(`[title="${c.conta.nome}"]`),
    ).toBeVisible();
    await expect(page.locator(descobertos)).toHaveCount(1);
  });

  test("o filtro deixa só os descobertos", async ({ page, request }) => {
    const c = await cenario(request);
    await vincular(request, c, c.maria);

    await entrar(page, c.conta);
    await page.goto("/pacientes");

    const filtro = page.getByRole("button", { name: /Sem cuidador/ });
    await expect(filtro).toBeVisible();
    // O número conta PACIENTES a quem falta algo, e não a produção de
    // ninguém — a razão inteira está escrita em `PatientsPage.tsx`.
    await expect(filtro).toHaveText(/Sem cuidador \(1\)/);

    await filtro.click();

    await expect(page.locator("a[data-descoberto]")).toHaveCount(1);
    await expect(page.locator(descobertos)).toContainText("Seu João Teste");
    await expect(page.locator("main").getByText("Dona Maria Teste")).toHaveCount(0);
  });

  test("o filtro some quando não sobra ninguém descoberto", async ({ page, request }) => {
    const c = await cenario(request);
    await vincular(request, c, c.maria);
    await vincular(request, c, c.joao);

    await entrar(page, c.conta);
    await page.goto("/pacientes");

    await expect(page.locator(cobertos)).toHaveCount(2);
    // Botão que só devolveria lista vazia não fica na tela.
    await expect(page.getByRole("button", { name: /Sem cuidador/ })).toHaveCount(0);
  });

  test("paciente descoberto continua abrindo — pendência não é bloqueio", async ({
    page,
    request,
  }) => {
    const c = await cenario(request);
    await entrar(page, c.conta);
    await page.goto("/pacientes");

    await page.locator(descobertos).first().click();

    // A ficha abre inteira. Se algum dia "sem cuidador" virar restrição de
    // acesso, este caso cai antes de chegar ao `main`.
    await expect(page.getByRole("heading", { level: 2, name: /Dona Maria Teste/ })).toBeVisible({
      timeout: 15_000,
    });
  });
});
