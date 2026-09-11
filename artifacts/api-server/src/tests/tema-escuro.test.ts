/**
 * O tema escuro, medido — Issue #138.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE UM TESTE DE CSS NA SUÍTE DO SERVIDOR
 *
 * Porque é aqui que a suíte varre **código-fonte** procurando padrão inseguro
 * — o mesmo lugar que impede `NODE_ENV !== "production"` de voltar
 * (`environment-hardening.test.ts`) e que confere o `test:all` contra o
 * disco. Não há banco nem rede envolvidos: é leitura de arquivo e aritmética.
 *
 * O Playwright prova que o tema ACENDE. Este arquivo prova que ele acende
 * **com as cores certas**, e é o único lugar onde o número do contraste é
 * calculado em vez de acreditado.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que ele impede ─────────────────────────────────────────────────────
 *
 *   1. Um token `zelo-*` entrar no app sem valor no escuro. Foi exatamente
 *      esse o buraco: o bloco `.dark` existia desde a fundação e os oito
 *      tokens de significado clínico não estavam nele. Acender assim faria
 *      o cartão de dose pendente virar um retângulo branco no fundo escuro.
 *   2. Um par de texto cair abaixo de **WCAG AA (4,5:1)**. O público é
 *      idoso; "parece bom" não é verificação.
 *   3. O modo idoso passar a herdar o tema. Ele tem desenho travado de alto
 *      contraste (ZELO-40) e não pode escurecer por acidente.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = new URL("../../../../", import.meta.url);
const css = readFileSync(fileURLToPath(new URL("artifacts/zelo/src/index.css", raiz)), "utf8");

/**
 * Os tokens que carregam SIGNIFICADO — verde é dose tomada, âmbar é pendente.
 *
 * Desde a #148 estes são os nomes da **camada de baixo**: o `@theme inline`
 * expõe `--color-zelo-*` como `hsl(var(--zelo-*))`, e é o valor de baixo que
 * o `.dark` troca. Ver o caso `nenhum token de dose pode ter valor literal`.
 */
const TOKENS_COM_SIGNIFICADO = [
  "--zelo-green",
  "--zelo-green-fg",
  "--zelo-green-bg",
  "--zelo-amber",
  "--zelo-amber-fg",
  "--zelo-amber-bg",
  "--zelo-measure",
  "--zelo-measure-bg",
];

/** O bloco `.dark { … }` inteiro, para saber o que ele redefine. */
function blocoEscuro(): string {
  const i = css.indexOf(".dark {");
  assert.ok(i >= 0, "o bloco .dark sumiu do index.css");
  const fim = css.indexOf("\n}", i);
  assert.ok(fim > i, "o bloco .dark não fecha");
  return css.slice(i, fim);
}

// ── Contraste WCAG. A conta é curta, e o número precisa ser reprodutível. ──

function paraRgb([h, s, l]: [number, number, number]): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminancia(cor: [number, number, number]): number {
  const canal = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = paraRgb(cor);
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

function contraste(a: [number, number, number], b: [number, number, number]): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (maior + 0.05) / (menor + 0.05);
}

