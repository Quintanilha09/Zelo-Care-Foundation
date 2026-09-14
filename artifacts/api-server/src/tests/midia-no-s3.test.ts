/**
 * O armazenamento de mídia no S3 — Issue #193.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A PRIMEIRA PEÇA DA SAÍDA DO REPLIT.
 *
 * `@replit/object-storage` era o único acoplamento real do código à
 * plataforma, fora dos plugins de desenvolvimento do Vite. O `media-storage`
 * já tinha sido escrito prevendo este dia — e o que este arquivo prova é que
 * a previsão valeu: a interface não mudou, nenhuma rota soube, e a escolha
 * entre um armazenamento e outro continua sendo uma função pura de variáveis
 * de ambiente.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que NÃO dá para provar aqui ────────────────────────────────────────
 *
 * A ida e volta de verdade ao S3 — gravar um byte na AWS e lê-lo de volta.
 * Isso exige uma conta, que ainda não existe (Issue #200), e é item de aceite
 * do corte (#202): *"uma foto sobe e volta a aparecer"*.
 *
 * O que este arquivo cobre é toda a lógica que roda antes e depois da rede:
 * a seleção, o prefixo e a leitura do erro.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";
import {
  obterArmazenamento,
  reiniciarArmazenamentoParaTeste,
  novaChaveDeObjeto,
  naoEncontrado,
  ArmazenamentoS3,
  ArmazenamentoEmMemoria,
} from "../lib/media-storage.ts";

const rodar = promisify(execFile);

/** As variáveis que a seleção lê. Guardadas e devolvidas ao fim. */
const VARIAVEIS = [
  "S3_BUCKET",
  "S3_REGION",
  "S3_PREFIX",
  "DEFAULT_OBJECT_STORAGE_BUCKET_ID",
  "PRIVATE_OBJECT_DIR",
] as const;

const original = new Map<string, string | undefined>();

before(() => {
  for (const v of VARIAVEIS) original.set(v, process.env[v]);
});

beforeEach(() => {
  // Cada caso começa do zero. Sem isto, o cache de instância do módulo faria
  // o segundo caso receber a escolha do primeiro.
  for (const v of VARIAVEIS) delete process.env[v];
  reiniciarArmazenamentoParaTeste();
});

after(() => {
  for (const [v, valor] of original) {
    if (valor === undefined) delete process.env[v];
    else process.env[v] = valor;
  }
  reiniciarArmazenamentoParaTeste();
});

describe("A escolha do armazenamento", () => {
  it("com bucket e regiao, escolhe o S3", () => {
    process.env.S3_BUCKET = "zelo-midia-teste";
    process.env.S3_REGION = "sa-east-1";

    assert.ok(obterArmazenamento() instanceof ArmazenamentoS3);
  });

  it("bucket sem regiao NAO vale: meia configuracao nao seleciona", () => {
    process.env.S3_BUCKET = "zelo-midia-teste";
    // sem S3_REGION

    /**
     * O `S3Client` sem região tentaria descobri-la sozinho e falharia só na
     * PRIMEIRA GRAVAÇÃO — em produção, com um upload de verdade na mão de um
     * cuidador. Configuração pela metade tem que não existir, nunca existir
     * pela metade.
     */
    assert.ok(!(obterArmazenamento() instanceof ArmazenamentoS3));
  });

  it("regiao sem bucket tambem nao vale", () => {
    process.env.S3_REGION = "sa-east-1";
    assert.ok(!(obterArmazenamento() instanceof ArmazenamentoS3));
  });

  it("com os DOIS configurados, o S3 ganha do Replit", () => {
    process.env.S3_BUCKET = "zelo-midia-teste";
    process.env.S3_REGION = "sa-east-1";
    process.env.DEFAULT_OBJECT_STORAGE_BUCKET_ID = "bucket-antigo-do-replit";

    // Durante a migração os dois ambientes convivem. Se alguém deixar as duas
    // configurações ligadas por engano, tem que ganhar para onde o produto
    // está indo — nunca de onde ele está saindo.
    assert.ok(obterArmazenamento() instanceof ArmazenamentoS3);
  });

  it("sem nenhum dos dois, em teste, cai para memoria", () => {
    // É o que faz a suíte inteira rodar no CI, onde não há bucket nenhum.
    assert.ok(obterArmazenamento() instanceof ArmazenamentoEmMemoria);
  });

  it("a instancia e reaproveitada entre chamadas", () => {
    process.env.S3_BUCKET = "zelo-midia-teste";
    process.env.S3_REGION = "sa-east-1";

    // Um `S3Client` novo por requisição abriria um pool de conexões novo a
    // cada upload.
    assert.equal(obterArmazenamento(), obterArmazenamento());
  });
});

