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
import { multiplicadorDeLimite } from "../lib/rate-limit.ts";

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

/**
 * Consistência das suítes FORA do api-server — achado da auditoria §10 (23/08/2026).
 *
 * O guardrail acima trava a suíte do api-server, e SÓ ela. Enquanto isso,
 * `lib/scheduling` tinha 33 testes cobrindo o motor de recorrência — o núcleo
 * que decide quando cada dose acontece — que passavam e nunca rodavam no CI:
 * o workflow chama typecheck, lint:clock, test:all e build, jamais `test:libs`.
 *
 * É a mesma classe do incidente de 21/08 (teste que existe e não roda), um
 * diretório ao lado, e escapou justamente porque a varredura parava em
 * `artifacts/api-server/src/tests/`. Este bloco fecha o buraco de forma.
 */
describe("Consistência das suítes fora do api-server", () => {
  // raiz = artifacts/api-server/src/ → três níveis acima é a raiz do repositório
  const raizRepo = `${raiz}../../../`;
  const dirLib = `${raizRepo}lib`;

  const pacotesLib = existsSync(dirLib)
    ? readdirSync(dirLib, { withFileTypes: true })
        .filter((e) => e.isDirectory() && existsSync(`${dirLib}/${e.name}/package.json`))
        .map((e) => e.name)
    : [];

  it("todo .test.ts de lib/ está no script de teste do próprio pacote, e vice-versa", () => {
    const problemas: string[] = [];

    for (const nome of pacotesLib) {
      const base = `${dirLib}/${nome}`;
      const src = `${base}/src`;
      if (!existsSync(src)) continue;

      const noDisco = readdirSync(src).filter((f) => f.endsWith(".test.ts"));
      if (noDisco.length === 0) continue;

      const pkg = JSON.parse(readFileSync(`${base}/package.json`, "utf8")) as {
        scripts?: Record<string, string>;
      };
      const script = pkg.scripts?.test ?? "";

      if (script.length === 0) {
        problemas.push(
          `lib/${nome}: tem ${noDisco.length} arquivo(s) de teste e NENHUM script "test" — nunca rodam`
        );
        continue;
      }

      // arquivo existe mas ficou fora do script → falha silenciosa
      for (const arquivo of noDisco) {
        if (!script.includes(arquivo)) {
          problemas.push(`lib/${nome}: ${arquivo} existe mas está fora do script "test"`);
        }
      }

      // script aponta para arquivo inexistente → quebra a suíte do pacote
      const referenciados: string[] = script.match(/src\/[a-z0-9.-]+\.test\.ts/g) ?? [];
      for (const ref of referenciados) {
        if (!existsSync(`${base}/${ref}`)) {
          problemas.push(`lib/${nome}: script "test" aponta para ${ref}, que não existe`);
        }
      }
    }

    assert.deepEqual(problemas, [] as string[], `\n${problemas.join("\n")}`);
  });

  it("a raiz tem test:libs e ele varre lib/ de forma recursiva", () => {
    const raizPkg = JSON.parse(readFileSync(`${raizRepo}package.json`, "utf8")) as {
      scripts?: Record<string, string>;
    };
    const script = raizPkg.scripts?.["test:libs"] ?? "";
    assert.ok(script.length > 0, "a raiz precisa de um script test:libs");
    assert.match(
      script,
      /--filter/,
      "test:libs precisa usar --filter recursivo para alcançar todo pacote de lib"
    );
  });

  it("o CI executa test:libs — senão os testes de lib existem, passam e não são exercidos", () => {
    const workflow = `${raizRepo}.github/workflows/validate.yml`;
    if (!existsSync(workflow)) {
      // O workflow ainda pode viver só numa branch. Quando chegar ao main, este
      // teste passa a exigir que ele rode os testes de lib.
      return;
    }
    const conteudo = readFileSync(workflow, "utf8");
    assert.match(
      conteudo,
      /test:libs/,
      "validate.yml não chama `pnpm run test:libs` — foi exatamente assim que 33 testes do motor de recorrência ficaram fora do CI"
    );
  });
});

