/**
 * O servidor servindo o front — Issue #194.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SEM ISTO, O APP NÃO ABRE FORA DO REPLIT.
 *
 * Até a #194 quem roteava era a plataforma: o `.replit` tem
 * `router = "application"`, e o Replit mandava `/api` para o backend e todo o
 * resto para o estático do Vite. Em qualquer outro lugar — a AWS, um contêiner
 * local, a máquina de alguém — `GET /` devolvia 404.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que uma pasta temporária, e não o build de verdade ───────────────
 *
 * Porque o teste não pode depender de alguém ter rodado `pnpm run build`
 * antes. Uma pasta montada aqui, com um `index.html` reconhecível, prova a
 * mesma coisa e prova sempre.
 *
 * `FRONT_DIR` é lido no momento em que `app.ts` é avaliado, então ele é
 * definido ANTES do import — que por isso é dinâmico.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const MARCA_DO_INDEX = "<!-- o index do teste da #194 -->";
const CONTEUDO_DO_ASSET = "console.log('asset com hash no nome');";

const frontFalso = mkdtempSync(path.join(tmpdir(), "zelo-front-"));
mkdirSync(path.join(frontFalso, "assets"), { recursive: true });
writeFileSync(
  path.join(frontFalso, "index.html"),
  `<!doctype html><html><head><title>ZELO</title></head><body>${MARCA_DO_INDEX}</body></html>`,
);
writeFileSync(path.join(frontFalso, "assets", "index-abc123.js"), CONTEUDO_DO_ASSET);

process.env.FRONT_DIR = frontFalso;

// Import dinâmico: `app.ts` decide onde está o front no momento em que é
// avaliado, e um import estático seria içado para antes da linha acima.
const { default: app } = await import("../app.ts");

let porta: number;
let fechar: () => Promise<void>;

interface Resposta {
  status: number;
  corpo: string;
  cabecalhos: http.IncomingHttpHeaders;
}

function pedir(metodo: string, caminho: string): Promise<Resposta> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: "127.0.0.1", port: porta, path: caminho, method: metodo },
      (res) => {
        let dados = "";
        res.on("data", (c: Buffer) => (dados += c.toString()));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, corpo: dados, cabecalhos: res.headers }),
        );
      },
    );
    req.on("error", reject);
    req.end();
  });
}

before(async () => {
  await new Promise<void>((resolve, reject) => {
    const servidor = http.createServer(app);
    servidor.listen(0, "127.0.0.1", () => {
      porta = (servidor.address() as { port: number }).port;
      fechar = () =>
        new Promise((res, rej) => servidor.close((e) => (e ? rej(e) : res())));
      resolve();
    });
    servidor.on("error", reject);
  });
});

after(async () => {
  await fechar();
  rmSync(frontFalso, { recursive: true, force: true });
  delete process.env.FRONT_DIR;
});

describe("O front servido pelo proprio servidor", () => {
  it("a raiz devolve o app", async () => {
    const r = await pedir("GET", "/");
    assert.equal(r.status, 200);
    assert.ok(r.corpo.includes(MARCA_DO_INDEX));
  });

  it("uma tela interna recarregada devolve o app, e nao 404", async () => {
    /**
     * O roteamento é do lado do cliente: `/pacientes/3` não é um arquivo.
     * Sem o retorno do SPA, recarregar em qualquer tela interna daria 404 —
     * e recarregar é o primeiro reflexo de quem acha que o app travou.
     */
    for (const caminho of ["/pacientes/3", "/ajustes", "/pacientes/3/emergencia"]) {
      const r = await pedir("GET", caminho);
      assert.equal(r.status, 200, `${caminho} devia devolver o app`);
      assert.ok(r.corpo.includes(MARCA_DO_INDEX), `${caminho} devia devolver o index`);
    }
  });

  it("o arquivo com hash no nome e servido como arquivo", async () => {
    const r = await pedir("GET", "/assets/index-abc123.js");
    assert.equal(r.status, 200);
    assert.equal(r.corpo, CONTEUDO_DO_ASSET);
  });
});

describe("As rotas de API continuam sendo de API", () => {
  it("rota de API que nao existe devolve JSON, e nunca HTML", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * É O CASO QUE PROTEGE CONTRA O DEFEITO MUDO.
     *
     * Se o estático fosse montado ANTES das rotas de API, uma chamada de API
     * receberia o `index.html` com status 200 — e o cliente quebraria no
     * `JSON.parse` sem nenhuma pista de onde veio o problema.
     * ═════════════════════════════════════════════════════════════════════
     */
    const r = await pedir("GET", "/api/rota-que-nao-existe");
    assert.equal(r.status, 404);
    assert.match(r.cabecalhos["content-type"] ?? "", /application\/json/);
    assert.ok(!r.corpo.includes(MARCA_DO_INDEX));
    assert.equal((JSON.parse(r.corpo) as { error: string }).error, "Rota não encontrada");
  });

  it("a rota de saude continua respondendo, e nao vira o app", async () => {
    const r = await pedir("GET", "/api/healthz");
    // 200 com banco, 503 sem — o que importa aqui é que NÃO é o index.html.
    assert.ok(r.status === 200 || r.status === 503, `status inesperado: ${r.status}`);
    assert.ok(!r.corpo.includes(MARCA_DO_INDEX));
  });

  it("POST para caminho desconhecido nao devolve pagina", async () => {
    // O retorno do SPA é só GET. Um POST que virasse HTML com 200 esconderia
    // um erro de integração do cliente.
    const r = await pedir("POST", "/caminho-que-nao-existe");
    assert.ok(!r.corpo.includes(MARCA_DO_INDEX));
    assert.notEqual(r.status, 200);
  });
});

describe("O cache de cada tipo de arquivo", () => {
  it("o index NUNCA e cacheado", async () => {
    /**
     * O `index.html` aponta para os demais arquivos. Cacheá-lo prenderia a
     * pessoa numa versão antiga do app, apontando para arquivos que talvez
     * nem existam mais — e sem nenhuma forma de ela descobrir por quê.
     */
    for (const caminho of ["/", "/pacientes/3"]) {
      const r = await pedir("GET", caminho);
      assert.match(r.cabecalhos["cache-control"] ?? "", /no-cache/, caminho);
    }
  });

  it("o arquivo com hash no nome e cacheado para sempre", async () => {
    // O nome muda quando o conteúdo muda, então cache longo é seguro — e é o
    // que faz a segunda visita não baixar o app inteiro de novo.
    const r = await pedir("GET", "/assets/index-abc123.js");
    assert.match(r.cabecalhos["cache-control"] ?? "", /immutable/);
    assert.match(r.cabecalhos["cache-control"] ?? "", /max-age=31536000/);
  });
});

describe("Os cabecalhos de seguranca valem para o front tambem", () => {
  it("a pagina sai com as mesmas protecoes da API", async () => {
    // O middleware de segurança roda antes de tudo, mas quem serve arquivo
    // estático às vezes escapa dele. Num app em que um clique registra
    // medicação, a página é justamente o que não pode ir sem proteção.
    const r = await pedir("GET", "/");
    assert.equal(r.cabecalhos["x-frame-options"], "DENY");
    assert.equal(r.cabecalhos["x-content-type-options"], "nosniff");
    assert.equal(r.cabecalhos["referrer-policy"], "no-referrer");
  });
});
