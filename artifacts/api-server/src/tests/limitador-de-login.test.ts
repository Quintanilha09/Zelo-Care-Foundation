/**
 * Os limites de login, e a mensagem que eles devolvem — Issue #107.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ATÉ 08/09/2026 NENHUM TESTE AFIRMAVA QUAL ERA O LIMITE DE LOGIN. DAVA PARA
 * TROCAR 5 POR 500 E A SUÍTE INTEIRA CONTINUAVA VERDE.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O número é decisão de produto, não detalhe de implementação: cinco tentativas
 * por 15 minutos **por IP** trancava uma casa inteira, porque uma família
 * cuidando de um idoso tem vários cuidadores atrás do mesmo roteador. Foi o que
 * aconteceu com o fundador testando em modo produção.
 *
 * Afrouxar o de IP e manter o de e-mail é uma decisão que pode ser revertida
 * por engano com um número trocado, e é isso que estes casos travam.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LOGIN_POR_IP,
  LOGIN_POR_EMAIL,
  mensagemDeEspera,
  multiplicadorDeLimite,
} from "../lib/rate-limit.ts";
import { Clock } from "../lib/clock.ts";

describe("Os limites de login", () => {
  it("por IP cabe numa casa com vários cuidadores", () => {
    // Cinco trancava a família toda por 15 minutos — inclusive quem precisava
    // registrar uma dose. Encosta no invariante 6 do produto.
    assert.ok(
      LOGIN_POR_IP >= 15,
      `${LOGIN_POR_IP} por IP é apertado demais: quatro cuidadores na mesma casa errando a senha uma vez cada trancariam todos`,
    );
  });

  it("por IP continua barrando varredura automatizada", () => {
    // Frouxo demais deixaria de ser limite. O número não é sobre conforto: é
    // sobre onde fica a fronteira entre uma família atrapalhada e um script.
    assert.ok(
      LOGIN_POR_IP <= 50,
      `${LOGIN_POR_IP} por IP em 15 minutos deixa de ser limite`,
    );
  });

  it("por e-mail NÃO foi afrouxado — é a defesa que importa", () => {
    // O ataque real é força bruta contra UMA conta, e quem faz isso troca de
    // IP. Este limite é o que protege o alvo, e a Issue #107 diz explicitamente
    // para não mexer nele.
    assert.equal(
      LOGIN_POR_EMAIL,
      10,
      "afrouxar o limite por e-mail troca a proteção real por conveniência",
    );
  });

  it("por e-mail é mais apertado que por IP", () => {
    // A relação entre os dois é o desenho: muitas tentativas espalhadas por
    // contas diferentes são uma casa; muitas na mesma conta são um ataque.
    assert.ok(
      LOGIN_POR_EMAIL < LOGIN_POR_IP,
      `por e-mail (${LOGIN_POR_EMAIL}) precisa ser mais apertado que por IP (${LOGIN_POR_IP})`,
    );
  });

  it("em produção o multiplicador é 1, e não há como mudar", () => {
    // Já coberto em environment-hardening, e repetido aqui porque os números
    // acima só valem se o multiplicador valer.
    assert.equal(multiplicadorDeLimite(false, "200"), 1);
  });
});

describe("A mensagem diz quanto falta", () => {
  it("traz o número de minutos", () => {
    // Antes era "Aguarde antes de tentar novamente" — 15 minutos? uma hora? A
    // pessoa não tinha como saber, e nem quem escreveu o código soube quando o
    // fundador travou.
    const daquiA12 = new Date(Clock.now().getTime() + 12 * 60 * 1000);
    const texto = mensagemDeEspera("aparelho", daquiA12);

    assert.match(texto, /12 minutos/);
  });

  it("nunca promete zero, nem meio minuto", () => {
    // Arredondar para baixo faria a mensagem dizer "0 minutos", e quem
    // voltasse na hora levaria 429 de novo.
    const jaJa = new Date(Clock.now().getTime() + 3 * 1000);
    assert.match(mensagemDeEspera("conta", jaJa), /1 minuto\b/);
  });

  it("concorda em número — 1 minuto, 2 minutos", () => {
    const um = mensagemDeEspera("aparelho", new Date(Clock.now().getTime() + 30 * 1000));
    const dois = mensagemDeEspera("aparelho", new Date(Clock.now().getTime() + 90 * 1000));

    assert.match(um, /1 minuto\./);
    assert.match(dois, /2 minutos\./);
  });

  it("os dois limitadores dizem coisas diferentes", () => {
    // "deste aparelho" e "nesta conta" contam, de graça, se trocar de conta
    // adiantaria. Textos idênticos foi o que impediu o diagnóstico na hora.
    const porIp = mensagemDeEspera("aparelho", new Date(Clock.now().getTime() + 60_000));
    const porConta = mensagemDeEspera("conta", new Date(Clock.now().getTime() + 60_000));

    assert.notEqual(porIp, porConta);
    assert.match(porIp, /aparelho/);
    assert.match(porConta, /conta/);
  });

  it("sem o horário de liberação, ainda diz algo útil", () => {
    // `resetTime` é opcional no tipo do express-rate-limit. Uma mensagem vazia
    // ou um "NaN minutos" seria pior que o texto antigo.
    const texto = mensagemDeEspera("aparelho", undefined);

    assert.doesNotMatch(texto, /NaN|undefined/);
    assert.ok(texto.length > 20, `mensagem curta demais: ${texto}`);
  });

  it("a mensagem não confirma se a conta existe", () => {
    // O limitador por e-mail conta tentativa exista ou não a conta, então
    // "nesta conta" não é confirmação de cadastro. Este caso existe para que
    // ninguém "melhore" o texto para algo como "esta conta está bloqueada".
    const texto = mensagemDeEspera("conta", new Date(Clock.now().getTime() + 60_000));

    for (const proibido of ["cadastrad", "existe", "não encontrada", "bloqueada"]) {
      assert.doesNotMatch(
        texto.toLowerCase(),
        new RegExp(proibido),
        `"${proibido}" na mensagem contaria se o e-mail tem conta`,
      );
    }
  });
});