/**
 * Separação entre painel operacional e sessão de cuidador — achado de 23/08/2026.
 *
 * Os dois mundos são separados pela ASSINATURA: `ADMIN_PANEL_SECRET` assina o
 * token do painel, `SESSION_SECRET` assina a sessão do cuidador. Não é uma
 * checagem que alguém possa esquecer — é criptografia. Mas ela só vale enquanto
 * as duas chaves forem diferentes.
 *
 * O workflow de CI definia as duas com o MESMO valor. Resultado: um token de
 * admin passava por `verifyAccessToken` como se fosse sessão de cuidador, seguia
 * com `userId: undefined`, e o teste de fronteira falhava com 404 em vez de 401 —
 * o sintoma exato de o token ter sido aceito.
 *
 * `getAdminSecret()` agora falha FECHADO nesse caso: desabilita o painel em vez
 * de operar com a fronteira desfeita.
 */
describe("Painel operacional e sessão de cuidador não compartilham segredo", () => {
  type ModuloAdmin = typeof import("../lib/admin-auth.ts");
  async function comSegredos(
    admin: string,
    session: string,
    fn: (mod: ModuloAdmin) => void
  ): Promise<void> {
    const oa = process.env.ADMIN_PANEL_SECRET;
    const os = process.env.SESSION_SECRET;
    try {
      process.env.ADMIN_PANEL_SECRET = admin;
      process.env.SESSION_SECRET = session;
      fn(await import(`../lib/admin-auth.ts?v=${Math.random()}`));
    } finally {
      if (oa === undefined) delete process.env.ADMIN_PANEL_SECRET; else process.env.ADMIN_PANEL_SECRET = oa;
      if (os === undefined) delete process.env.SESSION_SECRET; else process.env.SESSION_SECRET = os;
    }
  }

  it("segredos IGUAIS desabilitam o painel — falha fechada, não aberta", async () => {
    await comSegredos("mesmo-valor-nos-dois", "mesmo-valor-nos-dois", (mod: ModuloAdmin) => {
      assert.equal(
        mod.verifyAdminPassword("mesmo-valor-nos-dois"),
        false,
        "com os segredos iguais a fronteira não existe — o painel PRECISA recusar"
      );
      assert.throws(
        () => mod.generateAdminToken(),
        /não configurado/,
        "gerar token de admin com segredo colidido tem que falhar, não emitir um token que abre sessão de cuidador"
      );
    });
  });

  it("segredos DIFERENTES fazem o painel funcionar normalmente", async () => {
    await comSegredos("segredo-do-painel", "segredo-da-sessao", (mod: ModuloAdmin) => {
      assert.equal(mod.verifyAdminPassword("segredo-do-painel"), true);
      assert.equal(mod.verifyAdminPassword("segredo-da-sessao"), false);
      assert.ok(mod.generateAdminToken().length > 0);
    });
  });

  it("o workflow de CI não define os dois com o mesmo valor", () => {
    const workflow = `${raiz}../../../.github/workflows/validate.yml`;
    if (!existsSync(workflow)) return;
    const conteudo = readFileSync(workflow, "utf8");
    // `\s*`, com a barra. Estava `s*` — que casa com "zero letras s" e por
    // acaso funcionava, porque o formato tem um espaço depois dos dois pontos.
    // Regex quebrada num teste de segurança é o tipo de coisa que só aparece
    // no dia em que o formato muda e o guardrail para de guardar em silêncio.
    const admin = conteudo.match(/ADMIN_PANEL_SECRET:\s*(.+)/)?.[1]?.trim();
    const session = conteudo.match(/\bSESSION_SECRET:\s*(.+)/)?.[1]?.trim();
    assert.ok(admin && session, "o workflow precisa definir os dois segredos");
    assert.notEqual(
      admin,
      session,
      "validate.yml define ADMIN_PANEL_SECRET e SESSION_SECRET com o mesmo valor — isso desfaz a separação entre painel e sessão"
    );
  });
});

/**
 * Cadastro não pode criar conta que nunca poderá ser verificada — fase 11.1a.
 *
 * A auditoria §10 encontrou que nenhum e-mail é enviado em produção, o login
 * exige `emailVerified`, e a auto-verificação só roda em desenvolvimento.
 * Resultado: quem se cadastrava por e-mail e senha em produção ficava preso
 * para sempre, sem sinal para ninguém.
 *
 * NOTA SOBRE O QUE NÃO DÁ PARA TESTAR AQUI: `environment.ts` calcula
 * IS_PRODUCTION na CARGA do módulo, de propósito — é o que garante que ninguém
 * troque o ambiente em tempo de execução. Por isso não é possível exercitar a
 * guarda de produção mexendo em env depois do import. O que se testa é
 * `hasEmailProvider()` de verdade, e a presença da guarda por varredura do
 * código — mesma técnica já usada acima para o padrão inseguro de NODE_ENV.
 */
