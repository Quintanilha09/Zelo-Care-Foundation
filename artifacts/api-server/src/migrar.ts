/**
 * Aplicar as migrações do banco — Issue #201.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO EXISTE, SE JÁ HAVIA `pnpm --filter @workspace/db run migrate`.
 *
 * Aquele comando é o `drizzle-kit migrate`, e o `drizzle-kit` é dependência de
 * DESENVOLVIMENTO. A imagem de produção é montada com `pnpm deploy --prod`
 * (ver Dockerfile), que traz só as dependências de produção — então o
 * `drizzle-kit` não existe lá dentro, e não deve existir: ele é uma ferramenta
 * com poder de comparar esquema e aplicar diferença, e o caminho de produção
 * não pode ter essa capacidade à mão.
 *
 * O que existe na imagem é o `drizzle-orm`, que é dependência de produção e
 * traz o mesmo aplicador de migrações por baixo. É ele que este arquivo usa.
 *
 * ── E os dois caminhos são o MESMO caminho ────────────────────────────────
 *
 * `drizzle-kit migrate` e o `migrate()` do `drizzle-orm` leem o mesmo
 * `meta/_journal.json`, aplicam os mesmos arquivos `.sql` na mesma ordem e
 * registram o que já foi aplicado na MESMA tabela — `drizzle.__drizzle_migrations`.
 * Medido em 28/09/2026 contra um PostgreSQL 18.6 vazio: aplicar por um e
 * depois rodar o outro resulta em zero migração nova, nos dois sentidos.
 *
 * Isso importa porque o CI usa `drizzle-kit migrate` e produção usa este
 * arquivo. Se fossem contabilidades diferentes, produção reaplicaria tudo.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Onde ele roda: DENTRO da AWS, e não na esteira ────────────────────────
 *
 * O `zelo-db` é privado (`Public mode: disabled`). Só recurso Lightsail da
 * mesma região o alcança — nem a máquina de quem desenvolve, nem o runner do
 * GitHub Actions. Por isso a esteira não roda migração: ela cria um
 * *deployment descartável* no serviço de contêiner, com esta imagem e este
 * comando, e lê o resultado no log.
 *
 * ── E NÃO no boot do app ──────────────────────────────────────────────────
 *
 * Migrar no `CMD` do app parece mais simples e é uma armadilha: com mais de um
 * nó, dois processos migram ao mesmo tempo. Hoje a escala é 1
 * (planning/runbooks/escala-do-servico.md), mas a escala é um seletor numa
 * tela de console — e proteção que depende de ninguém clicar não é proteção.
 *
 * ── O log deste script é lido por robô ────────────────────────────────────
 *
 * A esteira decide publicar ou parar procurando uma das duas marcas abaixo no
 * log do contêiner. Elas são contrato: mudar o texto quebra a esteira.
 *
 *   ZELO-MIGRACAO-OK       terminou, o banco está no esquema desta imagem
 *   ZELO-MIGRACAO-FALHOU   não terminou; NÃO publique app novo
 *
 * **Ausência de marca também é falha.** A esteira só publica vendo o OK — se o
 * contêiner morrer antes de imprimir qualquer coisa, o deploy para. É o
 * padrão seguro: o silêncio nunca é interpretado como sucesso.
 *
 * ── Nada de segredo no log ────────────────────────────────────────────────
 *
 * O log do contêiner é lido pela esteira e fica visível no console da AWS.
 * `DATABASE_URL` tem a senha do banco dentro, então ela não é impressa nunca —
 * nem em erro. Os erros do `pg` são reduzidos a `error.message`, e a
 * `connectionString` não aparece lá.
 */
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import pg from "pg";

const { Pool } = pg;

export const MARCA_OK = "ZELO-MIGRACAO-OK";
export const MARCA_FALHOU = "ZELO-MIGRACAO-FALHOU";

/**
 * Onde estão os arquivos de migração.
 *
 * São dois lugares porque são dois contextos, e nenhum dos dois é palpite:
 *
 *   na imagem      /app/migrations       (o Dockerfile copia lib/db/migrations para cá)
 *   no repositório lib/db/migrations     (rodando com tsx a partir de artifacts/api-server/src)
 *
 * A ordem importa: a imagem primeiro, porque é o caminho de produção e é o que
 * não pode depender de sorte. `ZELO_MIGRACOES_DIR` existe para o caso de
 * alguém precisar apontar para outro lugar — e para o teste.
 */
