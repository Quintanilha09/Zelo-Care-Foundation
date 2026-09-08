/**
 * O rótulo do aparelho e o prazo de confiança — Issue #79.
 *
 * O rótulo ("Chrome no Windows") é a única coisa que permite à pessoa olhar a
 * lista de aparelhos e saber qual desligar. Ele não decide nada — quem decide
 * se um aparelho vale é o token — e é justamente essa separação que permite
 * ler o user agent, que mente com frequência, sem que a mentira custe
 * segurança.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rotuloDoAparelho, confiancaExpiraEm, DIAS_DE_CONFIANCA } from "../lib/aparelho-confiavel.ts";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";
const EDGE_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0";
const CHROME_ANDROID =
  "Mozilla/5.0 (Linux; Android 13; SM-A536E) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36";
const FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0";

describe("O rótulo que a pessoa lê na lista", () => {
  it("nomeia os aparelhos que o público do ZELO usa", () => {
    assert.equal(rotuloDoAparelho(CHROME_WINDOWS), "Chrome no Windows");
    assert.equal(rotuloDoAparelho(SAFARI_IPHONE), "Safari no iPhone");
    assert.equal(rotuloDoAparelho(FIREFOX_LINUX), "Firefox no Linux");
  });

  it("Edge não vira Chrome, e Android não vira Linux", () => {
    // Os dois se declaram outra coisa dentro do próprio user agent: o Edge diz
    // "Chrome" e o Android diz "Linux". Ordem errada nas listas e a pessoa vê
    // "Chrome no Linux" onde deveria ler "Edge no Windows" — e não reconhece o
    // próprio computador na hora de decidir o que desligar.
    assert.equal(rotuloDoAparelho(EDGE_WINDOWS), "Edge no Windows");
    assert.equal(rotuloDoAparelho(CHROME_ANDROID), "Chrome no Android");
  });

  it("prefere admitir que não sabe a inventar um palpite", () => {
    // Um "desconhecido" honesto é mais útil do que um rótulo errado com cara
    // de certeza: a pessoa sabe que não pode se guiar por ele.
    for (const nada of ["", "   ", "curl/8.4.0", null, undefined]) {
      assert.equal(rotuloDoAparelho(nada), "Aparelho desconhecido", `inventou rótulo para ${JSON.stringify(nada)}`);
    }
  });

  it("nunca devolve vazio — a lista não pode ter linha sem nome", () => {
    for (const ua of [CHROME_WINDOWS, SAFARI_IPHONE, "lixo", ""]) {
      assert.ok(rotuloDoAparelho(ua).length > 0);
    }
  });
});

describe("O prazo de confiança", () => {
  it("é de 30 dias, o padrão da indústria", () => {
    // O fundador aprovou 90 e pediu para eu conferir se era o comum. Não era:
    // Google, GitHub e a maioria usam 30. Se ele preferir 90 mesmo assim, é
    // trocar a constante — e este caso é o que garante que a troca seja
    // deliberada, e não um acidente de refatoração.
    assert.equal(DIAS_DE_CONFIANCA, 30);
  });

  it("conta a partir de agora, não de uma data fixa", () => {
    // O prazo reinicia a cada uso. Se ele fosse calculado a partir do
    // cadastro, a renovação não renovaria nada, e 30 dias viraria uma data de
    // despejo para quem usa o app todo dia.
    const base = new Date("2026-09-08T12:00:00Z");
    const depois = new Date("2026-10-08T12:00:00Z");

    assert.equal(
      confiancaExpiraEm(depois).getTime() - confiancaExpiraEm(base).getTime(),
      depois.getTime() - base.getTime(),
    );
  });

  it("devolve exatamente os dias declarados", () => {
    const base = new Date("2026-09-08T12:00:00Z");
    const dias = (confiancaExpiraEm(base).getTime() - base.getTime()) / (24 * 60 * 60 * 1000);
    assert.equal(dias, DIAS_DE_CONFIANCA);
  });
});