describe("Cadastro sem provedor de e-mail", () => {
  it("hasEmailProvider() reflete a presença de RESEND_API_KEY", async () => {
    const original = process.env.RESEND_API_KEY;
    try {
      delete process.env.RESEND_API_KEY;
      const semChave = await import(`../lib/email.ts?v=${Math.random()}`);
      assert.equal(semChave.hasEmailProvider(), false, "sem RESEND_API_KEY não há provedor");

      process.env.RESEND_API_KEY = "re_valor_de_teste";
      const comChave = await import(`../lib/email.ts?v=${Math.random()}`);
      assert.equal(comChave.hasEmailProvider(), true, "com a chave presente há provedor");

      process.env.RESEND_API_KEY = "";
      const vazia = await import(`../lib/email.ts?v=${Math.random()}`);
      assert.equal(vazia.hasEmailProvider(), false, "chave vazia não conta como provedor");
    } finally {
      if (original === undefined) delete process.env.RESEND_API_KEY;
      else process.env.RESEND_API_KEY = original;
    }
  });

  it("o cadastro recusa ANTES de escrever no banco quando não há provedor", () => {
    const auth = ler("routes/auth.ts");
    const inicio = auth.indexOf('router.post("/auth/register"');
    assert.ok(inicio > -1, "a rota de cadastro precisa existir");

    const guarda = auth.indexOf("hasEmailProvider()", inicio);
    const primeiraEscrita = auth.indexOf("db.transaction", inicio);
    const parseDoBody = auth.indexOf("RegisterBody.safeParse", inicio);

    assert.ok(guarda > -1, "o cadastro precisa checar hasEmailProvider()");
    assert.ok(
      guarda < primeiraEscrita,
      "a guarda precisa vir ANTES de qualquer escrita no banco — recusar depois deixa usuário órfão e e-mail queimado"
    );
    assert.ok(
      guarda < parseDoBody,
      "a guarda é uma precondição de ambiente: vem antes até da validação do corpo"
    );
  });

  it("a recuperação de senha também recusa em vez de prometer um e-mail que não sai", () => {
    const auth = ler("routes/auth.ts");
    const inicio = auth.indexOf('router.post("/auth/password-reset/request"');
    assert.ok(inicio > -1, "a rota de recuperação precisa existir");
    const trecho = auth.slice(inicio, inicio + 900);
    assert.ok(trecho.includes("hasEmailProvider()"), "a recuperação de senha precisa checar o provedor");
  });

  it("existe /auth/email/status, o mesmo contrato do Google", () => {
    const auth = ler("routes/auth.ts");
    assert.ok(
      auth.includes('router.get("/auth/email/status"'),
      "a tela precisa poder perguntar se há provedor"
    );
    assert.ok(auth.includes("configured:"), "o contrato devolve { configured }");
  });
});

/**
 * O multiplicador de limite de taxa não pode afrouxar produção — QUI-10.
 *
 * A variável `RATE_LIMIT_MULTIPLIER` nasceu para a suíte de ponta a ponta, que
 * faz dezenas de logins legítimos em poucos minutos. É exatamente o tipo de
 * atalho de teste que, mal escrito, vira porta aberta em produção: bastaria
 * alguém definir a variável no ambiente publicado para desligar na prática a
 * proteção contra força bruta.
 *
 * Aqui a defesa é estrutural, e este teste é a prova dela.
 */
describe("Limite de taxa — o atalho de teste não atravessa para produção", () => {
  it("em produção o multiplicador é 1, aconteça o que acontecer com a variável", () => {
    for (const declarado of ["200", "1000", "999999", "0", "-5", "abc", "", undefined]) {
      assert.equal(
        multiplicadorDeLimite(false, declarado),
        1,
        `com RATE_LIMIT_MULTIPLIER=${String(declarado)} produção teria afrouxado o limite`
      );
    }
  });

  it("em desenvolvimento, valor inválido cai no padrão em vez de virar NaN", () => {
    // Um limite NaN desabilitaria o limitador em silêncio, que é pior que
    // um limite baixo demais: ninguém perceberia.
    for (const invalido of ["abc", "", "0", "-1", undefined]) {
      assert.equal(multiplicadorDeLimite(true, invalido), 10, `entrada inválida: ${String(invalido)}`);
    }
  });

  it("em desenvolvimento o valor declarado vale, com teto", () => {
    assert.equal(multiplicadorDeLimite(true, "200"), 200);
    assert.equal(multiplicadorDeLimite(true, "999999"), 1000, "o teto evita desligar o limitador por engano");
  });
});

