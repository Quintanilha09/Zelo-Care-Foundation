/**
 * O nome de quem cuida, no cadastro e na edição — Issue #78.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CRIAR NÃO NORMALIZAVA, EDITAR NORMALIZAVA — E NENHUM TESTE AFIRMAVA QUE AS
 * DUAS ROTAS DEVIAM CONCORDAR.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O defeito não aparecia em tela nenhuma: a família 425 ficou gravada como
 * `'Família de Gabriel Quintanilha '`, com um espaço no fim, e ninguém viu.
 * Espaço à direita não muda o desenho de nada — ele só vaza para busca,
 * ordenação e comparação, meses depois, longe de onde foi criado.
 *
 * É a mesma classe de defeito que este projeto já teve três vezes: duas cópias
 * da mesma regra, uma delas ausente, e nada cruzando as duas. O que muda aqui
 * é que agora existe **um schema só**, e estes casos são o que impede alguém
 * de voltar a ter dois.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizarNome, nomeDePessoa, NOME_MIN, NOME_MAX } from "../lib/nome-de-pessoa.ts";

describe("Normalizar o nome", () => {
  it("tira espaço das duas pontas", () => {
    // O caso exato do banco em 02/09/2026.
    assert.equal(normalizarNome("Gabriel Quintanilha "), "Gabriel Quintanilha");
    assert.equal(normalizarNome(" Gabriel Quintanilha"), "Gabriel Quintanilha");
    assert.equal(normalizarNome("  Gabriel Quintanilha  "), "Gabriel Quintanilha");
  });

  it("colapsa espaço repetido no meio", () => {
    assert.equal(normalizarNome("Ana   Maria"), "Ana Maria");
    assert.equal(normalizarNome("Ana \t Maria"), "Ana Maria");
  });

  it("não mexe em acento, maiúscula nem hífen", () => {
    // Normalizar isso seria corrigir o nome da pessoa, e o nome é dela.
    assert.equal(normalizarNome("Antônio de Sá-Carneiro"), "Antônio de Sá-Carneiro");
    assert.equal(normalizarNome("ana maria"), "ana maria");
  });

  it("é idempotente — aplicar de novo não muda mais nada", () => {
    const uma = normalizarNome("  Ana   Maria  ");
    assert.equal(normalizarNome(uma), uma);
  });
});

describe("O schema que as duas rotas usam", () => {
  it("devolve o nome já limpo", () => {
    // É isto que faz o `Família de ${nome}` do cadastro herdar a limpeza sem
    // ninguém precisar lembrar de aplicá-la lá.
    const r = nomeDePessoa.safeParse("  Gabriel Quintanilha  ");
    assert.ok(r.success);
    assert.equal(r.data, "Gabriel Quintanilha");
  });

  it("recusa o que só tem tamanho por causa do espaço", () => {
    // "  a  " tem cinco caracteres antes de limpar e um depois. Sem a segunda
    // checagem, passaria — e era exatamente o que `PATCH /account/me` fazia à
    // mão, num lugar onde ninguém pensaria em olhar.
    assert.equal(nomeDePessoa.safeParse("  a  ").success, false);
  });

  it("aceita nome de uma palavra só", () => {
    // Cuidador pode se chamar só "Ana". A regra de duas palavras é de nome de
    // PACIENTE (`lib/nome-de-paciente.ts`) e não vale aqui — aplicá-la
    // recusaria gente de verdade no cadastro.
    const r = nomeDePessoa.safeParse("Ana");
    assert.ok(r.success, "recusou um nome legítimo de uma palavra");
    assert.equal(r.data, "Ana");
  });

  it("respeita os limites declarados", () => {
    assert.equal(nomeDePessoa.safeParse("A".repeat(NOME_MIN)).success, true);
    assert.equal(nomeDePessoa.safeParse("A".repeat(NOME_MIN - 1)).success, false);
    assert.equal(nomeDePessoa.safeParse("A".repeat(NOME_MAX)).success, true);
    assert.equal(nomeDePessoa.safeParse("A".repeat(NOME_MAX + 1)).success, false);
  });

  it("a mensagem de erro é uma frase, não um limite solto", () => {
    // Ela chega na tela (ver `lib/erro-de-validacao.ts`, Issue #100).
    const r = nomeDePessoa.safeParse("a");
    assert.ok(!r.success);
    assert.match(r.error.issues[0]!.message, /^O nome precisa ter/);
  });

  it("recusa o que não é texto", () => {
    for (const invalido of [42, null, undefined, {}, []]) {
      assert.equal(
        nomeDePessoa.safeParse(invalido).success,
        false,
        `aceitou ${JSON.stringify(invalido)}`,
      );
    }
  });
});
