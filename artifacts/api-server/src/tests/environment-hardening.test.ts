/**
 * Blindagem de ambiente — auditoria de segurança de 21/08/2026.
 *
 * O achado mais grave da auditoria não foi uma linha errada: foi um PADRÃO
 * errado. Cinco proteções perguntavam `process.env.NODE_ENV !== "production"`
 * pra decidir se afrouxavam. Como `undefined !== "production"` é verdadeiro,
 * um ambiente que só esquece de definir a variável — exatamente o deploy do
 * Replit — rodava com todas elas desligadas:
 *
 *   - rotas de manipulação do relógio expostas, SEM autenticação
 *   - verificação de e-mail pulada no cadastro
 *   - token de verificação e link de reset escritos no log
 *   - rate limit de login 10× mais frouxo
 *   - mensagem de erro interna devolvida ao cliente
 *
 * Estes testes travam a regra nova: só um valor EXPLÍCITO de development ou
 * test libera atalho; qualquer outra coisa (inclusive ausência) é produção.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const ler = (caminho: string) => readFileSync(`${raiz}${caminho}`, "utf8");

/**
 * Simula um processo de PRODUÇÃO de verdade: sem NODE_ENV e sem o
 * NODE_TEST_CONTEXT que o próprio test runner injeta. Sem apagar os dois,
 * o teste rodaria como "teste" e não provaria nada sobre produção.
 */
