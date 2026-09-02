import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DIGITOS,
  MAX_TENTATIVAS,
  VALIDADE_MINUTOS,
  gerarCodigo,
  hashDoCodigo,
  conferirHash,
  normalizarCodigo,
  expiraEm,
} from "../lib/codigo-de-verificacao.ts";

/**
 * Código de verificação de 6 dígitos — Issue #77.
 *
 * ── Por que este arquivo é paranoico ──────────────────────────────────────
 *
 * O que ele guarda não é "a função devolve seis caracteres". É que a troca do
 * token de 64 hex por um código de 6 dígitos **não rebaixou a segurança**. São
 * um milhão de combinações contra 2^256, e a única coisa que segura essa
 * diferença é um punhado de propriedades que dá para quebrar por descuido:
 *
 *   - sorteio criptográfico, não `Math.random()`
 *   - zero à esquerda preservado (senão 10% dos códigos ficam menores)
 *   - hash preso ao usuário, senão o código de um casa com a linha do outro
 *   - prazo curto e teto de tentativas
 *
 * Cada uma delas some sem quebrar nada visível. Daí o teste.
 */

describe("Código de verificação — geração", () => {
  it("tem sempre 6 dígitos, inclusive quando o sorteio dá número pequeno", () => {
    // 2000 amostras: com um milhão de possibilidades, a chance de nenhuma cair
    // abaixo de 100.000 (o caso do zero à esquerda) é desprezível.
    let viuComZeroAEsquerda = false;

    for (let i = 0; i < 2000; i++) {
      const c = gerarCodigo();
      assert.equal(c.length, DIGITOS, `código fora do tamanho: "${c}"`);
      assert.match(c, /^\d{6}$/, `código com caractere que não é dígito: "${c}"`);
      if (c.startsWith("0")) viuComZeroAEsquerda = true;
    }

    // Sem o padStart, `String(42)` viraria "42": um código de dois dígitos, com
    // espaço de busca dez mil vezes menor, e nada na tela denunciando.
    assert.ok(
      viuComZeroAEsquerda,
      "em 2000 sorteios nenhum começou com zero — sinal de que o padStart sumiu",
    );
  });

  it("não repete de forma suspeita — o sorteio é do crypto, não do Math.random", () => {
    const vistos = new Set<string>();
    for (let i = 0; i < 500; i++) vistos.add(gerarCodigo());

    // 500 sorteios em um milhão de valores: repetição é possível (paradoxo do
    // aniversário dá ~12% de chance de pelo menos uma), mas um gerador travado
    // ou de baixa entropia cairia MUITO abaixo disto.
    assert.ok(vistos.size > 480, `só ${vistos.size} códigos distintos em 500 — entropia baixa`);
  });

  it("os parâmetros de segurança continuam nos valores que a conta assume", () => {
    // Não é teste de constante por teste de constante: a conta de risco escrita
    // no módulo (1 chance em 200.000) depende destes três números. Mudar
    // qualquer um sem refazer a conta é o caminho silencioso para o rebaixamento.
    assert.equal(DIGITOS, 6);
    assert.equal(MAX_TENTATIVAS, 5);
    assert.equal(VALIDADE_MINUTOS, 10);
    assert.ok(VALIDADE_MINUTOS <= 15, "prazo longo é janela de adivinhação");
  });
});

describe("Código de verificação — hash", () => {
  it("o MESMO código dá hashes DIFERENTES para usuários diferentes", () => {
    // É a razão de o sal existir. Sem ele, com um milhão de códigos e muitos
    // usuários, dois teriam o mesmo hash o tempo todo — e a verificação de um
    // casaria com a linha do outro.
    const a = hashDoCodigo(1, "123456");
    const b = hashDoCodigo(2, "123456");
    assert.notEqual(a, b, "sem sal por usuário, um código serve para a conta errada");
  });

  it("o mesmo par usuário+código dá sempre o mesmo hash", () => {
    assert.equal(hashDoCodigo(42, "000123"), hashDoCodigo(42, "000123"));
  });

  it("o hash não contém o código em claro", () => {
    const h = hashDoCodigo(7, "482915");
    assert.ok(!h.includes("482915"), "o código não pode aparecer dentro do próprio hash");
    assert.match(h, /^[0-9a-f]{64}$/, "esperava SHA-256 em hex");
  });

  it("conferirHash aceita igual e recusa diferente, inclusive de tamanhos diferentes", () => {
    const h = hashDoCodigo(7, "482915");
    assert.equal(conferirHash(h, hashDoCodigo(7, "482915")), true);
    assert.equal(conferirHash(h, hashDoCodigo(7, "482916")), false);
    // `timingSafeEqual` LANÇA quando os tamanhos diferem — sem a guarda de
    // tamanho, um corpo malformado derrubaria a rota em vez de recusar.
    assert.equal(conferirHash(h, "curto"), false);
    assert.equal(conferirHash("", h), false);
  });
});

describe("Código de verificação — o que a pessoa digita", () => {
  it("aceita o código limpo", () => {
    assert.equal(normalizarCodigo("482915"), "482915");
  });

  it("aceita como o e-mail e o celular costumam entregar", () => {
    // Copiar do e-mail traz espaço junto com frequência; o teclado do celular
    // às vezes insere separador. Recusar por isso seria culpar a pessoa por um
    // detalhe de transporte.
    assert.equal(normalizarCodigo(" 482915 "), "482915");
    assert.equal(normalizarCodigo("482 915"), "482915");
    assert.equal(normalizarCodigo("482-915"), "482915");
  });

  it("recusa o que não é um código", () => {
    for (const entrada of ["12345", "1234567", "abcdef", "12345a", "", null, undefined, 482915, {}]) {
      assert.equal(
        normalizarCodigo(entrada),
        null,
        `deveria recusar: ${JSON.stringify(entrada)}`,
      );
    }
  });

  it("não tenta 'consertar' um código de tamanho errado", () => {
    // Completar com zero ou cortar o excesso transformaria erro de digitação em
    // tentativa válida, gastando o limite de cinco por engano.
    assert.equal(normalizarCodigo("48291"), null);
    assert.equal(normalizarCodigo("4829155"), null);
  });
});

describe("Código de verificação — prazo", () => {
  it("expira em 10 minutos a partir do instante dado", () => {
    const agora = new Date("2026-09-02T12:00:00Z");
    assert.equal(expiraEm(agora).toISOString(), "2026-09-02T12:10:00.000Z");
  });

  it("não usa o relógio do sistema — recebe o instante de fora", () => {
    // `Clock.now()` é a regra do projeto (ver lint:clock). Uma função de domínio
    // que lê `new Date()` por dentro não pode ser testada nem congelada.
    const caminho = fileURLToPath(new URL("../lib/codigo-de-verificacao.ts", import.meta.url));
    const fonte = readFileSync(caminho, "utf8");
    assert.ok(
      !/new Date\(\)|Date\.now\(\)/.test(fonte),
      "o módulo não pode ler o relógio por conta própria",
    );
  });
});
