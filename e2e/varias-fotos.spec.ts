import { expect, test } from "@playwright/test";
import { criarConta, criarPaciente, entrar, PNG_1X1, tokenDaConta } from "./apoio";

/**
 * Publicar várias fotos de uma vez — Issue #64.
 *
 * ── O que era ─────────────────────────────────────────────────────────────
 *
 * Uma foto por vez. Quem voltava de um passeio com oito repetia oito vezes o
 * ciclo escolher-esperar-publicar. O `<input type="file">` não tinha
 * `multiple`, e o `onChange` lia `files?.[0]` — só o primeiro, mesmo que o
 * sistema entregasse vários.
 *
 * ── O que este teste prova ────────────────────────────────────────────────
 *
 * Que o caminho inteiro funciona pela TELA, com arquivos de verdade entrando
 * pelo seletor: escolher três, ver as três na prévia, tirar uma do lote, e
 * publicar as duas que sobraram.
 *
 * `setInputFiles` com uma lista é o que exercita o `multiple` — com um arquivo
 * só, o teste passaria também no código antigo.
 */

/** Três nomes distintos: a prévia identifica cada foto pelo nome do arquivo. */
const FOTOS = ["passeio-um.png", "passeio-dois.png", "passeio-tres.png"].map((name) => ({
  name,
  mimeType: "image/png",
  buffer: PNG_1X1,
}));

test("escolher três fotos, tirar uma e publicar as outras duas", async ({ page, request }) => {
  const conta = await criarConta(request);
  const token = await tokenDaConta(request, conta);
  const pacienteId = await criarPaciente(request, conta);

  const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);

  await expect(
    page.getByRole("region", { name: /^Momentos de / })
  ).toBeVisible({ timeout: 15_000 });

  // O input é `hidden` — o botão é quem o dispara na vida real. No teste,
  // `setInputFiles` fala com o input direto, que é o suportado pelo Playwright
  // para campo escondido.
  await page.locator('input[type="file"]').setInputFiles(FOTOS);

  // As três aparecem na prévia, antes de publicar.
  const naPrevia = page.getByRole("button", { name: /^Tirar .* do envio$/ });
  await expect(naPrevia).toHaveCount(3);

  // Tirar uma do lote: sem isso, escolher 8 e perceber que uma está ruim
  // obrigaria a recomeçar do zero.
  await page.getByRole("button", { name: "Tirar passeio-dois.png do envio" }).click();
  await expect(naPrevia).toHaveCount(2);

  await page.getByRole("button", { name: "Publicar" }).click();

  // Duas no mural — e a prévia esvazia, porque as duas subiram.
  await expect(page.getByRole("button", { name: /^Abrir a foto de / })).toHaveCount(2, {
    timeout: 30_000,
  });
  await expect(naPrevia).toHaveCount(0);
});

test("o botão diz 'fotos', no plural — a tela promete o que faz", async ({ page, request }) => {
  const conta = await criarConta(request);
  const token = await tokenDaConta(request, conta);
  const pacienteId = await criarPaciente(request, conta);

  const consentimento = await request.post(`/api/patients/${pacienteId}/image-consent`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { consentGiven: true, version: "v1.0", givenBy: "legal_representative" },
  });
  expect(consentimento.ok(), await consentimento.text()).toBeTruthy();

  await entrar(page, conta);
  await page.goto(`/pacientes/${pacienteId}`);

  await expect(page.getByRole("button", { name: "Adicionar fotos" })).toBeVisible({
    timeout: 15_000,
  });

  // E o input aceita mais de um — o atributo é o contrato com o sistema
  // operacional. Sem ele, o seletor do celular nem oferece escolha múltipla.
  await expect(page.locator('input[type="file"]')).toHaveAttribute("multiple", "");
});
