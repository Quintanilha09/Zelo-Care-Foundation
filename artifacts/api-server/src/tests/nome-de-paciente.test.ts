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
import { NOME_MAX, nomeDePaciente, normalizarNome } from "../lib/nome-de-paciente.ts";

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
    const noLimite = `${"A".repeat(NOME_MAX - 6)} Silva`;
    assert.equal(noLimite.length, NOME_MAX);
    assert.equal(aceita(noLimite), noLimite);
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
