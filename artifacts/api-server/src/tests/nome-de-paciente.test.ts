/**
 * A forma de um nome de paciente — Issue #56.
 *
 * Teste puro: não sobe servidor, não toca no banco. É de propósito — a regra
 * é uma função, e função se testa como função. Também é a única parte desta
 * Issue que pôde ser executada na máquina onde ela foi escrita, onde o
 * Postgres não sobe (Smart App Control, ver CONTEXT.md).
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NOME_MAX, MAX_POR_PALAVRA, nomeDePaciente, normalizarNome } from "../lib/nome-de-paciente.ts";
import { mensagemDeValidacao } from "../lib/erro-de-validacao.ts";

/** Aceita e devolve o nome já normalizado. */
function aceita(bruto: string): string {
  const r = nomeDePaciente.safeParse(bruto);
  assert.equal(r.success, true, `deveria aceitar ${JSON.stringify(bruto)}`);
  return (r as { success: true; data: string }).data;
}

/** Recusa, e devolve a mensagem — que precisa ser legível, não "dados inválidos". */
function recusa(bruto: string): string {
  const r = nomeDePaciente.safeParse(bruto);
  assert.equal(r.success, false, `deveria recusar ${JSON.stringify(bruto)}`);
  return (r as { success: false; error: { issues: Array<{ message: string }> } }).error.issues[0]
    .message;
}

describe("Nome de paciente — o que passa", () => {
  it("nome e sobrenome simples", () => {
    assert.equal(aceita("Maria Silva"), "Maria Silva");
  });

  it("acento, que é a regra e não a exceção em português", () => {
    assert.equal(aceita("José Antônio Conceição"), "José Antônio Conceição");
  });

  it("preposição no meio — 'Maria da Silva' é nome de gente", () => {
    assert.equal(aceita("Maria da Silva"), "Maria da Silva");
  });

  it("hífen e apóstrofo — 'Ana-Clara D'Ávila'", () => {
    assert.equal(aceita("Ana-Clara D'Ávila"), "Ana-Clara D'Ávila");
  });

  it("inicial do meio — 'Ana P Silva' é nome de gente", () => {
    // A primeira versão da regra pedia duas palavras com 2+ caracteres e
    // recusava isto. Recusava também "Paciente A" dentro da própria suíte,
    // e foi assim que o exagero apareceu.
    assert.equal(aceita("Ana P Silva"), "Ana P Silva");
  });

  it("TRÊS palavras passam — é a suposição registrada no módulo", () => {
    // O paciente cadastrado no ambiente do fundador em 31/08/2026. Se um dia
    // a regra virar "exatamente duas palavras", este teste falha — e falhar
    // aqui é melhor que recusar o nome de alguém em produção.
    assert.equal(aceita("Jailson Mendes Delicia"), "Jailson Mendes Delicia");
  });

  it("exatamente no teto de caracteres", () => {
    // Um nome de gente, e não 54 letras iguais: desde a Issue #88 existe
    // também um teto POR PALAVRA, e a versão sintética deste teste passou a
    // esbarrar nele. Trocar por um nome real é o conserto certo — o que este
    // caso prova é que 60 caracteres são aceitos, e um nome de verdade prova
    // isso melhor que uma palavra que ninguém tem.
    const noLimite = "Maria Aparecida da Conceicao Goncalves de Oliveiraa Xavier";
    assert.equal(noLimite.length, NOME_MAX - 2);
    assert.equal(aceita(noLimite), noLimite);

    const exatamenteNoTeto = `${noLimite}ns`;
    assert.equal(exatamenteNoTeto.length, NOME_MAX);
    assert.equal(aceita(exatamenteNoTeto), exatamenteNoTeto);
  });
});

describe("Nome de paciente — normalização", () => {
  it("corta espaço das pontas", () => {
    assert.equal(aceita("  Maria Silva  "), "Maria Silva");
  });

  it("colapsa espaço repetido — senão viram dois nomes diferentes no banco", () => {
    assert.equal(aceita("Maria     Silva"), "Maria Silva");
  });

  it("normaliza ANTES de medir: só espaço não vira nome de 2 caracteres", () => {
    // Sem normalizar primeiro, "  A  " teria 5 caracteres e passaria no mínimo.
    recusa("  A  ");
  });

  it("`normalizarNome` é exportada e faz as duas coisas", () => {
    assert.equal(normalizarNome("  Ana   Maria "), "Ana Maria");
  });
});

describe("Nome de paciente — o que é recusado", () => {
  it("uma palavra só", () => {
    assert.match(recusa("Maria"), /sobrenome/i);
  });

  it("vazio", () => {
    recusa("");
  });

  it("acima do teto de caracteres", () => {
    const gigante = `${"A".repeat(NOME_MAX)} Silva`;
    assert.match(recusa(gigante), new RegExp(String(NOME_MAX)));
  });

  it("dígito — nome de gente não tem número", () => {
    assert.match(recusa("Maria Silva 2"), /letras/i);
  });

  it("emoji", () => {
    assert.match(recusa("Maria 😀 Silva"), /letras/i);
  });

  it("pontuação estranha e sinais de marcação", () => {
    assert.match(recusa("Maria <b>Silva</b>"), /letras/i);
    assert.match(recusa("Maria; DROP TABLE"), /letras/i);
  });


  it("a mensagem é específica, nunca 'dados inválidos'", () => {
    for (const bruto of ["Maria", "Maria Silva 2", `${"A".repeat(80)} Silva`]) {
      const msg = recusa(bruto);
      assert.ok(msg.length > 10, `mensagem curta demais para ${bruto}: ${msg}`);
      assert.doesNotMatch(msg, /inválid[oa]s?$/i, `mensagem genérica demais: ${msg}`);
    }
  });
});

