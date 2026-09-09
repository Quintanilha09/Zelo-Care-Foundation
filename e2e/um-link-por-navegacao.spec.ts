import { test, expect } from "@playwright/test";
import { criarConta, criarPaciente, entrar, type ContaDeTeste } from "./apoio";

/**
 * Um link por item de navegação — Issue #119.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * O `<Link>` do wouter v3 monta o **próprio `<a>`** e põe os filhos dentro.
 * Com o padrão `<Link href="..."><a className="...">Texto</a></Link>` saem
 * **duas âncoras aninhadas** — HTML inválido. O parser do navegador achata em
 * duas irmãs:
 *
 *   <a href="/pacientes"></a><a class="...">Pacientes</a>
 *
 * A de fora leva o `href` e fica **vazia**; a de dentro leva o texto e fica
 * **sem destino**. Leitor de tela anuncia dois links por item, e o `Tab` para
 * nos dois. `asChild` faz o wouter injetar `href` no `<a>` que já existe.
 *
 * ── Por que a asserção é esta, e não "conta quantos links existem" ────────
 *
 * Contar `a[href="/pacientes"]` dá **1 nos dois casos** — o defeito não
 * duplica o href, ele o separa do texto. O que distingue é a **coincidência**:
 * depois da correção, o elemento que carrega o texto é o mesmo que carrega o
 * destino. Antes, eram dois elementos diferentes.
 */

let conta: ContaDeTeste;
let pacienteId: number;

test.beforeAll(async ({ request }) => {
  conta = await criarConta(request);
  pacienteId = await criarPaciente(request, conta);
});

test.describe("Navegação sem link duplicado", () => {
  test.beforeEach(async ({ page }) => {
    await entrar(page, conta);
  });

  test("no cabeçalho, o link que tem o texto é o que tem o destino", async ({ page }) => {
    await page.goto("/");
    const cabecalho = page.locator("header");
    await expect(cabecalho.locator('a[href="/pacientes"]')).toBeVisible({ timeout: 15_000 });

    // Antes da correção, esta âncora vinha VAZIA — o texto morava na irmã
    // sem href.
    await expect(
      cabecalho.locator('a[href="/pacientes"]'),
      "o link de destino tem que ser o mesmo que mostra o rótulo",
    ).toContainText("Pacientes");

    await expect(cabecalho.locator('a[href="/cuidadores"]')).toContainText("Cuidadores");
  });

  test("o cabeçalho não tem âncora sem destino", async ({ page }) => {
    await page.goto("/");
    await expect(page.locator("header")).toBeVisible({ timeout: 15_000 });

    // Uma `<a>` sem `href` não é link nenhum — não tem papel de link, não
    // recebe foco, e existir é sempre resíduo. No cabeçalho, era metade de
    // cada item de navegação.
    await expect(
      page.locator("header a:not([href])"),
      "âncora sem href é a metade órfã do link aninhado",
    ).toHaveCount(0);
  });

  test("o cartão do paciente leva o nome e o destino no mesmo lugar", async ({ page }) => {
    await page.goto("/pacientes");

    const cartao = page.locator(`a[href="/pacientes/${pacienteId}"]`).first();
    await expect(cartao).toBeVisible({ timeout: 15_000 });
    await expect(
      cartao,
      "o cartão inteiro é o link — antes o href ficava numa âncora vazia ao lado",
    ).not.toBeEmpty();
  });

  test("o voltar da ficha do paciente é um link só", async ({ page }) => {
    await page.goto(`/pacientes/${pacienteId}/rotina`);

    const voltar = page.locator(`a[href="/pacientes/${pacienteId}"]`).first();
    await expect(voltar).toBeVisible({ timeout: 15_000 });
    await expect(voltar).not.toBeEmpty();
  });
});
