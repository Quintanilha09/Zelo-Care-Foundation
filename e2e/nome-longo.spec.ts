import { expect, test } from "@playwright/test";
import {
  criarConta,
  criarPaciente,
  entrar,
  naoRolaNaHorizontal,
  tokenDaConta,
  type ContaDeTeste,
} from "./apoio";

/**
 * Nome comprido de paciente — Issue #88.
 *
 * ── O defeito ─────────────────────────────────────────────────────────────
 *
 * Paciente com nome longo quebrava a tela no celular: a página passava a rolar
 * na horizontal e o conteúdo vazava para fora.
 *
 * A causa é uma linha de CSS que não está escrita em lugar nenhum. Em flexbox,
 * todo item nasce com `min-width: auto`, que significa **"não encolha abaixo da
 * largura mínima do seu conteúdo"**. Uma palavra comprida tem largura mínima
 * enorme, o item se recusa a encolher, e a página inteira ganha rolagem.
 * `flex-1` não resolve — ele é `flex: 1 1 0%`, e o `min-width: auto` vence a
 * base zero.
 *
 * ── Por que este arquivo testa a CLASSE, e não a linha ────────────────────
 *
 * O padrão estava em 29 lugares. Corrigir a linha que o fundador encontrou e
 * torcer para as outras 28 não aparecerem é o oposto de consertar. O que
 * resolve é apontar a **pior entrada legal possível** para **todas** as telas
 * que mostram nome, e medir a propriedade que importa: a página não rola de
 * lado.
 *
 * ── O nome adversário mudou de forma no meio da Issue ─────────────────────
 *
 * O plano original pedia 60 caracteres numa palavra só. Isso deixou de ser
 * criável na mesma Issue: a validação ganhou um teto de 30 letras **por
 * palavra** (`MAX_POR_PALAVRA`), porque uma palavra de 42 letras não é nome de
 * pessoa.
 *
 * Então o pior caso legal de hoje são duas palavras de 30 e 29 — 60
 * caracteres, o teto total, tudo em `W`, a letra mais larga do alfabeto. Se a
 * tela aguenta isso, aguenta qualquer nome que a validação aceita.
 *
 * Fabricar aqui um nome que o servidor recusa daria um teste que prova o
 * contrário do que promete: `criarPaciente` passa pela mesma validação da tela.
 */

/** O pior nome que a validação de hoje aceita: 60 caracteres, todos largos. */
const NOME_ADVERSARIO = `${"W".repeat(30)} ${"W".repeat(29)}`;

/**
 * Um dos nomes reais do relato, alongado até 58 caracteres.
 *
 * É o outro lado do teste: o adversário prova que a tela aguenta; este prova
 * que o encurtamento não inventa nome. "Maria Xavier" é como uma pessoa
 * chamaria essa pessoa.
 */
const NOME_REAL_LONGO = "Maria Aparecida da Conceicao Goncalves de Oliveiraa Xavier";
const NOME_REAL_CURTO = "Maria Xavier";

test.describe("O pior nome que a validação aceita", () => {
  let conta: ContaDeTeste;
  let pacienteId: number;

  test.beforeEach(async ({ request }) => {
    conta = await criarConta(request);
    pacienteId = await criarPaciente(request, conta, NOME_ADVERSARIO);
  });

  test("o nome tem mesmo 60 caracteres — se a validação mudar, este teste avisa", () => {
    // Sem esta asserção, um dia alguém baixa o `NOME_MAX` e este arquivo passa
    // a testar um nome curto, verde e inútil.
    expect(NOME_ADVERSARIO).toHaveLength(60);
  });

  /**
   * As sete telas que mostram nome de paciente. Roda também no projeto
   * "celular" (Pixel 7), que é onde o defeito apareceu.
   */
  for (const tela of [
    { rotulo: "lista de pacientes", caminho: () => "/pacientes" },
    { rotulo: "tela inicial", caminho: () => "/" },
    { rotulo: "resumo de hoje", caminho: () => "/hoje" },
    { rotulo: "cuidadores", caminho: () => "/cuidadores" },
    { rotulo: "ficha do paciente", caminho: (id: number) => `/pacientes/${id}` },
    { rotulo: "histórico", caminho: (id: number) => `/pacientes/${id}/historico` },
    { rotulo: "consultas", caminho: (id: number) => `/pacientes/${id}/consultas` },
    { rotulo: "rotina", caminho: (id: number) => `/pacientes/${id}/rotina` },
  ]) {
    test(`${tela.rotulo} não rola na horizontal`, async ({ page }) => {
      await entrar(page, conta);
      await page.goto(tela.caminho(pacienteId));

      // Espera a tela assentar: medir a largura durante o esqueleto mediria o
      // esqueleto, não o conteúdo.
      await expect(page.locator("main")).toBeVisible();

      await naoRolaNaHorizontal(page);
    });
  }
});