/**
 * Teto por palavra — Issue #88.
 *
 * O relato foi de tela quebrada no celular, e a causa imediata era de layout
 * (`min-width: auto` do flexbox). Estas asserções cobrem só a parte que a
 * validação resolve: recusar o que não é nome de gente. O que garante que a
 * tela aguenta um nome LEGAL comprido é `e2e/nome-longo.spec.ts`.
 */
describe("Teto por palavra — Issue #88", () => {
  it("recusa a palavra de 42 letras que quebrou a tela", () => {
    // O nome do relato, com o sobrenome do tamanho original.
    const msg = recusa(`Jack ${"s".repeat(42)}`);
    assert.match(msg, new RegExp(String(MAX_POR_PALAVRA)));
    assert.match(msg, /parte do nome/i);
  });

  it("aceita exatamente no limite, e recusa um a mais", () => {
    // Limite é ponto de defeito clássico: um `>=` no lugar de `>` recusaria
    // silenciosamente todo nome de 30 letras, e ninguém perceberia.
    const noLimite = `Ana ${"W".repeat(MAX_POR_PALAVRA)}`;
    assert.equal(aceita(noLimite), noLimite);
    recusa(`Ana ${"W".repeat(MAX_POR_PALAVRA + 1)}`);
  });

  it("mede a palavra, não o nome inteiro", () => {
    // Cinquenta e um caracteres no total, nenhuma palavra passando de 30 —
    // e este é EXATAMENTE o caso que a Issue proíbe recusar: nome comprido
    // de gente de verdade.
    const real = "Maria Aparecida da Conceicao Goncalves de Oliveira";
    assert.ok(real.length > MAX_POR_PALAVRA);
    assert.equal(aceita(real), real);
  });

  it("conta letras, e não pedaços de letra", () => {
    // Vinte letras acentuadas escritas como `e` + acento combinante ocupam 40
    // pontos de código. Sem o `normalize("NFC")` na medição, este nome seria
    // recusado por passar de 30 — um motivo invisível para quem digitou, já
    // que o teclado do iOS produz exatamente esta forma.
    const LETRAS = 20;
    const comAcento = `Ana ${"e\u0301".repeat(LETRAS)}`;
    assert.equal([...comAcento.split(" ")[1]].length, LETRAS * 2);
    assert.equal(aceita(comAcento), comAcento);
  });

  it("o teto de 60 caracteres continua valendo, e vem antes", () => {
    // Duas palavras de 30 somam 61 com o espaço: passa no teto por palavra e
    // falha no teto total. A ordem importa para a mensagem fazer sentido.
    const msg = recusa(`${"W".repeat(MAX_POR_PALAVRA)} ${"X".repeat(MAX_POR_PALAVRA)}`);
    assert.match(msg, new RegExp(String(NOME_MAX)));
  });

  it("nomes reais compridos continuam passando", () => {
    for (const nome of [
      "Antonio Carlos de Vasconcelos Nascimento Filho",
      "Maria das Gracas Ferreira dos Santos",
      "Ana P Silva",
      "Jose dos Santos Neto",
    ]) {
      assert.equal(aceita(nome), nome, `recusou nome de gente: ${nome}`);
    }
  });
});

/**
 * A mensagem que CHEGA NA TELA — Issue #88.
 *
 * O bloco acima prova que as frases são específicas. Ele lê
 * `error.issues[0].message`. As rotas mandavam `error.message`, que em zod 3
 * é o array de issues em JSON — então a pessoa via colchete e aspas, e a
 * frase bem escrita chegava envelopada.
 *
 * Um teste que mede uma propriedade que o caminho de produção não tem é pior
 * que nenhum: ele dá a sensação de cobertura. Estes casos medem a função que
 * a rota usa de verdade.
 */
describe("A mensagem que chega na tela", () => {
  it("é a frase, e não o JSON das issues", () => {
    const r = nomeDePaciente.safeParse("Maria");
    assert.equal(r.success, false);
    const msg = mensagemDeValidacao((r as { success: false; error: never }).error);

    assert.equal(msg, "Escreva o nome e ao menos um sobrenome.");
    // As três marcas do JSON serializado. Se qualquer uma voltar, alguém
    // trocou de volta para `error.message`.
    assert.doesNotMatch(msg, /^\s*\[/, "veio como array JSON");
    assert.doesNotMatch(msg, /"code"/, "veio com o objeto da issue");
    assert.doesNotMatch(msg, /"path"/, "veio com o objeto da issue");
  });

  it("não fica sem frase quando o erro não traz issue nenhuma", () => {
    // Não deveria acontecer, e por isso mesmo: se acontecer, a tela precisa
    // dizer alguma coisa em vez de um alerta vazio.
    const msg = mensagemDeValidacao({ issues: [] } as never);
    assert.ok(msg.length > 10);
  });
});
