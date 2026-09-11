import { test, expect, type APIRequestContext } from "@playwright/test";
import { criarConta, entrar, criarPaciente, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * A dose de madrugada aparece na noite anterior — Issue #154.
 *
 * ── Por que este arquivo existe ───────────────────────────────────────────
 *
 * O teste de servidor (`madrugada.test.ts`) prova que a API devolve a lista
 * na hora certa. Ele não alcança três coisas do aceite, que só existem na
 * tela: o rótulo dizer **"Amanhã"**, a seção **não** oferecer botão de
 * registrar, e a tela **não** convidar a cadastrar o primeiro tratamento
 * numa noite em que o tratamento existe e só tem dose às 03:00.
 *
 * ── Por que o fuso do PACIENTE, e não o relógio do servidor ───────────────
 *
 * A seção aparece depois das 18:00 no relógio do paciente. Congelar o relógio
 * do servidor está descartado por escrito em `apoio.ts` — é estado global de
 * um processo compartilhado por mais de cem testes, e vazaria congelado se um
 * deles quebrasse no meio.
 *
 * Então o teste não mexe no tempo: ele **escolhe onde o paciente mora**. Em
 * algum lugar do mundo já é noite, sempre, e é lá que a Dona Maria Teste
 * deste arquivo vive hoje.
 */

/**
 * Os fusos `Etc/GMT±N` têm o sinal **invertido** por herança do POSIX:
 * `Etc/GMT+5` é UTC−5. Nenhuma conta aqui depende disso — a hora local de
 * cada candidato é medida, não deduzida —, mas quem ler a lista precisa
 * saber, senão ela parece errada.
 *
 * A faixa é a real do banco de fusos: de UTC−12 (`Etc/GMT+12`) a UTC+14
 * (`Etc/GMT-14`). Eles não têm horário de verão, o que é exatamente o que se
 * quer aqui: um deslocamento que não muda no meio do teste.
 */
const DESLOCAMENTOS = [
  -12, -11, -10, -9, -8, -7, -6, -5, -4, -3, -2, -1,
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14,
];

function horaLocal(fuso: string): number | null {
  try {
    return Number(
      new Intl.DateTimeFormat("en-GB", { timeZone: fuso, hour: "2-digit", hourCycle: "h23" })
        .format(new Date()),
    );
  } catch {
    return null; // fuso que este runtime não conhece: simplesmente não é candidato
  }
}

function hojeEm(fuso: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: fuso, year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
}

/**
 * Um fuso onde agora são entre 18:00 e 22:59.
 *
 * ── Por que o teto é 22, e não 23 ────────────────────────────────────────
 *
 * Às 23:xx o dia civil do paciente pode virar no meio do teste, e "amanhã"
 * passaria a ser outro dia. Parando às 22:59 sobra mais de uma hora de folga.
 *
 * A busca não pode falhar: são 26 deslocamentos consecutivos e a janela tem
 * cinco horas, então há sempre pelo menos cinco candidatos. O `expect` existe
 * para o caso de um runtime sem banco de fusos completo — que falharia aqui,
 * com esta frase, em vez de num `expect` de tela sem relação nenhuma.
 */
function fusoOndeJaEhNoite(): string {
  const fusos = DESLOCAMENTOS.map((h) => `Etc/GMT${h > 0 ? "-" : "+"}${Math.abs(h)}`);
  const achado = fusos.find((f) => {
    const hora = horaLocal(f);
    return hora !== null && hora >= 18 && hora <= 22;
  });

  expect(
    achado,
    "nenhum fuso entre 18:00 e 22:59 — só acontece se este runtime não tiver " +
      "o banco de fusos completo (Node com ICU pequeno)",
  ).toBeTruthy();

  return achado!;
}

/** Um tratamento cuja única dose do dia é às 03:00 — já passada hoje, então a próxima é amanhã. */
async function criarTratamentoSoDeMadrugada(
  request: APIRequestContext,
  conta: ContaDeTeste,
  patientId: number,
  fuso: string,
): Promise<void> {
  const token = await tokenDaConta(request, conta);
  const cabecalho = { Authorization: `Bearer ${token}` };

  const med = await request.post("/api/medications", {
    headers: cabecalho,
    data: { name: "Remedio Ficticio Madrugada (ficticio)", form: "tablet" },
  });
  expect(med.status(), `criar medicamento falhou: ${await med.text()}`).toBe(201);

  const tratamento = await request.post(`/api/patients/${patientId}/treatments`, {
    headers: cabecalho,
    data: {
      medicationId: ((await med.json()) as { id: number }).id,
      dose: "1 comprimido",
      scheduleConfig: { scheduleType: "times_per_day", times: ["03:00"] },
      startDate: hojeEm(fuso),
    },
  });
  expect(tratamento.status(), `criar tratamento falhou: ${await tratamento.text()}`).toBe(201);

  // Pré-condição, e não asserção do teste: se a API não devolver a dose, o
  // problema é de geração ou de fuso, e a falha tem que dizer isso — não
  // aparecer como "a tela não mostrou a seção".
  const hoje = await request.get(`/api/patients/${patientId}/today-doses`, { headers: cabecalho });
  const corpo = (await hoje.json()) as { madrugada: Array<{ scheduledLocalTime: string }> };
  expect(
    corpo.madrugada.map((d) => d.scheduledLocalTime),
    `a API precisa trazer a dose das 03:00 de amanhã (paciente em ${fuso}, ` +
      `onde agora são ${horaLocal(fuso)}h)`,
  ).toEqual(["03:00"]);
}

test.describe("A madrugada seguinte", () => {
  let conta: ContaDeTeste;
  let patientId: number;

  test.beforeAll(async ({ request }) => {
    const fuso = fusoOndeJaEhNoite();
    conta = await criarConta(request);
    patientId = await criarPaciente(request, conta, "Dona Maria Teste", fuso);
    await criarTratamentoSoDeMadrugada(request, conta, patientId, fuso);
  });

  test("a tela mostra a dose das 03:00 dizendo que é amanhã", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");

    await expect(
      page.getByRole("heading", { name: "Madrugada" }),
      "às 20:00 no relógio do paciente, quem vai dormir precisa ver que há remédio às 03:00",
    ).toBeVisible({ timeout: 15_000 });

    // O dia no rótulo é o pedido do fundador. Sem ele a linha diria "03:00" e
    // seria lida como hoje — que é o defeito ao contrário.
    await expect(
      page.getByText("Amanhã, 03:00"),
      "a dose de madrugada precisa dizer que é de amanhã",
    ).toBeVisible();
  });

  test("nada nessa seção registra dose que ainda não chegou", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Madrugada" })).toBeVisible({ timeout: 15_000 });

    // Este paciente não tem NENHUMA dose hoje — a única é às 03:00 de amanhã.
    // Então qualquer botão de registro na tela só pode ter vindo da seção
    // nova, e ela é aviso, não ação (a #134 é quem trata de antecipação).
    await expect(
      page.getByRole("button", { name: /Registrar|Pular/ }),
      "a madrugada é aviso: registrar dose que nem chegou é assunto da #134",
    ).toHaveCount(0);
  });

  test("não convida a cadastrar tratamento quando já existe um", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Madrugada" })).toBeVisible({ timeout: 15_000 });

    // `doses` chega vazio nesta noite — a dose é dia civil de amanhã. A tela
    // vazia olhava só para ela, e convidaria a cadastrar o primeiro
    // tratamento logo abaixo da seção que mostra o tratamento que existe.
    await expect(
      page.getByText("Nenhum tratamento ativo"),
      "há tratamento ativo: a prova é a dose das 03:00 logo acima",
    ).toHaveCount(0);
  });
});
