/**
 * A cópia de segurança própria — Issue #199.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * UM DESPEJO DE BANCO É O DADO DE SAÚDE INTEIRO NUM ARQUIVO SÓ.
 *
 * Nome de paciente, medicamento, condição e horário de cada dose de cada
 * família — num arquivo que vai para um bucket e fica lá por meses. O que
 * estes casos protegem não é a funcionalidade de copiar; é que a cópia nunca
 * saia legível, e que ela nunca deixe de sair em silêncio.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { cifrar, decifrar, chavePublicaDoAmbiente } from "../lib/backup-cifra.ts";
import { camadasDoMomento, nomeDaCopia } from "../lib/backup.ts";

const rodar = promisify(execFile);

/** Um par de chaves novo por execução. 2048 basta e é rápido de gerar. */
function novoPar(): { publica: string; privada: string } {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publica: publicKey, privada: privateKey };
}

/** Um despejo de mentira, com dado que NÃO pode aparecer em claro. */
const DESPEJO = Buffer.from(
  "PGDMP fingido — Dona Maria Teste; Remedio Ficticio 500mg; hipertensao",
  "utf-8",
);

describe("A cifragem do despejo", () => {
  it("ida e volta devolve exatamente o que entrou", () => {
    const { publica, privada } = novoPar();
    const pacote = cifrar(DESPEJO, publica);
    assert.deepEqual(decifrar(pacote, privada), DESPEJO);
  });

  it("o pacote NAO contem o conteudo em claro", () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * É O CASO QUE JUSTIFICA O MÓDULO INTEIRO.
     *
     * Se um dia alguém "simplificar" a cifragem e ela virar um invólucro sem
     * efeito, tudo continua funcionando: o arquivo sobe, o job passa, a
     * restauração funciona. O único sintoma seria este caso reprovando.
     * ═════════════════════════════════════════════════════════════════════
     */
    const { publica } = novoPar();
    const pacote = cifrar(DESPEJO, publica);
    const comoTexto = pacote.toString("latin1");

    for (const segredo of ["Dona Maria Teste", "Remedio Ficticio", "hipertensao", "PGDMP"]) {
      assert.ok(
        !comoTexto.includes(segredo),
        `o pacote cifrado nao pode conter "${segredo}" em claro`,
      );
    }
  });

  it("a chave privada errada NAO abre o pacote", () => {
    const a = novoPar();
    const b = novoPar();
    const pacote = cifrar(DESPEJO, a.publica);
    assert.throws(() => decifrar(pacote, b.privada));
  });

  it("um byte adulterado no meio faz a decifragem FALHAR, e nao devolver lixo", () => {
    /**
     * É para isso que o AES-GCM está aqui em vez de CBC: adulteração é
     * detectada. Sem autenticação, um arquivo corrompido no bucket
     * "restauraria" produzindo dado silenciosamente errado — num banco de
     * histórico de dose, dado errado é pior que dado ausente.
     */
    const { publica, privada } = novoPar();
    const pacote = cifrar(DESPEJO, publica);

    const adulterado = Buffer.from(pacote);
    const meio = Math.floor(adulterado.length / 2);
    adulterado[meio] = adulterado[meio]! ^ 0xff;

    assert.throws(() => decifrar(adulterado, privada));
  });

  it("pacote de outro formato da erro claro, e nao erro de criptografia", () => {
    const { privada } = novoPar();
    const qualquerCoisa = Buffer.from("isto nao e um backup do ZELO, e um arquivo qualquer");
    assert.throws(
      () => decifrar(qualquerCoisa, privada),
      /marca ausente|truncado/,
      "quem restaura precisa saber que pegou o arquivo errado, nao que a chave falhou",
    );
  });

  it("pacote truncado da erro claro", () => {
    const { publica, privada } = novoPar();
    const pacote = cifrar(DESPEJO, publica);
    assert.throws(() => decifrar(pacote.subarray(0, 20), privada), /truncado/);
  });

  it("cada cifragem produz bytes diferentes, mesmo com o mesmo conteudo", () => {
    // Chave AES e IV novos a cada vez. Dois despejos iguais gerando o mesmo
    // arquivo diria a quem olha o bucket que nada mudou no banco.
    const { publica } = novoPar();
    assert.notDeepEqual(cifrar(DESPEJO, publica), cifrar(DESPEJO, publica));
  });
});

describe("A chave publica vinda do ambiente", () => {
  it("aceita PEM com quebras de linha escapadas", () => {
    // É o que acontece ao colar um PEM num campo de variável de ambiente de
    // console web: as quebras viram `\n` literais.
    const original = process.env.BACKUP_PUBLIC_KEY;
    try {
      process.env.BACKUP_PUBLIC_KEY = "-----BEGIN PUBLIC KEY-----\\nABC\\n-----END PUBLIC KEY-----";
      assert.equal(
        chavePublicaDoAmbiente(),
        "-----BEGIN PUBLIC KEY-----\nABC\n-----END PUBLIC KEY-----",
      );
    } finally {
      if (original === undefined) delete process.env.BACKUP_PUBLIC_KEY;
      else process.env.BACKUP_PUBLIC_KEY = original;
    }
  });

  it("sem variavel, devolve null em vez de string vazia", () => {
    const original = process.env.BACKUP_PUBLIC_KEY;
    try {
      delete process.env.BACKUP_PUBLIC_KEY;
      assert.equal(chavePublicaDoAmbiente(), null);
    } finally {
      if (original !== undefined) process.env.BACKUP_PUBLIC_KEY = original;
    }
  });
});