test.describe("Guardar completo, mostrar curto", () => {
  let conta: ContaDeTeste;
  let pacienteId: number;

  test.beforeEach(async ({ request }) => {
    conta = await criarConta(request);
    pacienteId = await criarPaciente(request, conta, NOME_REAL_LONGO);
  });

  test("a lista mostra o nome curto, e guarda o completo no title", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/pacientes");

    await expect(page.getByText(NOME_REAL_CURTO, { exact: true })).toBeVisible();
    await expect(
      page.getByText(NOME_REAL_LONGO, { exact: true }),
      "o nome inteiro na lista é justamente o que quebrava a tela",
    ).toHaveCount(0);

    // Truncar perderia informação; encurtar não pode perder também. O nome
    // inteiro continua alcançável para quem passa o mouse e para leitor de
    // tela.
    await expect(page.getByTitle(NOME_REAL_LONGO)).toBeVisible();
  });

  test("a ficha mostra o nome COMPLETO — é onde ele é necessário", async ({ page }) => {
    await entrar(page, conta);
    await page.goto(`/pacientes/${pacienteId}`);

    // Farmácia, consulta e receita pedem o nome como está no documento. Se
    // ele não estivesse em lugar nenhum da tela, encurtar teria virado
    // esconder.
    await expect(page.getByText(NOME_REAL_LONGO, { exact: true }).first()).toBeVisible();

    // E o título continua sendo o nome curto, que é o que cabe.
    await expect(
      page.getByRole("heading", { level: 2, name: NOME_REAL_CURTO }),
    ).toBeVisible();
  });

  test("encurtar não é truncar — não aparecem reticências", async ({ page }) => {
    await entrar(page, conta);
    await page.goto("/pacientes");

    // "Maria Aparecida da Concei…" não é o nome de ninguém. Era a alternativa
    // que o fundador recusou, e este caso trava a volta dela.
    await expect(page.getByText(/Maria Aparecida da Concei…/)).toHaveCount(0);
  });
});

test.describe("A validação recusa o que não é nome de gente", () => {
  test("a palavra de 42 letras do relato é recusada, com o motivo escrito", async ({
    request,
  }) => {
    const conta = await criarConta(request);

    // O texto exato que o fundador digitou quando a tela quebrou. Não é um
    // nome longo: é UMA PALAVRA de 42 letras, e nenhum sobrenome tem isso.
    const res = await request.post("/api/patients", {
      headers: { Authorization: `Bearer ${await tokenDaConta(request, conta)}` },
      data: {
        name: "Jack sdfsadfsdafsdasdfsadfsadfsaddfasadfsaasfsa",
        timezone: "America/Sao_Paulo",
        healthConsent: { givenBy: "legal_representative", version: "v1.0" },
      },
    });

    expect(res.status()).toBe(400);

    // A mensagem tem que ensinar a regra: "dados inválidos" faria a pessoa
    // tentar de novo às cegas.
    //
    // E tem que chegar como FRASE. Até esta Issue a rota respondia
    // `body.error.message`, que em zod 3 é o array de issues em JSON — o
    // alerta da tela mostrava colchete, aspas e `"path": []`. Ver
    // `lib/erro-de-validacao.ts`.
    const corpo = (await res.json()) as { error: string };
    expect(corpo.error).toBe("Cada parte do nome pode ter até 30 letras.");
  });

  test("mas um nome comprido DE VERDADE continua sendo aceito", async ({ request }) => {
    // É o critério que a Issue coloca acima de todos: baixar o limite para
    // "resolver" o layout rejeitaria gente de verdade, e nome próprio recusado
    // por um formulário é das coisas mais humilhantes que um software faz.
    const conta = await criarConta(request);
    await criarPaciente(request, conta, NOME_REAL_LONGO);
  });
});
