/**
 * Os códigos de recuperação, por dentro — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * COM O SEGUNDO FATOR OBRIGATÓRIO, ESTES CÓDIGOS SÃO A ÚNICA COISA ENTRE UMA
 * CAIXA DE E-MAIL PERDIDA E UMA CONTA PERDIDA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O arquivo `aparelho-novo.test.ts` prova que eles **entram** no lugar do
 * código do e-mail. Este prova as duas propriedades que sustentam isso e que
 * não aparecem em tela nenhuma:
 *
 *   1. **são fortes** — 2^50 combinações. Encurtar para caber melhor no papel
 *      derrubaria isso sem sintoma nenhum
 *   2. **são digitáveis** — sem I, O, 0 e 1, e tolerantes a minúscula, espaço
 *      e hífen. Um código que a pessoa não consegue digitar, seis meses
 *      depois, no dia em que perdeu o e-mail, não é caminho de volta
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  gerarCodigosDeRecuperacao,
  normalizarCodigoDeRecuperacao,
  hashDoCodigoDeRecuperacao,
  QUANTOS_CODIGOS,
  AVISAR_ABAIXO_DE,
} from "../lib/codigos-de-recuperacao.ts";

describe("O jogo de códigos", () => {
  it("vem com dez, que é o que cobre trocar de celular algumas vezes", () => {
    assert.equal(gerarCodigosDeRecuperacao().length, QUANTOS_CODIGOS);
    assert.ok(QUANTOS_CODIGOS >= 8, `${QUANTOS_CODIGOS} códigos acabam calados — e "acabou" aqui é conta perdida`);
  });

  it("avisa antes de acabar, e não no zero", () => {
    // Quem chega a zero sem perceber só descobre no dia em que já não pode
    // mais gerar códigos novos: para gerar, é preciso estar dentro da conta.
    assert.ok(AVISAR_ABAIXO_DE >= 2, "avisar só no último código é avisar tarde demais");
    assert.ok(AVISAR_ABAIXO_DE < QUANTOS_CODIGOS, "avisar desde o começo é não avisar");
  });

  it("cada código tem dez posições, em dois grupos de cinco", () => {
    for (const codigo of gerarCodigosDeRecuperacao()) {
      assert.match(codigo, /^[A-Z2-9]{5}-[A-Z2-9]{5}$/, `formato inesperado: ${codigo}`);
    }
  });

  it("nunca traz I, O, zero ou um", () => {
    // Não é preciosismo tipográfico: estes códigos são impressos e digitados à
    // mão, às vezes por alguém que não enxerga bem, e "zero ou ó?" custa uma
    // tentativa em papel amassado no pior dia possível.
    //
    // Mil códigos porque com 32 símbolos e 10 posições um jogo de dez poderia
    // passar por sorte se o alfabeto fosse afrouxado.
    const muitos = gerarCodigosDeRecuperacao(1000).join("");
    for (const proibido of ["I", "O", "0", "1"]) {
      assert.ok(!muitos.includes(proibido), `o alfabeto voltou a incluir "${proibido}"`);
    }
  });

  it("dois jogos não se parecem — o gerador é aleatório de verdade", () => {
    // Uma sanidade barata: se alguém trocar randomInt por algo determinístico
    // (ou por um seed fixo), isto cai antes de a conta virar pública.
    const a = gerarCodigosDeRecuperacao(50);
    const b = gerarCodigosDeRecuperacao(50);
    const repetidos = a.filter((c) => b.includes(c));
    assert.equal(repetidos.length, 0, `${repetidos.length} códigos repetidos entre dois jogos`);
  });

  it("os dez de um jogo são diferentes entre si", () => {
    const jogo = gerarCodigosDeRecuperacao();
    assert.equal(new Set(jogo).size, jogo.length);
  });
});

describe("Aceitar o que a pessoa realmente digita", () => {
  it("minúscula, espaço e sem hífen dão o mesmo código", () => {
    const canonico = "ABCDE-FGHJK";
    for (const grafia of ["abcde-fghjk", "ABCDE FGHJK", "ABCDEFGHJK", "  abcde fghjk  ".trim()]) {
      assert.equal(normalizarCodigoDeRecuperacao(grafia), canonico, `recusou "${grafia}"`);
    }
  });

  it("as três grafias produzem o MESMO hash", () => {
    // Guardar o hash do que foi digitado cru faria "abcde-fghjk" e
    // "ABCDEFGHJK" virarem segredos diferentes — e o código do papel deixaria
    // de funcionar dependendo do teclado.
    const um = hashDoCodigoDeRecuperacao(7, normalizarCodigoDeRecuperacao("abcde-fghjk")!);
    const dois = hashDoCodigoDeRecuperacao(7, normalizarCodigoDeRecuperacao("ABCDEFGHJK")!);
    assert.equal(um, dois);
  });

  it("NÃO corrige por adivinhação", () => {
    // Trocar O por 0, ou I por 1, multiplicaria silenciosamente as tentativas
    // válidas por palpite: cada erro de digitação viraria dois códigos aceitos.
    // Quem digitou uma letra que não existe no alfabeto errou de fato.
    for (const invalido of ["ABCDE-FGHJ0", "1BCDE-FGHJK", "ABCDE-FGHJO", "ABCDE-FGHJI"]) {
      assert.equal(normalizarCodigoDeRecuperacao(invalido), null, `aceitou "${invalido}"`);
    }
  });

  it("recusa tamanho errado, vazio e o que não é texto", () => {
    for (const invalido of ["ABCDE", "ABCDE-FGHJKL", "", "   ", 424242, null, undefined, {}]) {
      assert.equal(normalizarCodigoDeRecuperacao(invalido), null, `aceitou ${JSON.stringify(invalido)}`);
    }
  });
});

describe("O hash", () => {
  it("muda com o usuário — é o que separa uma conta da outra", () => {
    // O sal não é ofuscação: com 2^50 possibilidades, SHA-256 sem sal já seria
    // inquebrável. Ele existe para que o código de um usuário nunca case com a
    // linha de outro.
    const codigo = normalizarCodigoDeRecuperacao("ABCDE-FGHJK")!;
    assert.notEqual(hashDoCodigoDeRecuperacao(1, codigo), hashDoCodigoDeRecuperacao(2, codigo));
  });

  it("não guarda o código em lugar nenhum do resultado", () => {
    const codigo = normalizarCodigoDeRecuperacao("ABCDE-FGHJK")!;
    const hash = hashDoCodigoDeRecuperacao(1, codigo);
    assert.match(hash, /^[0-9a-f]{64}$/);
    assert.ok(!hash.includes("ABCDE"), "o hash não pode conter o código");
  });
});
