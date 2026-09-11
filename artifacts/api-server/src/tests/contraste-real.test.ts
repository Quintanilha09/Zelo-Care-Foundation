/**
 * O contraste dos pares que as telas REALMENTE usam — Issue #149.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE ARQUIVO EXISTE, SEPARADO DO `tema-escuro.test.ts`
 *
 * Aquele mede os pares **oficiais**: cada `-bg` com o `-fg` da mesma cor.
 * É uma lista escrita à mão, e ela descreve o que quem escreveu o teste
 * **imaginou** que as telas fariam.
 *
 * As telas fazem outra coisa. Varrendo o código em 11/09/2026 apareceram
 * **24 combinações distintas** de fundo `zelo-*` com texto, e a maioria nem
 * declara cor de texto — herda `--foreground`. Nenhuma delas estava medida.
 *
 * O nome do paciente descoberto em `/pacientes` é exatamente uma dessas:
 * `bg-zelo-amber-bg` com texto herdado. Foi um dos dois casos que o fundador
 * fotografou.
 *
 * **Um piso de contraste que mede pares imaginados não sustenta nada.**
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── A lista sai do CÓDIGO ─────────────────────────────────────────────────
 *
 * Este arquivo varre os `.tsx` e monta a lista sozinho. Uma tela nova com uma
 * combinação nova entra na medição **sem ninguém lembrar de atualizar o
 * teste** — que é precisamente o modo como a lista escrita à mão envelheceu.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, basename } from "node:path";

const raiz = new URL("../../../../", import.meta.url);
const dirDoFront = fileURLToPath(new URL("artifacts/zelo/src", raiz));
const css = readFileSync(fileURLToPath(new URL("artifacts/zelo/src/index.css", raiz)), "utf8");

const AA = 4.5;
/** Piso da WCAG para texto grande. Ver `GRANDE`. */
const AA_GRANDE = 3;

// ── Ler os tokens dos dois temas ──────────────────────────────────────────

type Hsl = [number, number, number];

function trechoDoTema(escuro: boolean): string {
  const iDark = css.indexOf(".dark {");
  return escuro
    ? css.slice(iDark, css.indexOf("\n}", iDark))
    : css.slice(css.indexOf(":root {"), iDark);
}