async function comAmbiente(nodeEnv: string | undefined, fn: (env: typeof import("../lib/environment.ts")) => void): Promise<void> {
  const origEnv = process.env.NODE_ENV;
  const origCtx = process.env.NODE_TEST_CONTEXT;
  try {
    if (nodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = nodeEnv;
    delete process.env.NODE_TEST_CONTEXT;
    // cache-buster: o módulo lê as variáveis no momento da carga
    fn(await import(`../lib/environment.ts?v=${Math.random()}`));
  } finally {
    if (origEnv === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = origEnv;
    if (origCtx === undefined) delete process.env.NODE_TEST_CONTEXT; else process.env.NODE_TEST_CONTEXT = origCtx;
  }
}

describe("Ambiente: na dúvida, é produção", () => {
  it("ausência de NODE_ENV significa PRODUÇÃO, não desenvolvimento", async () => {
    await comAmbiente(undefined, (env) => {
      assert.equal(env.IS_PRODUCTION, true, "sem NODE_ENV o app PRECISA se considerar em produção");
      assert.equal(env.allowsDevelopmentShortcuts(), false, "sem NODE_ENV nenhum atalho de dev pode ser liberado");
    });
  });

  it("valor desconhecido ou vazio também é tratado como produção", async () => {
    for (const valor of ["", "prod", "staging", "producao", "DEV "]) {
      await comAmbiente(valor, (env) => {
        assert.equal(
          env.allowsDevelopmentShortcuts(),
          false,
          `NODE_ENV="${valor}" não pode liberar atalho de desenvolvimento`
        );
      });
    }
  });

  it("o test runner do Node é reconhecido mesmo sem NODE_ENV", async () => {
    // É isto que permite os testes rodarem sem depender de `NODE_ENV=cmd`,
    // sintaxe que o shell do Windows não entende.
    const env = await import(`../lib/environment.ts?runner=${Math.random()}`);
    assert.equal(env.IS_TEST, true, "rodando sob node --test, IS_TEST precisa ser true");
  });

  it("só 'development' e 'test' liberam atalho", async () => {
    const original = process.env.NODE_ENV;
    try {
      for (const valor of ["development", "test"]) {
        process.env.NODE_ENV = valor;
        const env = await import(`../lib/environment.ts?ok=${valor}${Date.now()}`);
        assert.equal(env.allowsDevelopmentShortcuts(), true, `NODE_ENV="${valor}" deveria liberar atalho`);
        assert.equal(env.IS_PRODUCTION, false);
      }
    } finally {
      if (original === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = original;
    }
  });
});

/**
 * Varredura do código-fonte. Um teste de comportamento não pega uma
 * checagem nova escrita do jeito antigo num arquivo qualquer — esta
 * varredura pega, e é o que impede o padrão de voltar por descuido.
 */
describe("Nenhuma checagem de ambiente no formato inseguro", () => {
  const ARQUIVOS = [
    "app.ts",
    "routes/index.ts",
    "routes/auth.ts",
    "lib/email.ts",
    "lib/logger.ts",
    "lib/rate-limit.ts",
  ];

  it("ninguém compara NODE_ENV diretamente — todos usam lib/environment.ts", () => {
    const infratores: string[] = [];
    for (const arquivo of ARQUIVOS) {
      const conteudo = ler(arquivo);
      // Ignora comentários, que explicam justamente por que a forma antiga é ruim.
      const semComentarios = conteudo
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/[^\n]*/g, "");
      if (/process\.env\.NODE_ENV\s*[!=]==?/.test(semComentarios)) {
        infratores.push(arquivo);
      }
    }
    assert.deepEqual(
      infratores,
      [],
      `Estes arquivos comparam NODE_ENV direto. Use allowsDevelopmentShortcuts()/IS_PRODUCTION de lib/environment.ts, que trata ausência como produção: ${infratores.join(", ")}`
    );
  });

  it("nenhum segredo é interpolado em mensagem de log", () => {
    // safeLog sanitiza o CONTEXTO (1º argumento), nunca a MENSAGEM (2º).
    // Um token interpolado na mensagem contorna a proteção inteira — foi
    // o que acontecia no cadastro com o token de verificação de e-mail.
    const suspeitos = /\$\{(\w*(token|Token|senha|password|secret|Secret|hash|Hash)\w*)\}/;
    const infratores: string[] = [];
    for (const arquivo of ["routes/auth.ts", "routes/google-auth.ts", "routes/invites.ts", "routes/patient-access.ts"]) {
      for (const linha of ler(arquivo).split("\n")) {
        if (/safeLog\.|logger\./.test(linha) && suspeitos.test(linha)) {
          infratores.push(`${arquivo}: ${linha.trim().slice(0, 80)}`);
        }
      }
    }
    assert.deepEqual(infratores, [], `Segredo interpolado em log:\n${infratores.join("\n")}`);
  });
});

describe("Cabeçalhos de segurança e CORS", () => {
  it("CORS não é aberto pra qualquer origem", () => {
    const app = ler("app.ts");
    assert.ok(
      !/app\.use\(\s*cors\(\s*\)\s*\)/.test(app),
      "cors() sem argumento devolve Access-Control-Allow-Origin: * — qualquer site poderia chamar a API"
    );
    assert.match(app, /origin\s*\(/, "o CORS precisa decidir a origem explicitamente");
  });

  it("os cabeçalhos de segurança essenciais são definidos", () => {
    const app = ler("app.ts");
    for (const cabecalho of ["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]) {
      assert.match(app, new RegExp(cabecalho), `falta o cabeçalho ${cabecalho}`);
    }
  });

  it("o corpo da requisição tem limite explícito", () => {
    const app = ler("app.ts");
    assert.match(app, /express\.json\(\s*\{[^}]*limit/, "express.json() precisa de limite explícito");
  });
});

/**
 * Consistência da própria suíte — guardrail adicionado em 21/08/2026.
 *
 * O commit `270b9de` deixou no `test:all` uma referência a
 * `patient-role-matrix.test.ts`, arquivo que nunca existiu em nenhuma
 * branch (resíduo de uma resolução de conflito que preservou a referência
 * sem o arquivo). Resultado: `tsx --test` saía com código 1 e a suíte
 * inteira ficou quebrada no main, sem ninguém perceber — e o CI que estava
 * sendo montado teria falhado por isso.
 *
 * Este teste fecha os DOIS lados do problema:
 *   - referência a arquivo que não existe (quebra a suíte);
 *   - arquivo de teste que existe mas ficou fora da suíte (roda no
 *     desenvolvimento, nunca no CI — pior, porque falha em silêncio).
 */
describe("Consistência da suíte de testes", () => {
  const pkg = JSON.parse(ler("../package.json")) as { scripts: Record<string, string> };
  // O fallback precisa ser tipado: com `?? []` puro, o TypeScript infere
  // `never[]` e o `.includes(string)` abaixo vira erro de tipo.
  const referenciados: string[] = pkg.scripts["test:all"].match(/src\/tests\/[a-z0-9-]+\.test\.ts/g) ?? [];

  it("todo teste referenciado no test:all existe no disco", () => {
    const faltando = referenciados.filter((caminho) => !existsSync(`${raiz}${caminho.replace("src/", "")}`));
    assert.deepEqual(faltando, [] as string[], `test:all aponta pra arquivo inexistente — a suíte inteira falha: ${faltando.join(", ")}`);
  });

  it("todo arquivo .test.ts está registrado no test:all", () => {
    const noDisco = readdirSync(`${raiz}tests`)
      .filter((f) => f.endsWith(".test.ts"))
      .map((f) => `src/tests/${f}`);
    const foraDaSuite = noDisco.filter((caminho) => !referenciados.includes(caminho));
    assert.deepEqual(foraDaSuite, [] as string[], `teste existe mas não roda no test:all (falha silenciosa): ${foraDaSuite.join(", ")}`);
  });
});

describe("Endpoints caros e sensíveis têm rate limit", () => {
  const CASOS: Array<[string, string, string]> = [
    ["routes/medication-photos.ts", "photoExtractionLimiter", "extração por foto chama a API PAGA da Anthropic"],
    ["routes/admin.ts", "adminLoginLimiter", "login do painel operacional é senha única — brute force"],
    ["routes/auth.ts", "refreshLimiter", "refresh escreve no banco a cada chamada"],
    ["routes/patient-access.ts", "publicTokenLimiter", "rota pública que consome token"],
    ["routes/adherence-report.ts", "publicTokenLimiter", "relatório público por token"],
    ["routes/export.ts", "publicTokenLimiter", "download de export por token"],
    ["routes/push.ts", "publicTokenLimiter", "ack público do service worker"],
  ];

  for (const [arquivo, limiter, motivo] of CASOS) {
    it(`${arquivo} usa ${limiter} — ${motivo}`, () => {
      assert.match(ler(arquivo), new RegExp(limiter), `${arquivo} precisa aplicar ${limiter}`);
    });
  }
});