/** `--background: 40 5% 15%` — sem `hsl()`, é o formato dos tokens de base. */
function baseHsl(trecho: string, token: string): [number, number, number] {
  const m = trecho.match(new RegExp(`${token}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  assert.ok(m, `não achei ${token}`);
  return [Number(m![1]), Number(m![2]), Number(m![3])];
}

const AA = 4.5;

describe("Tema escuro", () => {
  /**
   * ═════════════════════════════════════════════════════════════════════════
   * O CASO QUE FALTAVA, E QUE TERIA POUPADO A #148.
   *
   * Os outros cinco casos deste arquivo passaram verdes enquanto o modo
   * escuro estava **inteiramente morto** nas cores de dose. Eles liam a
   * INTENÇÃO — "o `.dark` define os oito tokens", "os pares passam AA" — e
   * as duas coisas eram verdade na fonte.
   *
   * O que nenhum deles verificava era se o `.dark` **chega ao navegador**.
   *
   * A causa era o `@theme inline`: ele escreve o valor direto na regra, e um
   * token declarado com literal sai compilado como `background-color:#fdf5e8`.
   * Cor congelada, `.dark` ignorado, 21 utilitários e 131 usos com a cor do
   * tema claro — e o fundador vendo o cartão de dose branco num app escuro.
   *
   * Este caso verifica a **causa mecânica**, não a intenção: nenhum token de
   * cor dentro do `@theme inline` pode ter valor literal. Enquanto essa regra
   * valer, o override necessariamente chega.
   * ═════════════════════════════════════════════════════════════════════════
   */
  it("nenhum token de cor pode ter valor literal dentro do @theme inline", () => {
    const i = css.indexOf("@theme inline {");
    assert.ok(i >= 0, "o bloco @theme inline sumiu do index.css");
    const bloco = css.slice(i, css.indexOf("\n}", i));

    const literais: string[] = [];
    for (const linha of bloco.split("\n")) {
      const m = linha.match(/^\s*(--color-[a-z0-9-]+):\s*(.+?);/);
      if (!m) continue;
      // O que salva um token é haver uma variável DENTRO dele: é ela que o
      // `.dark` troca depois. Sem `var(`, o valor está congelado no build.
      if (!m[2]!.includes("var(")) literais.push(`${m[1]} = ${m[2]}`);
    }

    assert.deepEqual(
      literais,
      [],
      "token de cor com valor literal dentro de `@theme inline` — o Tailwind vai inliná-lo, " +
        "e nenhuma troca de tema o alcança. Declare como `hsl(var(--x))` e ponha o valor " +
        "no `:root` e no `.dark`, como todo o resto do arquivo faz. Foi assim que o modo " +
        "escuro do ZELO ficou morto entre a #138 e a #148.",
    );
  });

  it("todo token de SIGNIFICADO tem valor proprio no escuro", () => {
    const escuro = blocoEscuro();
    const faltando = TOKENS_COM_SIGNIFICADO.filter((t) => !escuro.includes(`${t}:`));
    assert.deepEqual(
      faltando,
      [],
      "estes tokens carregam significado clínico e ficariam com o valor do tema CLARO no escuro — " +
        "`--color-zelo-amber-bg` é quase branco, e o cartão de dose pendente viraria um retângulo claro",
    );
  });

  it("todo par de texto passa o piso AA de 4,5:1", () => {
    const escuro = blocoEscuro();
    const fundo = baseHsl(escuro, "--background");
    const cartao = baseHsl(escuro, "--card");

    const pares: Array<[string, [number, number, number], [number, number, number]]> = [
      ["amber-fg sobre amber-bg", baseHsl(escuro, "--zelo-amber-fg"), baseHsl(escuro, "--zelo-amber-bg")],
      ["green-fg sobre green-bg", baseHsl(escuro, "--zelo-green-fg"), baseHsl(escuro, "--zelo-green-bg")],
      ["measure sobre measure-bg", baseHsl(escuro, "--zelo-measure"), baseHsl(escuro, "--zelo-measure-bg")],
      ["amber-fg sobre o fundo", baseHsl(escuro, "--zelo-amber-fg"), fundo],
      ["green-fg sobre o fundo", baseHsl(escuro, "--zelo-green-fg"), fundo],
      ["amber-fg sobre o cartão", baseHsl(escuro, "--zelo-amber-fg"), cartao],
      ["green-fg sobre o cartão", baseHsl(escuro, "--zelo-green-fg"), cartao],
    ];

    for (const [nome, texto, atras] of pares) {
      const c = contraste(texto, atras);
      assert.ok(
        c >= AA,
        `${nome}: ${c.toFixed(2)}:1 — abaixo do piso AA de ${AA}:1. O público deste produto é idoso.`,
      );
    }
  });

  it("o tema CLARO tambem passa — foi onde o buraco estava", () => {
    // Medido ao derivar o escuro: `amber-fg` a 35% dava 4,1:1 sobre o
    // `amber-bg`, **abaixo do piso**, e ninguém tinha medido. Corrigido para
    // 32%. Este caso impede a volta.
// O trecho do `:root`, que e onde os valores do tema claro moram desde a
// #148 — antes eles estavam no `@theme`, e era justamente isso que os
// congelava.
    const tema = css.slice(css.indexOf(":root {"), css.indexOf(".dark {"));
    const c = contraste(baseHsl(tema, "--zelo-amber-fg"), baseHsl(tema, "--zelo-amber-bg"));
    assert.ok(c >= AA, `amber-fg sobre amber-bg no claro: ${c.toFixed(2)}:1 — abaixo de ${AA}:1`);
  });

  it("o modo idoso NAO herda o tema", () => {
    // ZELO-40: tela única, letra grande, alto contraste travado. Ela usa cor
    // fixa de propósito — se alguém "melhorar" para tokens, ela passa a
    // escurecer junto, e o desenho que foi calibrado para quem enxerga mal
    // deixa de ser o que foi calibrado.
    const elder = readFileSync(
      fileURLToPath(new URL("artifacts/zelo/src/pages/ElderModePage.tsx", raiz)),
      "utf8",
    );
    const comTema = elder.match(/\b(bg-background|text-foreground|bg-card|text-card-foreground)\b/g);
    assert.equal(
      comTema,
      null,
      `o modo idoso passou a usar token de tema (${comTema?.join(", ")}) — ele escureceria junto, ` +
        "e o alto contraste da ZELO-40 é travado de propósito",
    );
  });

  it("o tema e aplicado antes da primeira pintura", () => {
    // Script inline no `head`. Qualquer coisa feita depois — React, efeito,
    // módulo importado — acontece depois de o navegador já ter pintado a
    // página clara: o lampejo branco a cada abertura. Para quem pediu o modo
    // noturno porque a vista dói, é o problema acontecendo de novo.
    const html = readFileSync(fileURLToPath(new URL("artifacts/zelo/index.html", raiz)), "utf8");
    const cabeca = html.slice(0, html.indexOf("</head>"));
    assert.ok(
      cabeca.includes("zelo_tema"),
      "o script que aplica o tema precisa estar inline no <head>, antes do body",
    );
  });
});