/** `--zelo-amber-bg: 38 82% 95%` — o formato da camada de baixo (#148). */
function token(trecho: string, nome: string): Hsl | null {
  const m = trecho.match(new RegExp(`\\${nome}:\\s*([\\d.]+)\\s+([\\d.]+)%\\s+([\\d.]+)%`));
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

// ── Contraste WCAG ────────────────────────────────────────────────────────

function paraRgb([h, s, l]: Hsl): [number, number, number] {
  const sn = s / 100;
  const ln = l / 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = sn * Math.min(ln, 1 - ln);
  const f = (n: number) => ln - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}

function luminancia(rgb: [number, number, number]): number {
  const canal = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  return 0.2126 * canal(rgb[0]) + 0.7152 * canal(rgb[1]) + 0.0722 * canal(rgb[2]);
}

function contraste(a: [number, number, number], b: [number, number, number]): number {
  const [maior, menor] = [luminancia(a), luminancia(b)].sort((x, y) => y - x);
  return (maior + 0.05) / (menor + 0.05);
}

/**
 * Mistura uma cor translúcida sobre o que está atrás.
 *
 * `bg-zelo-green-bg/40` não pinta a cor cheia: pinta 40% dela sobre o que já
 * estava ali. Medir o contraste contra a cor cheia dá um número que ninguém
 * vê — e, pior, um número **otimista**, que é o tipo que deixa passar.
 */
function compor(
  frente: [number, number, number],
  atras: [number, number, number],
  alfa: number,
): [number, number, number] {
  return [
    frente[0] * alfa + atras[0] * (1 - alfa),
    frente[1] * alfa + atras[1] * (1 - alfa),
    frente[2] * alfa + atras[2] * (1 - alfa),
  ];
}

// ── Varrer o código atrás dos pares de verdade ────────────────────────────

interface Par {
  fundo: string;
  alfa: number;
  texto: string;
  grande: boolean;
  arquivos: Set<string>;
}

/** Classes `text-*` que são TAMANHO, não cor. */
const NAO_E_COR = /^text-(xs|sm|base|lg|xl|\d?xl|\[)/;

/**
 * Texto grande tem piso menor — 3:1 e não 4,5:1.
 *
 * É a regra da própria WCAG (texto ≥ 18,66px em negrito ou ≥ 24px), e não um
 * relaxamento nosso: letra grande já é legível com menos contraste. O botão
 * "Tomei" do modo idoso é `text-4xl` — exigir 4,5:1 dele obrigaria a escurecer
 * o verde a ponto de mudar a cor que **significa** "dose tomada".
 */
const GRANDE = /^text-(2xl|3xl|4xl|5xl|6xl|7xl|8xl|9xl)$/;

/**
 * Usos de fundo `zelo-*` em elementos que NÃO contêm texto.
 *
 * ── Por que uma lista explícita, e não heurística ────────────────────────
 *
 * A varredura lê strings de classe, não a árvore JSX: ela não tem como saber
 * se o elemento tem filho de texto. Sem esta lista, os pontinhos de status
 * entram na medição como se tivessem texto herdado — e a primeira execução
 * deste arquivo reprovou por isso, com dois falsos positivos: `StatusDot` é
 * um `<span>` de 8px, redondo e **vazio**, onde a cor É o dado.
 *
 * Lista curta e justificada é melhor que heurística silenciosa: quem
 * acrescentar um fundo `zelo-*` sem texto precisa dizer aqui por quê, e quem
 * puser texto num destes elementos vê o teste voltar a medi-lo.
 */
const SEM_TEXTO: Array<{ arquivo: string; porque: string }> = [
  {
    arquivo: "AdherenceCalendarPage.tsx",
    porque: "`StatusDot` é um <span> de 8px, redondo e vazio — a cor é o dado",
  },
  {
    arquivo: "StatusPage.tsx",
    porque: "o mesmo pontinho, ao lado do texto e não dentro dele",
  },
  {
    arquivo: "design-reference.tsx",
    porque: "catálogo de amostras de cor, não é tela de produto",
  },
];

/**
 * Telas que NÃO herdam o tema — medidas só no claro.
 *
 * O modo idoso e a ativação do aparelho do paciente pintam o fundo com
 * `bg-[#F8F7F5]` fixo: são sempre claras, por desenho (ZELO-40 e ZELO-58).
 * Medir o botão "Tomei" contra a paleta escura dá um número que ninguém vê.
 *
 * O `tema-escuro.test.ts` já guarda a outra metade disso — que elas não
 * passem a herdar o tema por acidente.
 */
const NAO_HERDA_O_TEMA = ["ElderModePage.tsx", "PatientAccessActivationPage.tsx"];

/**
 * Pares abaixo do piso que dependem de uma decisão que não é de engenharia.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ISTO NÃO É UMA EXCEÇÃO SILENCIOSA. É UMA DÍVIDA COM NÚMERO E DONO.
 *
 * Um par entra aqui quando o conserto é decisão de produto, não de código —
 * e entra **com o número atual como piso**: pode não melhorar, nunca piorar.
 *
 * ── Está vazia, e isso é o estado certo ─────────────────────────────────
 *
 * A única entrada que já existiu era `bg-zelo-green + text-white`, em
 * **3,25:1**. A decisão era do fundador porque o conserto mexe na identidade
 * visual; ele decidiu escurecer, e a **#151** pagou a dívida. O mecanismo
 * fica: o próximo par nesta situação precisa de piso, não de silêncio.
 * ══════════════════════════════════════════════════════════════════════════
 */
const DIVIDA_CONHECIDA: Array<{ par: string; naoPodeFicarAbaixoDe: number; issue: string }> = [];

function arquivosTsx(dir: string): string[] {
  const saida: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) saida.push(...arquivosTsx(p));
    else if (e.name.endsWith(".tsx")) saida.push(p);
  }
  return saida;
}

