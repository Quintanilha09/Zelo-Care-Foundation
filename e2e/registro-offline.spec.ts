import { test, expect } from "@playwright/test";
import { criarConta, criarPaciente, criarTratamentoHoje, entrar, type ContaDeTeste } from "./apoio";

/**
 * Registrar dose sem internet — Issue #167.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A FILA EXISTIA, E SÓ RECEBIA OS BOTÕES DA NOTIFICAÇÃO.
 *
 * Pelo app, offline, o toque se perdia — e a tela inicial chegava a mostrar
 * "Sem conexão" enquanto oferecia o botão que ia falhar.
 *
 * O momento de dar remédio é, com frequência, o pior momento de sinal:
 * quarto nos fundos, elevador, hospital, casa de campo. A promessa do
 * produto — *a ação do cuidador nunca se perde* — valia para a notificação e
 * não valia para a tela.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Só o navegador prova isto ─────────────────────────────────────────────
 *
 * Nenhum teste de servidor alcança: do lado de lá não existe "offline", só
 * um pedido que nunca chegou. Quem tem `setOffline` é o Playwright, e é por
 * isso que este arquivo existe.
 */
test.describe("Registrar sem internet", () => {
  let conta: ContaDeTeste;
  let pacienteId: number;

  test.beforeEach(async ({ request }) => {
    conta = await criarConta(request);
    pacienteId = await criarPaciente(request, conta);
    await criarTratamentoHoje(request, conta, pacienteId);
  });

  test("a dose entra na fila, e a tela diz a verdade sobre isso", async ({ page, context }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });

    const registrar = page.getByRole("button", { name: "✓ Registrar" }).first();
    // O fixture gera 00:01 e 23:59. Sem dose de agora não há botão grande —
    // e aí este caso não tem o que exercitar.
    test.skip(!(await registrar.count()), "sem dose de agora nesta hora do dia");

    await context.setOffline(true);
    await registrar.click();

    /**
     * A frase importa tanto quanto o comportamento.
     *
     * "Registrado" sozinho faria a pessoa achar que subiu, e quem acha que
     * subiu não confere depois. "Não foi possível" faria ela tentar de novo
     * e duplicar. A verdade é a terceira coisa: registrado aqui, sobe
     * depois.
     */
    await expect(
      page.getByText("Registrado. Vai subir quando a internet voltar."),
      "sem esta frase, o cuidador não sabe em que estado a dose está",
    ).toBeVisible({ timeout: 15_000 });

    // E a dose aparece como registrada enquanto espera — senão a tela diria
    // que ela continua pendente, e alguém tocaria de novo.
    await expect(page.getByText("Tomado", { exact: true })).toBeVisible({ timeout: 15_000 });
  });

  test("quando a internet volta, a dose sobe sozinha", async ({ page, context }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);
    await expect(page.getByRole("heading", { name: "Hoje" })).toBeVisible({ timeout: 15_000 });

    const registrar = page.getByRole("button", { name: "✓ Registrar" }).first();
    test.skip(!(await registrar.count()), "sem dose de agora nesta hora do dia");

    await context.setOffline(true);
    await registrar.click();
    await expect(page.getByText("Registrado. Vai subir quando a internet voltar.")).toBeVisible({ timeout: 15_000 });

    // Voltar a conexão dispara o evento `online`, e é ele que drena a fila.
    await context.setOffline(false);

    /**
     * A prova de que subiu de verdade: recarregar a página joga fora tudo
     * que era só estado da aba. O que sobreviver veio do servidor.
     */
    await expect(page.getByText(/acabou de subir/)).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await expect(
      page.getByText("Tomado", { exact: true }),
      "depois de recarregar, a dose só continua registrada se tiver chegado ao servidor",
    ).toBeVisible({ timeout: 15_000 });
  });
});