/**
 * Memória de canvas no celular — Issue #53.
 *
 * ── Por que isto é guardado por varredura, e não por teste de verdade ─────
 *
 * O defeito era invisível no desktop e fatal no celular: comprimir várias
 * fotos seguidas acumulava um `canvas` por foto — ~7,7 MB de pixels cada, em
 * memória do NAVEGADOR, não do heap do JavaScript. O coletor não tinha por
 * que rodar entre as voltas do laço, o renderizador do celular estourava, a
 * aba recarregava e a pessoa perdia as fotos escolhidas.
 *
 * Assinatura clássica: **uma foto sempre funcionou, duas ou mais não.**
 *
 * Nenhum teste desta suíte reproduz isso. O Playwright roda em desktop, onde
 * sobra memória; `node:test` não tem canvas. O que dá para garantir é que a
 * linha que solta os pixels **continue existindo** — porque ela parece
 * supérflua para quem lê rápido, e é exatamente o tipo de coisa que some numa
 * "limpeza".
 */
describe("Compressão de foto solta a memória do canvas", () => {
  const compressor = `${raiz}../../zelo/src/lib/comprimir-imagem.ts`;

  it("o arquivo existe onde a varredura espera", () => {
    assert.ok(
      existsSync(compressor),
      "comprimir-imagem.ts mudou de lugar — atualize este guardrail em vez de apagá-lo",
    );
  });

  it("zera largura E altura do canvas depois de usar", () => {
    const fonte = readFileSync(compressor, "utf8");

    // Não existe `canvas.dispose()`. Zerar as dimensões é a forma suportada de
    // descartar o backing store na hora, em vez de esperar o coletor.
    assert.match(
      fonte,
      /\.width\s*=\s*0\s*;/,
      "sumiu o `width = 0` — o canvas volta a vazar em celular",
    );
    assert.match(
      fonte,
      /\.height\s*=\s*0\s*;/,
      "sumiu o `height = 0` — zerar só a largura não solta os pixels",
    );
  });

  it("gera uma MINIATURA separada para a prévia", () => {
    const fonte = readFileSync(compressor, "utf8");

    // A correção que veio depois: soltar o canvas não bastou. A prévia mostrava
    // o arquivo de 1600px numa <img> de 90px, e o CSS encolhe o DESENHO, não a
    // decodificação — 7,7 MB de bitmap por foto, residentes na tela. Seis
    // somavam ~46 MB e matavam a aba, sem erro nenhum, porque o JavaScript
    // morria junto.
    assert.match(
      fonte,
      /LADO_DA_MINIATURA/,
      "sumiu a miniatura — a prévia volta a decodificar em tamanho cheio",
    );
    assert.match(fonte, /miniatura:\s*Blob/, "a miniatura precisa sair do compressor");
  });

  it("a prévia usa a miniatura, e não o arquivo de envio", () => {
    const card = `${raiz}../../zelo/src/components/momentos-card.tsx`;
    const fonte = readFileSync(card, "utf8");

    // O ponto exato onde o defeito morava. Trocar `miniUrl` de volta por `url`
    // é uma letra de diferença e devolve o problema inteiro.
    assert.match(
      fonte,
      /src=\{item\.miniUrl\}/,
      "a <img> da prévia precisa apontar para a miniatura",
    );
  });

  it("solta os pixels num `finally`, para valer também quando a foto falha", () => {
    const fonte = readFileSync(compressor, "utf8");
    const finallyIdx = fonte.lastIndexOf("} finally {");
    const zeraIdx = fonte.indexOf(".width = 0");

    assert.ok(finallyIdx > -1, "o `finally` precisa existir");
    assert.ok(
      zeraIdx > finallyIdx,
      "a liberação está fora do `finally` — uma foto ilegível vazaria o canvas dela",
    );
  });
});

/**
 * O teto do lote e o limitador de envio moram em pacotes diferentes — #90.
 *
 * ── O que aconteceu, e por que uma varredura é a resposta ─────────────────
 *
 * O comentário do `mediaUploadLimiter` dizia, desde o PR #70, que o limite
 * havia subido de 30 para 100 por hora — e explicava por quê: com o lote da
 * Issue #64, um passeio de fim de semana batia no teto e o próprio app levava
 * 429.
 *
 * **A linha do `limit` nunca foi trocada.** A correção existiu só em prosa, e
 * `MAX_POR_LOTE = 20` foi calibrado acreditando nela. Ficou assim por dois
 * meses, até o fundador reportar que não conseguia enviar mais fotos.
 *
 * Nada pegou porque os dois números vivem em pacotes diferentes: um no
 * servidor, outro na tela, sem nada ligando um ao outro. Corrigir só os valores
 * deixaria a mesma armadilha armada.
 */
