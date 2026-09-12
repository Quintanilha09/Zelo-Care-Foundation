import { test, expect, type Page } from "@playwright/test";
import { criarConta, entrar, criarPaciente, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * "Se precisar" na tela — Issue #169.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * Dipirona para dor, bombinha de resgate, remédio de enjoo. Os testes de
 * servidor já provam que o tipo não gera dose agendada, não entra na adesão e
 * sai em seção própria no relatório. O que só o navegador responde é se o
 * cuidador CONSEGUE registrar: o botão existe, a janela abre, o uso entra e a
 * contagem muda na frente dele.
 *
 * ── E o que a tela nunca pode dizer ──────────────────────────────────────
 *
 * O último teste é sobre o invariante 4. A tela mostra "a última foi às
 * 14:20" e "a receita diz a cada 6 h" — os dois são fato. Ela não pode juntar
 * os dois numa conclusão: "ainda não pode dar" é prescrição, e o botão nunca
 * fica desabilitado por causa disso.
 */

const REMEDIO = "Dipirona Ficticia (ficticio)";

async function criarSeNecessario(
  request: Parameters<typeof tokenDaConta>[0],
  conta: ContaDeTeste,
  patientId: number,
): Promise<number> {
  const token = await tokenDaConta(request, conta);
  const cabecalho = { Authorization: `Bearer ${token}` };

  const med = await request.post("/api/medications", {
    headers: cabecalho,
    data: { name: REMEDIO, form: "tablet" },
  });
  expect(med.status(), `criar medicamento falhou: ${await med.text()}`).toBe(201);
  const medicationId = ((await med.json()) as { id: number }).id;

  const hoje = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());

  const res = await request.post(`/api/patients/${patientId}/treatments`, {
    headers: cabecalho,
    data: {
      medicationId,
      dose: "1 comprimido",
      scheduleConfig: { scheduleType: "se_necessario", intervaloMinimoHoras: 6, tetoDiario: 4 },
      startDate: hoje,
    },
  });
  expect(res.status(), `criar tratamento falhou: ${await res.text()}`).toBe(201);
  return ((await res.json()) as { id: number }).id;
}

/** A linha do remédio na seção "Se precisar". */
function linhaDoRemedio(page: Page) {
  return page.locator("div.rounded-lg").filter({ hasText: REMEDIO }).first();
}

test.describe("Registrar um se precisar", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  test.beforeAll(async ({ request }) => {
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta);
    await criarSeNecessario(request, conta, patientId);
  });

  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("a secao aparece na tela inicial mesmo sem uso nenhum", async ({ page }) => {
    await page.goto("/");

    // O botão É o caminho de registrar. Escondê-lo "até precisar" esconderia
    // justamente o momento em que se precisa.
    await expect(page.getByRole("heading", { name: "Se precisar" })).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(REMEDIO)).toBeVisible();
    await expect(page.getByText("Nenhuma vez registrada ainda")).toBeVisible();

    // E a receita fica à vista, do jeito que foi transcrita.
    await expect(page.getByText(/a cada 6 h · no máximo 4 por dia/)).toBeVisible();
  });

  test("registrar um uso muda a contagem na frente de quem cuida", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Se precisar" })).toBeVisible({ timeout: 15_000 });

    await linhaDoRemedio(page).getByRole("button", { name: "Dei" }).click();

    const janela = page.getByRole("dialog");
    await expect(janela).toBeVisible();
    await expect(janela.getByText(/Nenhuma vez registrada ainda/)).toBeVisible();

    // O horário já vem preenchido em "agora" — o caso de longe mais comum é
    // o cuidador acabar de dar.
    await expect(janela.locator("#uso-quando")).not.toHaveValue("");

    await janela.locator("#uso-motivo").fill("Dor de cabeça");
    await janela.getByRole("button", { name: "Registrar" }).click();

    await expect(janela).toBeHidden({ timeout: 15_000 });
    // A tela precisa mudar sozinha: sem isso, quem registrou não sabe se
    // entrou, e o reflexo é registrar de novo.
    await expect(page.getByText(/1 vez hoje/)).toBeVisible({ timeout: 15_000 });
  });

  test("o segundo uso no mesmo dia entra, e a tela nao julga", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Se precisar" })).toBeVisible({ timeout: 15_000 });

    const botao = linhaDoRemedio(page).getByRole("button", { name: "Dei" });
    // A receita diz "a cada 6 h", e o uso do teste anterior foi há segundos.
    // O botão continua clicável: o app REGISTRA, o médico interpreta.
    await expect(botao).toBeEnabled();
    await botao.click();

    const janela = page.getByRole("dialog");
    await expect(janela).toBeVisible();
    // O retrato aparece — e é só retrato.
    await expect(janela.getByText(/A última foi/)).toBeVisible();
    await expect(janela.getByText(/A receita diz: a cada 6 h/)).toBeVisible();

    // ── O invariante 4, medido na tela ──────────────────────────────────
    //
    // Nada aqui pode dizer se pode ou não pode dar. Mostrar "a última foi há
    // 2 h" é registro; "ainda não pode" é prescrição.
    const texto = (await janela.innerText()).toLowerCase();
    for (const proibido of ["ainda não pode", "aguarde", "limite atingido", "não é seguro", "excedeu"]) {
      expect(texto, `a janela não pode julgar: achei "${proibido}"`).not.toContain(proibido);
    }

    await janela.getByRole("button", { name: "Registrar" }).click();
    await expect(janela).toBeHidden({ timeout: 15_000 });
    await expect(page.getByText(/2 vezes hoje/)).toBeVisible({ timeout: 15_000 });
  });

  test("nao aparece no meio das doses do dia", async ({ page }) => {
    await page.goto(`/pacientes/${patientId}`);

    // A ficha também tem a seção, e ela vive FORA de "Hoje": um remédio sem
    // hora marcada no meio das doses pareceria tarefa pendente.
    await expect(page.getByRole("heading", { name: "Se precisar" })).toBeVisible({ timeout: 15_000 });

    const hoje = page.getByRole("heading", { name: "Hoje", exact: true });
    if (await hoje.count()) {
      // Se houver bloco "Hoje", a dipirona não pode estar dentro dele.
      const blocoDoDia = page.locator("div").filter({ has: hoje }).first();
      await expect(blocoDoDia.getByText(REMEDIO)).toHaveCount(0);
    }

    // E nunca âmbar: âmbar é dose pendente ou atrasada (invariante 5), e este
    // remédio nunca está nem uma coisa nem outra.
    await expect(linhaDoRemedio(page).locator(".text-zelo-amber-fg")).toHaveCount(0);
  });
});
