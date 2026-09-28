/**
 * A escala do serviço é 1, e agora um teste guarda isso — Issue #201.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ESTE TESTE EXISTE, SE JÁ HÁ COMENTÁRIO E RUNBOOK.
 *
 * A #197 pediu este guardrail e não pôde entregá-lo: não havia arquivo de
 * escala neste repositório para ler. A definição do serviço nasceu na #201,
 * em `deploy/lightsail.json`, e com ela o teste passou a ser possível.
 *
 * Subir a escala de 1 para 2 é um seletor de número numa tela de console.
 * Esse clique quebra TRÊS coisas, e nenhuma delas dá erro:
 *
 *   1. o limitador de taxa dobra (cada nó conta o seu mapa em memória)
 *   2. a atualização ao vivo para de atravessar entre nós — duas cuidadoras
 *      deixam de ver a dose que a outra registrou, que é caminho para dose
 *      repetida
 *   3. revogar o acesso de um cuidador não fecha a conexão SSE que ele tem
 *      aberta no outro nó — ele segue recebendo nome de medicamento e situação
 *      de dose. Encosta no invariante 2 do produto.
 *
 * O comentário no código e o runbook avisam quem lê. Este teste avisa quem
 * **não** leu.
 *
 * Detalhes de cada uma: planning/runbooks/escala-do-servico.md
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { encontrarMigracoes, MARCA_OK, MARCA_FALHOU } from "../migrar.ts";

const raizRepo = fileURLToPath(new URL("../../../../", import.meta.url));
const lerRaiz = (caminho: string) => readFileSync(`${raizRepo}${caminho}`, "utf8");

interface Declaracao {
  regiao: string;
  servico: string;
  container: string;
  rotuloDaImagem: string;
  containerDaMigracao: string;
  comandoDaMigracao: string[];
  escalaEsperada: number;
  caminhoDeSaude: string;
  caminhoDeProntidao: string;
}

const declaracao = JSON.parse(lerRaiz("deploy/lightsail.json")) as Declaracao;

describe("a escala declarada do serviço de contêiner", () => {
  it("é 1 — e mais que isso precisa do trabalho listado no runbook, antes", () => {
    assert.ok(
      Number.isInteger(declaracao.escalaEsperada),
      "deploy/lightsail.json precisa declarar escalaEsperada como número inteiro",
    );
    assert.ok(
      declaracao.escalaEsperada <= 1,
      `deploy/lightsail.json declara escalaEsperada = ${declaracao.escalaEsperada}.\n\n` +
        "Com mais de um nó, três coisas passam a funcionar pela metade EM SILÊNCIO:\n" +
        "  1. o limitador de taxa dobra — é a defesa contra tentativa de senha em massa\n" +
        "  2. a atualização ao vivo não atravessa entre nós — caminho para dose repetida\n" +
        "  3. revogar cuidador não fecha a sessão dele no outro nó — invariante 2\n\n" +
        "Nenhuma se resolve mexendo na escala. O que precisa ser feito antes está em\n" +
        "planning/runbooks/escala-do-servico.md. Quando estiver feito, este número muda\n" +
        "no mesmo commit que o resolve — e não antes.",
    );
  });

  it("a esteira compara a escala declarada com a escala REAL do serviço", () => {
    // Guardar o arquivo não basta: quem sobe a escala faz isso no console, e o
    // arquivo continua dizendo 1. Quem pega esse caso é o workflow, que lê a
    // escala de verdade e para o deploy. Este teste garante que ele continue
    // fazendo isso.
    const workflow = `${raizRepo}.github/workflows/publicar.yml`;
    assert.ok(existsSync(workflow), "o workflow de publicação sumiu");
    const conteudo = readFileSync(workflow, "utf8");

    assert.match(
      conteudo,
      /ESCALA_ESPERADA/,
      "publicar.yml não usa mais a escala declarada — o guardrail virou enfeite",
    );
    assert.match(
      conteudo,
      /escala-do-servico\.md/,
      "a mensagem de erro do workflow precisa apontar para o runbook: quem levar o erro " +
        "às 3h da manhã não vai adivinhar por que 2 nós são um problema",
    );
  });
});

/**
 * As três pontas do caminho de migração precisam continuar apontando umas para
 * as outras.
 *
 * Elas vivem em arquivos diferentes, e cada uma sozinha parece inofensiva de
 * mudar:
 *
 *   build.mjs            constrói `src/migrar.ts` → `dist/migrar.mjs`
 *   Dockerfile           leva `lib/db/migrations` para `/app/migrations`
 *   deploy/lightsail.json manda o contêiner rodar `node ./dist/migrar.mjs`
 *
 * Quebrar qualquer uma delas não dá erro em lugar nenhum: o CI fica verde, a
 * imagem constrói, e a falha aparece no primeiro deploy — no passo de migração,
 * em produção. Este teste move essa descoberta para cá.
 */