describe("O prefixo das chaves", () => {
  it("usa S3_PREFIX quando ele existe", () => {
    process.env.S3_PREFIX = "producao";
    assert.ok(novaChaveDeObjeto("image").startsWith("producao/zelo-midia/image/"));
  });

  it("cai para PRIVATE_OBJECT_DIR, que era o nome do Replit", () => {
    process.env.PRIVATE_OBJECT_DIR = "antigo";
    assert.ok(novaChaveDeObjeto("image").startsWith("antigo/zelo-midia/image/"));
  });

  it("S3_PREFIX ganha de PRIVATE_OBJECT_DIR", () => {
    process.env.S3_PREFIX = "novo";
    process.env.PRIVATE_OBJECT_DIR = "antigo";
    assert.ok(novaChaveDeObjeto("image").startsWith("novo/zelo-midia/"));
  });

  it("sem nenhum, usa o prefixo proprio", () => {
    assert.ok(novaChaveDeObjeto("video").startsWith("zelo-midia/video/"));
  });

  it("a chave continua sem informacao nenhuma dentro", () => {
    // CON-008: nenhum dado de saúde em URL. A parte aleatória são 32 bytes
    // em hexadecimal — 64 caracteres, sem id de paciente e sem sequência.
    const aleatoria = novaChaveDeObjeto("image").split("/").pop() ?? "";
    assert.match(aleatoria, /^[0-9a-f]{64}$/);
    assert.notEqual(novaChaveDeObjeto("image"), novaChaveDeObjeto("image"));
  });
});

describe("A leitura do erro do S3", () => {
  it("reconhece chave ausente nas tres formas que o SDK usa", () => {
    // `GetObject` devolve `NoSuchKey`; `HeadObject` devolve `NotFound`; os
    // dois trazem 404 no metadado. Olhar o código HTTP cobre os dois e não
    // depende de o nome continuar o mesmo entre versões do SDK.
    assert.ok(naoEncontrado({ $metadata: { httpStatusCode: 404 } }));
    assert.ok(naoEncontrado({ name: "NoSuchKey" }));
    assert.ok(naoEncontrado({ name: "NotFound" }));
  });

  it("NAO confunde credencial errada nem falha de rede com chave ausente", () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * É O CASO MAIS IMPORTANTE DESTE ARQUIVO.
     *
     * Se um erro de credencial ou de rede virasse "não encontrado", uma
     * configuração errada apareceria na tela como **mídia que não existe** —
     * e a foto do paciente sumiria em silêncio, sem ninguém saber por quê.
     * ═════════════════════════════════════════════════════════════════════
     */
    assert.ok(!naoEncontrado({ name: "AccessDenied", $metadata: { httpStatusCode: 403 } }));
    assert.ok(!naoEncontrado({ name: "InvalidAccessKeyId", $metadata: { httpStatusCode: 403 } }));
    assert.ok(!naoEncontrado({ name: "NetworkingError" }));
    assert.ok(!naoEncontrado({ $metadata: { httpStatusCode: 500 } }));
    assert.ok(!naoEncontrado(new Error("qualquer coisa")));
    assert.ok(!naoEncontrado(null));
    assert.ok(!naoEncontrado(undefined));
  });
});

describe("A falha fechada em producao", () => {
  it("producao SEM bucket nenhum devolve null, e nao cai para memoria", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * CAIR PARA MEMÓRIA SERIA PERDA DE DADO DISFARÇADA DE SUCESSO.
     *
     * O upload responderia 201, a pessoa veria a foto na tela, e o arquivo
     * sumiria no próximo reinício do contêiner. Melhor recusar com 503
     * dizendo o que falta.
     *
     * Este caso roda num PROCESSO SEPARADO porque `IS_PRODUCTION` é decidido
     * no import, e dentro de `node --test` ele é sempre falso — por desenho.
     * Ver `apoio-falha-fechada.ts`.
     * ═════════════════════════════════════════════════════════════════════
     */
    const apoio = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "apoio-falha-fechada.ts",
    );

    const ambiente: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    // A marca do test runner precisa sumir: é ela que faz `IS_TEST` ser
    // verdadeiro, e com ela o processo filho não seria produção.
    delete ambiente.NODE_TEST_CONTEXT;
    for (const v of VARIAVEIS) delete ambiente[v];

    const { stdout } = await rodar("npx", ["tsx", apoio], {
      env: ambiente,
      shell: process.platform === "win32",
    });

    // O `safeLog` escreve no mesmo stdout, então a comparação é com o FIM da
    // saída, não com ela inteira. E a linha de log que vem junto é justamente
    // a segunda metade da garantia, conferida logo abaixo.
    assert.ok(
      stdout.trim().endsWith("NULO"),
      "em produção sem bucket, obterArmazenamento() tem que devolver null — " +
        `cair para memória aceitaria o upload e perderia o arquivo. Saída: ${stdout}`,
    );
    assert.ok(
      !stdout.includes("CAIU_PARA_ALGUMA_COISA"),
      "produção não pode cair para memória em hipótese nenhuma",
    );

    /**
     * E o silêncio também seria um defeito.
     *
     * Devolver `null` sem avisar deixaria o operador com uma tela de upload
     * que responde 503 e nenhuma pista do motivo. O aviso de segurança tem
     * que sair, e tem que dizer qual variável falta.
     */
    assert.match(stdout, /media_storage_unconfigured/);
    assert.match(stdout, /S3_BUCKET/);
  });
});