describe("As camadas de retencao", () => {
  it("hora comum grava so na camada horaria", () => {
    assert.deepEqual(camadasDoMomento(new Date("2026-09-24T15:10:00Z")), ["horario"]);
  });

  it("meia-noite grava tambem a diaria", () => {
    assert.deepEqual(camadasDoMomento(new Date("2026-09-24T00:10:00Z")), ["horario", "diario"]);
  });

  it("primeiro dia do mes, a meia-noite, grava as tres", () => {
    assert.deepEqual(camadasDoMomento(new Date("2026-10-01T00:10:00Z")), [
      "horario",
      "diario",
      "mensal",
    ]);
  });

  it("primeiro dia do mes em outra hora NAO grava a mensal", () => {
    // A mensal existe para guardar um ponto por mês, não um por hora do dia 1.
    assert.deepEqual(camadasDoMomento(new Date("2026-10-01T13:10:00Z")), ["horario"]);
  });
});

describe("O nome do objeto", () => {
  it("ordena por nome na mesma ordem do tempo", () => {
    // Quem procura "a cópia mais recente" olha o fim da lista. Se o nome não
    // ordenar junto com o tempo, essa conta simples fica errada.
    const antes = nomeDaCopia(new Date("2026-09-24T09:10:00Z"), "horario", "");
    const depois = nomeDaCopia(new Date("2026-09-24T10:10:00Z"), "horario", "");
    assert.ok(antes < depois, `${antes} deveria vir antes de ${depois}`);
  });

  it("nao usa dois-pontos", () => {
    // Válido no S3, e inválido em nome de arquivo no Windows — onde a cópia
    // acaba baixada na hora de restaurar.
    assert.ok(!nomeDaCopia(new Date("2026-09-24T09:10:00Z"), "horario", "").includes(":"));
  });

  it("a camada e o primeiro nivel, porque e o que a regra do S3 enxerga", () => {
    // A retenção é feita por regra de ciclo de vida por prefixo. Se a camada
    // não for o começo da chave, a regra não casa e nada é expurgado.
    assert.ok(nomeDaCopia(new Date("2026-09-24T09:10:00Z"), "mensal", "").startsWith("mensal/"));
    assert.ok(
      nomeDaCopia(new Date("2026-09-24T09:10:00Z"), "mensal", "zelo").startsWith("zelo/mensal/"),
    );
  });
});

describe("A falha fechada em producao", () => {
  it("producao sem chave publica RECUSA copiar, em vez de gravar em claro", async () => {
    /**
     * ═════════════════════════════════════════════════════════════════════
     * GRAVAR SEM CIFRA SERIA PIOR QUE NÃO TER BACKUP.
     *
     * Um arquivo com o dado de saúde de todas as famílias, em claro, num
     * bucket, por meses — e com a aparência de que o backup está funcionando.
     *
     * `IS_PRODUCTION` é calculado no import a partir de `NODE_ENV` e
     * `NODE_TEST_CONTEXT`, e essa segunda existe em todo processo de
     * `node --test`. Por isso a verificação precisa de um processo separado,
     * como em `apoio-falha-fechada.ts` (#193).
     * ═════════════════════════════════════════════════════════════════════
     */
    const apoio = path.join(
      path.dirname(fileURLToPath(import.meta.url)),
      "apoio-backup-em-producao.ts",
    );

    const ambiente: NodeJS.ProcessEnv = { ...process.env, NODE_ENV: "production" };
    delete ambiente.NODE_TEST_CONTEXT;
    delete ambiente.BACKUP_PUBLIC_KEY;
    delete ambiente.BACKUP_S3_BUCKET;
    delete ambiente.BACKUP_S3_REGION;

    const { stdout } = await rodar("npx", ["tsx", apoio], {
      env: ambiente,
      shell: process.platform === "win32",
    });

    const linha = stdout.split("\n").find((l) => l.includes("ZELO_RESULTADO:"));
    assert.ok(linha, `o processo de apoio nao imprimiu o resultado. Saida:\n${stdout}`);

    const r = JSON.parse(
      linha.slice(linha.indexOf("ZELO_RESULTADO:") + "ZELO_RESULTADO:".length).trim(),
    ) as { lancou: boolean; mensagem: string };

    assert.equal(
      r.lancou,
      true,
      "em producao sem configuracao de backup, a copia tem que FALHAR — " +
        "gravar o banco inteiro em claro seria pior que nao ter copia naquela hora",
    );
    assert.match(r.mensagem, /backup não configurado/);
  });
});
