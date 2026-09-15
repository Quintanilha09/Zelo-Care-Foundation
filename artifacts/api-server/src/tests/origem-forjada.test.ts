/**
 * A chave do limitador por IP — Issue #207.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O `limitador-de-login.test.ts` trava os NÚMEROS. Este trava a CHAVE.
 *
 * São defeitos diferentes, e o segundo é pior: um limite errado deixa a porta
 * mais larga; uma chave errada tira a porta do lugar. Até 14/09/2026 os
 * limitadores liam o `X-Forwarded-For` cru e pegavam o PRIMEIRO valor — o que
 * o cliente escreveu. Trocar o cabeçalho a cada tentativa dava um balde novo a
 * cada requisição.
 *
 * Nenhum dos 977 testes reprovava por isso. O limite dizia 5, o teste conferia
 * que dizia 5, e na prática não havia limite nenhum.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Como o cenário é montado ──────────────────────────────────────────────
 *
 * O balanceador da AWS ACRESCENTA o IP de quem se conectou a ele, à direita do
 * que já veio. Então um atacante que manda `X-Forwarded-For: 9.9.9.9` faz o
 * app receber `9.9.9.9, <ip real dele>`.
 *
 * É esse formato que os casos abaixo enviam. Eles sobem um Express de verdade,
 * com o mesmo `trust proxy` do `app.ts`, e batem no limitador real.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import express from "express";
import http from "node:http";

/**
 * O multiplicador é fixado em 1 ANTES do import, e isso não é detalhe.
 *
 * Fora de produção os limites são multiplicados para não atrapalhar quem
 * desenvolve — o padrão é 10, e a suíte de tela usa 200. `rate-limit.ts` lê a
 * variável UMA vez, no momento em que é avaliado, então declarar aqui é o que
 * torna este arquivo determinístico: sem isto, o limite do admin seria 50 ou
 * 1000 conforme o ambiente, e o caso abaixo passaria ou falharia por acaso.
 *
 * Em produção esta variável é ignorada por construção, então fixá-la aqui não
 * afrouxa nada em lugar nenhum.
 */
process.env.RATE_LIMIT_MULTIPLIER = "1";

// Import dinâmico pelo motivo acima: um import estático seria içado para antes
// da linha que define a variável.
const { adminLoginLimiter, origemDaRequisicao } = await import("../lib/rate-limit.ts");

/** O limite do painel operacional, declarado em `rate-limit.ts`. */
const LIMITE_DO_ADMIN = 5;

/** Como o balanceador entrega: o que o cliente escreveu, e o IP real à direita. */
function comoOBalanceadorEntrega(escritoPeloCliente: string, ipReal: string): string {
  return `${escritoPeloCliente}, ${ipReal}`;
}

let porta: number;
let fechar: () => Promise<void>;

before(async () => {
  const app = express();
  // O mesmo valor do `app.ts`. É ele que faz `req.ip` ler a lista pelo lado
  // certo — sem isto, o teste não estaria medindo o app de verdade.
  app.set("trust proxy", 1);
  app.post("/alvo", adminLoginLimiter, (req, res) => {
    res.status(200).json({ ok: true, origem: req.ip });
  });

  const servidor = http.createServer(app);
  await new Promise<void>((resolve, reject) => {
    servidor.listen(0, "127.0.0.1", resolve);
    servidor.on("error", reject);
  });
  porta = (servidor.address() as { port: number }).port;
  fechar = () => new Promise((res, rej) => servidor.close((e) => (e ? rej(e) : res())));
});

after(async () => {
  await fechar();
});

function bater(xff: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: porta,
        path: "/alvo",
        method: "POST",
        headers: { "x-forwarded-for": xff },
      },
      (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      },
    );
    req.on("error", reject);
    req.end();
  });
}