function paresDoCodigo(): Par[] {
  const mapa = new Map<string, Par>();

  for (const arquivo of arquivosTsx(dirDoFront)) {
    const txt = readFileSync(arquivo, "utf8");
    for (const m of txt.matchAll(/"([^"]*\bbg-zelo-[a-z-]+(?:\/\d+)?[^"]*)"/g)) {
      const classes = m[1]!.split(/\s+/);
      const classeDeFundo = classes.find((c) => /^bg-zelo-/.test(c));
      if (!classeDeFundo) continue;

      const [nomeDoFundo, alfaBruto] = classeDeFundo.replace("bg-", "").split("/");
      const alfa = alfaBruto ? Number(alfaBruto) / 100 : 1;

      // A cor do texto declarada no MESMO elemento. Sem nenhuma, o texto
      // herda `--foreground` — que é o caso da maioria, e era justamente o
      // que a lista escrita à mão não cobria.
      const corDoTexto =
        classes.find((c) => c.startsWith("text-") && !NAO_E_COR.test(c))?.replace("text-", "") ??
        "foreground";

      // Elemento declarado sem texto: a cor nao tem o que contrastar.
      if (SEM_TEXTO.some((x) => x.arquivo === basename(arquivo))) continue;

      const grande = classes.some((c) => GRANDE.test(c));
      const chave = `${classeDeFundo} + text-${corDoTexto}${grande ? " (grande)" : ""}`;
      if (!mapa.has(chave)) {
        mapa.set(chave, { fundo: nomeDoFundo!, alfa, texto: corDoTexto, grande, arquivos: new Set() });
      }
      mapa.get(chave)!.arquivos.add(basename(arquivo));
    }
  }

  return [...mapa.values()];
}

/** Resolve o nome de uma cor de classe no valor HSL do tema pedido. */
function corDe(nome: string, trecho: string): Hsl | null {
  if (nome === "white") return [0, 0, 100];
  if (nome === "black") return [0, 0, 0];
  // `zelo-amber-bg` → `--zelo-amber-bg`; `muted-foreground` → `--muted-foreground`.
  return token(trecho, `--${nome}`);
}

