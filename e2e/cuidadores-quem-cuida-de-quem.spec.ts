import { test, expect } from "@playwright/test";
import { criarConta, criarPaciente, entrar, tokenDaConta, type ContaDeTeste } from "./apoio";

/**
 * `/cuidadores` diz quem cuida de quem — Issue #121.
 *
 * ── O que o fundador notou ────────────────────────────────────────────────
 *
 * *"A mensagem apresentada é 'Quem cuida com você', o que sugere que estamos
 * todos na mesma família. Mas e para uma empresa? Ela tem vários cuidadores,
 * cada cuidador cuida de um paciente específico."*
 *
 * ── O que este teste prova ────────────────────────────────────────────────
 *
 * 1. O título não afirma mais círculo único.
 * 2. Sem vínculo, o cartão **diz isso** em vez de calar — "não sei de quem
 *    essa pessoa cuida" e "essa pessoa não cuida de ninguém" são respostas
 *    diferentes, e só a segunda é acionável.
 * 3. Com vínculo, o cartão nomeia os pacientes, e o nome leva à ficha.
 */

let conta: ContaDeTeste;
let pacienteId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  pacienteId = await criarPaciente(request, conta);
});

test.describe("Quem cuida aqui", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("o título não afirma mais que todos estão na mesma família", async ({ page }) => {
    await page.goto("/cuidadores");
    await expect(page.getByRole("heading", { name: "Quem cuida aqui" })).toBeVisible({
      timeout: 15_000,
    });
    await expect(page.getByText("Quem cuida com você")).toHaveCount(0);
  });

  test("sem vínculo, o cartão diz que ainda não é responsável por ninguém", async ({ page }) => {
    await page.goto("/cuidadores");
    await expect(page.getByRole("heading", { name: "Quem cuida aqui" })).toBeVisible({
      timeout: 15_000,
    });

    // Calar aqui faria a tela parecer que a informação não existe. Ela existe:
    // é "ninguém".
    await expect(page.getByText("Ainda não é responsável por ninguém")).toBeVisible();
  });

  test("com vínculo, o cartão nomeia o paciente e o nome leva à ficha", async ({ page, request }) => {
    // Vincula pela API: o caminho da tela é da #120 e já tem teste próprio.
    const token = await tokenDaConta(request, conta);
    const eu = await request.get("/api/account/me", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const caregiverId = ((await eu.json()) as { caregiver: { id: number } }).caregiver.id;

    const vinculo = await request.post(`/api/patients/${pacienteId}/caregivers`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { caregiverId },
    });
    expect(vinculo.status(), await vinculo.text()).toBe(201);

    await page.goto("/cuidadores");

    const nome = page.locator(`a[href="/pacientes/${pacienteId}"]`).first();
    await expect(nome).toBeVisible({ timeout: 15_000 });
    await expect(page.getByText(/Responsável por/)).toBeVisible();

    await nome.click();
    await expect(page).toHaveURL(new RegExp(`/pacientes/${pacienteId}$`));
  });
});