export function encontrarMigracoes(): string {
  const daImagem = fileURLToPath(new URL("../migrations/", import.meta.url));
  const doRepositorio = fileURLToPath(
    new URL("../../../lib/db/migrations/", import.meta.url),
  );

  const candidatos = [process.env.ZELO_MIGRACOES_DIR, daImagem, doRepositorio].filter(
    (c): c is string => typeof c === "string" && c.length > 0,
  );

  for (const candidato of candidatos) {
    if (existsSync(`${candidato.replace(/[\\/]$/, "")}/meta/_journal.json`)) {
      return candidato;
    }
  }

  throw new Error(
    `nao encontrei a pasta de migracoes. Procurei, nesta ordem: ${candidatos.join(", ")}. ` +
      "Uma pasta de migracoes valida tem um meta/_journal.json dentro.",
  );
}

async function principal(): Promise<void> {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL nao esta definida. Na AWS ela vem do proprio deployment do " +
        "servico: a esteira copia o ambiente do app para o conteiner de migracao, " +
        "de proposito, para nao existir um segundo caminho ate o banco.",
    );
  }

  const pasta = encontrarMigracoes();
  console.log(`[migracao] pasta de migracoes: ${pasta}`);

  /**
   * Pool próprio, e não o `pool` exportado por `@workspace/db`.
   *
   * Aquele é criado na CARGA do módulo e nasce junto com o esquema inteiro do
   * Drizzle. Aqui o processo existe para uma coisa só e precisa TERMINAR — um
   * pool esquecido aberto segura o `node` de pé, e um contêiner de migração
   * que não morre vira um deployment pendurado.
   *
   * `max: 1` porque migração é sequencial: mais de uma conexão não acelera
   * nada e abre espaço para duas coisas correrem juntas.
   */
  const pool = new Pool({
    connectionString: url,
    max: 1,
    connectionTimeoutMillis: 30_000,
  });

  try {
    const db = drizzle(pool);
    const comeco = Date.now(); // clock-lint-ok: cronometro de duracao para o log, nao tempo de dominio
    await migrate(db, { migrationsFolder: pasta });
    const segundos = ((Date.now() - comeco) / 1000).toFixed(1); // clock-lint-ok: idem

    // Quantas migrações o banco conhece agora. É o número que responde
    // "este banco está no esquema desta imagem?" sem abrir o banco.
    const { rows } = await pool.query<{ total: string }>(
      "select count(*)::text as total from drizzle.__drizzle_migrations",
    );
    console.log(
      `[migracao] ${rows[0]?.total ?? "?"} migracoes aplicadas no total, em ${segundos}s`,
    );
    console.log(MARCA_OK);
  } finally {
    await pool.end();
  }
}

/**
 * Só executa quando ESTE arquivo é o programa.
 *
 * Sem esta guarda, importar o módulo num teste abriria conexão com o banco e
 * tentaria migrar — o teste de `encontrarMigracoes()` passaria a depender de
 * ter banco de pé, que é exatamente o tipo de acoplamento que faz um
 * guardrail ser desligado depois.
 */
const souOPrograma =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (souOPrograma) {
  principal()
    .then(() => process.exit(0))
    .catch((erro: unknown) => {
      // ── Por que a cadeia de causas, e não só a mensagem de cima ─────────
      //
      // Medido em 28/09/2026, rodando esta imagem contra um banco com a senha
      // errada: o Drizzle embrulha o erro e a mensagem dele é
      //
      //   Failed query: CREATE SCHEMA IF NOT EXISTS "drizzle"
      //
      // que não diz nada. O motivo de verdade — `password authentication
      // failed for user "zelo"` — está em `error.cause`. Quem lê este log
      // está parado com um deploy pela metade; esconder a causa dentro de um
      // campo que ninguém imprime é o pior momento possível para economizar
      // três linhas.
      //
      // Só `message` de cada elo, nunca o objeto: o erro do `pg` carrega a
      // configuração da conexão em algumas versões, e ela tem a senha dentro.
      let atual: unknown = erro;
      let nivel = 0;
      while (atual !== undefined && atual !== null && nivel < 5) {
        const mensagem = atual instanceof Error ? atual.message : String(atual);
        console.error(`[migracao] ERRO${nivel > 0 ? ` (causa ${nivel})` : ""}: ${mensagem}`);
        atual = atual instanceof Error ? atual.cause : undefined;
        nivel++;
      }
      console.error(MARCA_FALHOU);
      process.exit(1);
    });
}