describe("Contraste dos pares que as telas usam", () => {
  /**
   * ═══════════════════════════════════════════════════════════════════════
   * COR DE FUNDO CRAVADA NAO SEGUE TEMA — Issue #156.
   *
   * O fundador abriu o login com o aparelho no escuro e viu um **cartao
   * escuro sobre fundo claro**: nao era nenhum dos dois temas, era metade de
   * cada. A pagina tinha a cor escrita a mao; o cartao usava `bg-card`, que
   * segue o tema.
   *
   * Estavam assim **oito telas** — todas as de antes de entrar no app:
   * login, consentimento, confirmacao de e-mail, redefinir senha, aceitar
   * convite, segundo fator, codigos de recuperacao e a tela de carregando.
   *
   * A incoerencia era antiga: enquanto a classe `.dark` nunca era aplicada,
   * `bg-card` era sempre branco e combinava. Ligar o tema (#138) revelou.
   * ═══════════════════════════════════════════════════════════════════════
   */
  it("nenhuma tela crava cor de fundo, fora as que nao herdam o tema", () => {
    const culpados: string[] = [];

    for (const arquivo of arquivosTsx(dirDoFront)) {
      const nome = basename(arquivo);
      // As duas de fundo fixo por desenho — mesma lista usada na medicao de
      // contraste, e pelo mesmo motivo.
      if (NAO_HERDA_O_TEMA.includes(nome)) continue;

      const txt = readFileSync(arquivo, "utf8");

      // Busca por TEXTO, e nao por expressao regular. A primeira versao deste
      // caso usava regex e ela nasceu quebrada — o `\b` inicial virou um
      // caractere de backspace literal no arquivo, e o padrao passou a nunca
      // casar. O caso ficou verde sem verificar nada, que e o defeito que
      // este arquivo existe para nao repetir. Descobri porque reintroduzi o
      // defeito de proposito e o teste continuou passando.
      //
      // `bg-[#` sao cinco caracteres sem metacaractere nenhum: nao ha o que
      // escapar, e nao ha como escapar errado.
      let i = txt.indexOf("bg-[#");
      while (i !== -1) {
        culpados.push(`${nome}: ${txt.slice(i, txt.indexOf("]", i) + 1)}`);
        i = txt.indexOf("bg-[#", i + 1);
      }
    }

    assert.deepEqual(
      culpados,
      [],
      "cor de fundo escrita a mao numa tela que deveria seguir o tema — use `bg-background` " +
        "(ou `bg-muted`, `bg-card`). Cravar a cor faz a pagina ficar clara enquanto os " +
        "componentes dentro dela escurecem, e foi assim que o login apareceu meio escuro.",
    );
  });

  it("a lista de pares sai do codigo, e nao esta vazia", () => {
    const pares = paresDoCodigo();
    // Se a varredura parar de achar (regex quebrada, pasta movida), o teste
    // passaria vazio e voltaria a não provar nada — que é o defeito que este
    // arquivo existe para não repetir.
    assert.ok(
      pares.length >= 15,
      `a varredura achou só ${pares.length} pares; em 11/09/2026 eram 24. ` +
        "Se as telas mudaram tanto assim, confirme; se não, a varredura quebrou.",
    );
  });

  for (const escuro of [false, true]) {
    const nomeDoTema = escuro ? "escuro" : "claro";

    it(`todo par real passa AA no tema ${nomeDoTema}`, () => {
      const trecho = trechoDoTema(escuro);
      const superficie = token(trecho, "--card");
      assert.ok(superficie, "não achei --card");

      const falhas: string[] = [];
      const naoResolvidos: string[] = [];

      for (const par of paresDoCodigo()) {
        // Tela de fundo fixo nao tem tema escuro para medir.
        if (escuro && [...par.arquivos].every((a) => NAO_HERDA_O_TEMA.includes(a))) continue;
        const fundo = corDe(par.fundo, trecho);
        const texto = corDe(par.texto, trecho);

        if (!fundo || !texto) {
          naoResolvidos.push(`bg-${par.fundo} + text-${par.texto}`);
          continue;
        }

        // O fundo translúcido é composto sobre o cartão, que é a superfície
        // mais comum atrás destes elementos.
        const fundoReal =
          par.alfa === 1
            ? paraRgb(fundo)
            : compor(paraRgb(fundo), paraRgb(superficie), par.alfa);

        const c = contraste(paraRgb(texto), fundoReal);
        const chave = `bg-${par.fundo} + text-${par.texto}`;

        // Dívida registrada: não bloqueia, mas não pode piorar.
        const divida = DIVIDA_CONHECIDA.find((d) => d.par === chave);
        if (divida) {
          if (c < divida.naoPodeFicarAbaixoDe) {
            falhas.push(
              `  ${chave}: ${c.toFixed(2)}:1 — PIOROU. A dívida da ${divida.issue} ` +
                `estava em ${divida.naoPodeFicarAbaixoDe}:1 e não pode descer.`,
            );
          }
          continue;
        }

        const piso = par.grande ? AA_GRANDE : AA;
        if (c < piso) {
          falhas.push(
            `  bg-${par.fundo}${par.alfa < 1 ? `/${par.alfa * 100}` : ""} + text-${par.texto}` +
              `${par.grande ? " (texto grande)" : ""}: ${c.toFixed(2)}:1, piso ${piso}:1 ` +
              `(${[...par.arquivos].join(", ")})`,
          );
        }
      }

      // Um par que não resolve é pior que um par que falha: ele sai da
      // medição em silêncio.
      assert.deepEqual(
        naoResolvidos,
        [],
        "cor usada numa tela e que não existe como token — a varredura não consegue medi-la",
      );

      assert.equal(
        falhas.length,
        0,
        `pares abaixo do piso AA de ${AA}:1 no tema ${nomeDoTema}:\n${falhas.join("\n")}\n` +
          "O público deste produto é idoso. Ajuste o VALOR do token, nunca o piso.",
      );
    });
  }

  /**
   * ═══════════════════════════════════════════════════════════════════════
   * O BOTÃO DE AÇÃO — Issue #151.
   *
   * A varredura acima só enxerga classes `bg-zelo-*`. O botão primário usa
   * `bg-primary text-primary-foreground`, e por isso **o par mais usado do
   * app nunca foi medido** — a dívida da #151 só apareceu por um proxy
   * (`bg-zelo-green + text-white`, num único arquivo).
   *
   * Aqui ele é medido direto, e nas TRÊS relações que precisam valer juntas:
   *
   *   1. o rótulo contra o botão  (texto: piso AA)
   *   2. o botão contra a página  (componente: piso 3:1, WCAG 1.4.11)
   *   3. o botão contra o cartão  (idem — botão dentro de cartão é o comum)
   *
   * ── Por que as três, e não só a primeira ───────────────────────────────
   *
   * Porque elas **puxam para lados opostos**, e foi isso que a #151
   * descobriu. No tema escuro, escurecer o verde até o branco passar em (1)
   * derrubava (3) para 2,77:1: rótulo legível dentro de um botão que some no
   * fundo. A saída foi clarear o verde e escurecer a tinta — o inverso do
   * tema claro, mesma regra.
   *
   * Um teste só de (1) teria aprovado aquele beco.
   * ═══════════════════════════════════════════════════════════════════════
   */
  for (const escuro of [false, true]) {
    const nomeDoTema = escuro ? "escuro" : "claro";

    it(`o botao de acao se le e se ve no tema ${nomeDoTema}`, () => {
      const trecho = trechoDoTema(escuro);
      const pegar = (nome: string) => {
        const v = token(trecho, nome);
        assert.ok(v, `${nome} precisa existir no tema ${nomeDoTema}`);
        return paraRgb(v);
      };

      const botao = pegar("--primary");
      const rotulo = pegar("--primary-foreground");
      const pagina = pegar("--background");
      const cartao = pegar("--card");

      const medidas = [
        { o: "o rótulo sobre o botão", valor: contraste(rotulo, botao), piso: AA },
        { o: "o botão contra a página", valor: contraste(botao, pagina), piso: AA_GRANDE },
        { o: "o botão contra o cartão", valor: contraste(botao, cartao), piso: AA_GRANDE },
      ];

      const abaixo = medidas
        .filter((m) => m.valor < m.piso)
        .map((m) => `  ${m.o}: ${m.valor.toFixed(2)}:1, piso ${m.piso}:1`);

      assert.deepEqual(
        abaixo,
        [],
        `o botão primário do tema ${nomeDoTema} não fecha:\n${abaixo.join("\n")}\n` +
          "As três medidas puxam para lados opostos. Se escurecer o botão " +
          "para o rótulo passar derrubar a separação do cartão, a saída é a " +
          "outra ponta: clarear o botão e escurecer o rótulo (ver o tema " +
          "escuro). Ajuste o VALOR do token, nunca o piso.",
      );
    });

    /**
     * ═════════════════════════════════════════════════════════════════════
     * O ÍCONE DE "ATRASADO" — Issue #160.
     *
     * A varredura lê a classe de fundo e a classe de texto **do mesmo
     * elemento**. O ícone é elemento-filho do selo, então ele não entra —
     * e é justamente o único vermelho que existe em contexto de dose.
     *
     * O fundo real dele não é `--zelo-amber`: é `bg-zelo-amber/20`
     * **composto sobre o cartão**. Medir contra o âmbar cheio daria um
     * número que ninguém vê.
     * ═════════════════════════════════════════════════════════════════════
     */
    it(`o icone de atrasado se ve sobre o selo no tema ${nomeDoTema}`, () => {
      const trecho = trechoDoTema(escuro);
      const pegar = (nome: string) => {
        const v = token(trecho, nome);
        assert.ok(v, `${nome} precisa existir no tema ${nomeDoTema}`);
        return v;
      };

      const selo = compor(paraRgb(pegar("--zelo-amber")), paraRgb(pegar("--card")), 0.2);
      const c = contraste(paraRgb(pegar("--zelo-atraso")), selo);

      // Piso de ícone é 3:1 (WCAG 1.4.11), mas o token é medido contra AA:
      // a palavra "Atrasado" fica ao lado dele, e um ícone visivelmente mais
      // fraco que o texto que acompanha lê-se como decoração.
      assert.ok(
        c >= AA,
        `o ícone de "Atrasado" mede ${c.toFixed(2)}:1 sobre o selo no tema ` +
          `${nomeDoTema}, abaixo de ${AA}:1. Ajuste --zelo-atraso, nunca o piso.`,
      );

      // O fundador pediu "cuidado para que não fique muito forte", e o
      // recorte da #160 é o que mantém o invariante 5 de pé: o vermelho é
      // ACENTO de ícone. Se ele virar a cor do estado, isto reprova.
      assert.notDeepEqual(
        token(trecho, "--zelo-atraso"),
        token(trecho, "--destructive"),
        "--zelo-atraso não pode ser o --destructive: destrutivo é apagar e " +
          "cancelar, e dose atrasada não é nenhum dos dois",
      );
    });

    /**
     * `--zelo-green` **é** o verde da marca, e `--primary` também. Já
     * divergiram uma vez — entre a #138 e a #149 —, e o mesmo verde passou a
     * ter dois valores conforme a classe. Isto trava os dois juntos.
     */
    it(`o verde da marca e um so no tema ${nomeDoTema}`, () => {
      const trecho = trechoDoTema(escuro);
      assert.deepEqual(
        token(trecho, "--zelo-green"),
        token(trecho, "--primary"),
        `no tema ${nomeDoTema}, --zelo-green e --primary precisam ser o mesmo ` +
          "valor: são a mesma cor de marca, e separá-los faz o botão de " +
          "compartilhar e o botão primário ficarem em verdes diferentes",
      );
    });
  }
});