describe("o caminho de migração está inteiro", () => {
  it("o comando declarado aponta para o arquivo que o build produz", () => {
    const comando = declaracao.comandoDaMigracao;
    assert.deepEqual(
      comando[0],
      "node",
      "o comando de migração roda sem shell no Lightsail: tem que ser um executável direto, " +
        'nada de `sh -c "..."`',
    );
    const alvo = comando[1] ?? "";
    assert.match(alvo, /migrar\.mjs$/, "o comando de migração não aponta para dist/migrar.mjs");

    const build = lerRaiz("artifacts/api-server/build.mjs");
    assert.match(
      build,
      /src\/migrar\.ts/,
      "build.mjs não constrói src/migrar.ts — o comando do contêiner apontaria para um " +
        "arquivo que não existe na imagem",
    );
  });

  it("o Dockerfile leva as migrações para dentro da imagem", () => {
    const dockerfile = lerRaiz("Dockerfile");
    assert.match(
      dockerfile,
      /lib\/db\/migrations/,
      "o Dockerfile não copia lib/db/migrations — o contêiner de migração subiria sem os " +
        "arquivos .sql e falharia dizendo que não achou a pasta",
    );
  });

  it("as migrações são encontráveis a partir do código", () => {
    // Exercita a mesma função que o contêiner usa. Aqui ela acha o caminho do
    // repositório; na imagem, o de `/app/migrations`.
    const pasta = encontrarMigracoes();
    assert.ok(
      existsSync(`${pasta.replace(/[\\/]$/, "")}/meta/_journal.json`),
      `encontrarMigracoes() devolveu ${pasta}, que não tem meta/_journal.json`,
    );
  });

  it("a esteira espera pelo workflow de checks com o nome exato dele", () => {
    // Falha SILENCIOSA se quebrar: o `workflow_run` casa pelo NOME do workflow,
    // e um nome que não existe não dispara nada — sem erro, sem aviso, sem
    // execução. Alguém renomeia o `validate.yml` e o deploy simplesmente para
    // de acontecer, e a descoberta é dias depois, quando o app estiver velho.
    const validate = lerRaiz(".github/workflows/validate.yml");
    const publicar = lerRaiz(".github/workflows/publicar.yml");

    const nome = validate.match(/^name:\s*(.+)$/m)?.[1]?.trim();
    assert.ok(nome, "validate.yml não tem `name:`");
    assert.ok(
      new RegExp(`workflows:\\s*\\[\\s*["']${nome}["']\\s*\\]`).test(publicar),
      `publicar.yml espera por um workflow que não se chama "${nome}" — o gatilho nunca dispara, ` +
        "e nada no GitHub avisa que isso aconteceu",
    );
  });

  it("as marcas que a esteira procura no log são as que o script imprime", () => {
    // Contrato entre dois arquivos que ninguém lê junto: se o texto mudar de um
    // lado, a esteira passa a esperar para sempre — e trata isso como falha,
    // então um deploy correto seria recusado.
    const workflow = lerRaiz(".github/workflows/publicar.yml");
    assert.ok(
      workflow.includes(MARCA_OK),
      `publicar.yml não procura "${MARCA_OK}" no log — a esteira nunca saberia que a migração deu certo`,
    );
    assert.ok(
      workflow.includes(MARCA_FALHOU),
      `publicar.yml não procura "${MARCA_FALHOU}" no log`,
    );
  });
});

/**
 * A esteira não pode imprimir segredo, e o modo de garantir isso é estrutural:
 * toda chamada à AWS que devolve o deployment é redirecionada para arquivo.
 *
 * `get-container-services` e `create-container-service-deployment` devolvem as
 * variáveis de ambiente COM OS VALORES — senha do banco, chave do Resend,
 * segredo de sessão. Um `aws ...` sem redirecionamento imprime tudo isso num
 * log público.
 */
describe("a esteira não vaza segredo no log", () => {
  const workflow = lerRaiz(".github/workflows/publicar.yml");

  it("toda chamada que devolve o deployment vai para arquivo", () => {
    const perigosas = ["get-container-services", "create-container-service-deployment"];
    const linhas = workflow.split("\n");
    const problemas: string[] = [];

    for (let i = 0; i < linhas.length; i++) {
      const cru = linhas[i]!.trim();
      // Comentário não executa nada, e o arquivo tem muitos que citam os
      // comandos para explicá-los.
      if (cru.startsWith("#")) continue;
      if (!perigosas.some((c) => cru.includes(c))) continue;

      // O comando pode estar quebrado em várias linhas com `\` no fim. Junta
      // até a linha que não continua, e é nesse comando inteiro que o
      // redirecionamento tem de aparecer.
      let comandoInteiro = cru;
      let j = i;
      while (linhas[j]!.trim().endsWith("\\") && j + 1 < linhas.length) {
        j++;
        comandoInteiro += ` ${linhas[j]!.trim()}`;
      }
      if (!comandoInteiro.includes(">")) problemas.push(comandoInteiro);
    }

    assert.deepEqual(
      problemas,
      [] as string[],
      "estas chamadas à AWS não redirecionam a saída, e a saída delas tem as variáveis de " +
        `ambiente com os valores dentro:\n  ${problemas.join("\n  ")}`,
    );
  });

  it("os valores herdados são marcados como segredo no GitHub", () => {
    assert.match(
      workflow,
      /::add-mask::/,
      "publicar.yml não marca os valores herdados como segredo — sem isso, uma mensagem de " +
        "erro que ninguém previu pode imprimir a senha do banco no log",
    );
  });
});