describe("O lote da tela cabe no limitador do servidor", () => {
  /** Quantos lotes cheios o comentário do limitador promete numa hora. */
  const LOTES_POR_HORA_PROMETIDOS = 5;

  it("os dois números existem onde a varredura espera", () => {
    const card = `${raiz}../../zelo/src/components/momentos-card.tsx`;
    assert.ok(existsSync(card), "momentos-card.tsx mudou de lugar — atualize este guardrail");
    assert.ok(existsSync(`${raiz}lib/rate-limit.ts`));
  });

  it("MAX_POR_LOTE cabe no mediaUploadLimiter, com a folga que o comentário promete", () => {
    const card = readFileSync(`${raiz}../../zelo/src/components/momentos-card.tsx`, "utf8");
    const limites = ler("lib/rate-limit.ts");

    const porLote = Number(/const MAX_POR_LOTE = (\d+)/.exec(card)?.[1]);
    // A linha do limitador é `limit: N * M`; só o N interessa aqui, porque em
    // produção M vale 1.
    const trecho = limites.slice(limites.indexOf("export const mediaUploadLimiter"));
    const porHora = Number(/limit:\s*(\d+)\s*\*\s*M/.exec(trecho)?.[1]);

    assert.ok(Number.isFinite(porLote), "não consegui ler MAX_POR_LOTE");
    assert.ok(Number.isFinite(porHora), "não consegui ler o limite do mediaUploadLimiter");

    assert.ok(
      porHora >= porLote * LOTES_POR_HORA_PROMETIDOS,
      `o limitador aceita ${porHora}/hora e a tela permite lotes de ${porLote}: ` +
        `cabem ${Math.floor(porHora / porLote)} lotes, e o comentário promete ` +
        `${LOTES_POR_HORA_PROMETIDOS}. Foi exatamente essa divergência que fez o ` +
        "segundo lote de um passeio levar 429 no meio do envio.",
    );
  });
});

/**
 * A quebra de palavra comprida é global — Issue #88.
 *
 * ── Por que um guardrail, e num arquivo do servidor ───────────────────────
 *
 * O conserto da #88 tem duas metades, e a primeira tentativa só teve uma. Pôr
 * `break-words` em cada lugar onde eu lembrei falhou no CI: o título da ficha
 * quebrava certo e a frase logo abaixo vazava, porque ninguém pensa em nome
 * comprido ao escrever uma frase com o nome do paciente no meio.
 *
 * A regra passou a ser global, no `body` do `index.css`. Regra global é
 * exatamente o tipo de coisa que alguém remove num refactor de CSS sem saber o
 * que ela segurava — e o defeito volta calado, em telas que ninguém está
 * olhando naquele dia.
 *
 * Fica aqui pelo mesmo motivo dos outros deste arquivo: é a suíte que roda em
 * todo PR e não precisa de navegador. O front não tem suíte unitária.
 */
describe("Quebra de palavra comprida — Issue #88", () => {
  const css = `${raiz}../../zelo/src/index.css`;

  it("o `overflow-wrap` global continua no index.css", () => {
    const conteudo = readFileSync(css, "utf8");

    assert.match(
      conteudo,
      /overflow-wrap:\s*break-word/,
      "sumiu o `overflow-wrap: break-word` global do index.css. Sem ele, " +
        "qualquer frase com nome de paciente no meio volta a vazar para fora " +
        "da tela no celular — que foi o defeito relatado na Issue #88.",
    );
  });

  it("não virou `anywhere`, que mexeria na largura de botão e de tabela", () => {
    const conteudo = readFileSync(css, "utf8");

    // `anywhere` também encolhe a largura mínima intrínseca dos elementos.
    // Resolveria o mesmo problema e mudaria o tamanho de botão e de célula no
    // app inteiro — troca que não foi feita, e que não deve entrar sem
    // alguém decidir por ela.
    assert.doesNotMatch(
      conteudo,
      /overflow-wrap:\s*anywhere/,
      "`overflow-wrap: anywhere` global muda a largura mínima de todo " +
        "elemento. Se for mesmo desejado, decida e apague este teste.",
    );
  });
});