describe("A origem que o limitador conta", () => {
  it("trocar o X-Forwarded-For a cada tentativa NAO ganha balde novo", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * É O CASO INTEIRO DESTA ISSUE, E ELE REPROVA NO CÓDIGO DE ONTEM.
     *
     * Medido em 14/09/2026, antes da correção: sete requisições com um valor
     * forjado diferente a cada vez devolviam `200` sete vezes. O limitador
     * nunca disparava.
     * ═════════════════════════════════════════════════════════════════════
     */
    const IP_REAL = "203.0.113.50";
    const respostas: number[] = [];

    for (let i = 0; i < LIMITE_DO_ADMIN + 2; i++) {
      respostas.push(await bater(comoOBalanceadorEntrega(`10.0.0.${i}`, IP_REAL)));
    }

    assert.ok(
      respostas.includes(429),
      `o limitador nunca disparou: ${respostas.join(", ")}. ` +
        "Trocar o X-Forwarded-For a cada tentativa está dando um balde novo a " +
        "cada requisição — a proteção por IP não existe.",
    );
  });

  it("dois aparelhos de verdade continuam com baldes separados", async () => {
    /**
     * A correção não pode virar o oposto: se todo mundo caísse num balde só,
     * uma família seria trancada por um desconhecido — e isso encosta no
     * invariante 6 do produto, porque registrar dose depende de entrar.
     *
     * Este caso reprovaria se alguém "consertasse" fixando a chave.
     */
    const OUTRO_IP = "198.51.100.77";
    const resposta = await bater(comoOBalanceadorEntrega("qualquer-coisa", OUTRO_IP));

    assert.equal(
      resposta,
      200,
      "um IP real diferente foi bloqueado pelo consumo de outro — a chave " +
        "deixou de distinguir aparelhos",
    );
  });
});

describe("A funcao que decide a origem", () => {
  it("usa o req.ip, e nao o cabecalho cru", () => {
    // `req.ip` é o valor que o Express apura a partir do `trust proxy`. O
    // cabeçalho aqui é o oposto dele de propósito: se a função olhasse o
    // cabeçalho, o retorno seria o valor forjado.
    const fingido = {
      ip: "203.0.113.50",
      headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.50" },
      socket: { remoteAddress: "10.1.1.1" },
    } as unknown as Parameters<typeof origemDaRequisicao>[0];

    assert.equal(origemDaRequisicao(fingido), "203.0.113.50");
  });

  it("sem req.ip, cai no socket — nunca no cabecalho", () => {
    const fingido = {
      ip: undefined,
      headers: { "x-forwarded-for": "9.9.9.9" },
      socket: { remoteAddress: "10.1.1.1" },
    } as unknown as Parameters<typeof origemDaRequisicao>[0];

    assert.equal(origemDaRequisicao(fingido), "10.1.1.1");
  });

  it("sem nada, falha FECHADO: um balde so, que estoura rapido", () => {
    // Quando não dá para saber quem está chamando, recusar cedo é o lado
    // certo do erro. Deixar passar seria transformar a incerteza em brecha.
    const fingido = {
      ip: undefined,
      headers: {},
      socket: {},
    } as unknown as Parameters<typeof origemDaRequisicao>[0];

    assert.equal(origemDaRequisicao(fingido), "sem-origem");
  });
});

describe("O guardrail contra a volta do defeito", () => {
  it("nenhum limitador le o X-Forwarded-For direto do cabecalho", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * O CASO ACIMA PROVA QUE HOJE ESTÁ CERTO. ESTE IMPEDE QUE VOLTE.
     *
     * A leitura crua é fácil de reintroduzir: parece a coisa óbvia, e num
     * teste local — sem balanceador na frente — funciona. O defeito só
     * aparece em produção, que é o pior lugar para descobrir.
     * ═════════════════════════════════════════════════════════════════════
     */
    const { readFile } = await import("node:fs/promises");
    const { fileURLToPath } = await import("node:url");
    const path = await import("node:path");

    const arquivo = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "lib",
      "rate-limit.ts",
    );
    const fonte = await readFile(arquivo, "utf-8");

    // Fora os comentários: o cabeçalho é citado de propósito na explicação do
    // defeito, e essa citação precisa continuar podendo existir.
    const semComentarios = fonte
      .split("\n")
      .filter((linha) => !/^\s*(\*|\/\/|\/\*)/.test(linha))
      .join("\n");

    assert.ok(
      !semComentarios.includes('headers["x-forwarded-for"]'),
      "voltou a leitura crua do X-Forwarded-For em rate-limit.ts. Use " +
        "origemDaRequisicao(req), que respeita o trust proxy do app.ts — " +
        "ver Issue #207.",
    );
  });
});
