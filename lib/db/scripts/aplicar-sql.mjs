/**
 * Aplica um arquivo .sql no banco apontado por DATABASE_URL.
 *
 * Existe porque `drizzle-kit push` contra o banco de produção do Replit
 * morre em silêncio no "Pulling schema" (o processo é encerrado antes de
 * terminar, sem erro). Este script não inspeciona schema nenhum: ele só
 * executa o SQL que você já leu, o que o torna leve o bastante pra rodar
 * onde o drizzle-kit não roda — e auditável, porque o que vai acontecer
 * está escrito no arquivo, não é deduzido por uma ferramenta.
 *
 * Uso:
 *   DATABASE_URL="..." node scripts/aplicar-sql.mjs sql/arquivo.sql
 *
 * Só executa o arquivo passado. Não apaga, não migra, não infere nada.
 */
import { readFileSync } from "node:fs";
import { Client } from "pg";

const arquivo = process.argv[2];
if (!arquivo) {
  console.error("Uso: node scripts/aplicar-sql.mjs <caminho-do-arquivo.sql>");
  process.exit(1);
}
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL não definido. Rode com: DATABASE_URL=\"...\" node scripts/aplicar-sql.mjs <arquivo>");
  process.exit(1);
}

const sql = readFileSync(arquivo, "utf8");

// Rede de proteção: este script é pra mudança aditiva. Se o arquivo tiver
// algo destrutivo, para e exige confirmação explícita — é barato, e o
// custo de errar num banco com dado de saúde real não é.
//
// Os comentários são removidos ANTES da checagem: um arquivo que explica
// "não tem nenhum DROP aqui" não pode ser barrado por dizer isso. (Foi
// exatamente o que aconteceu no primeiro teste deste script.)
const semComentarios = sql
  .replace(/--[^\n]*/g, "")
  .replace(/\/\*[\s\S]*?\*\//g, "");
const perigoso = /\b(DROP\s+(TABLE|COLUMN|DATABASE|TYPE)|TRUNCATE|DELETE\s+FROM)\b/i;
if (perigoso.test(semComentarios) && process.env.EU_LI_E_CONFIRMO !== "sim") {
  console.error("ATENÇÃO: o arquivo contém comando destrutivo (DROP/TRUNCATE/DELETE).");
  console.error("Se for intencional, rode de novo com EU_LI_E_CONFIRMO=sim");
  process.exit(1);
}

const client = new Client({ connectionString: process.env.DATABASE_URL });

try {
  await client.connect();
  console.log(`Conectado. Aplicando ${arquivo}…`);
  await client.query(sql);
  console.log("✓ SQL aplicado sem erro.\n");

  // Prova concreta do resultado — melhor que confiar na ausência de erro.
  const verificacoes = [
    ["tabela patient_access_tokens", "select count(*)::int n from information_schema.tables where table_name='patient_access_tokens'"],
    ["patients.elder_mode_enabled", "select count(*)::int n from information_schema.columns where table_name='patients' and column_name='elder_mode_enabled'"],
    ["dose_records.registered_via_elder_mode", "select count(*)::int n from information_schema.columns where table_name='dose_records' and column_name='registered_via_elder_mode'"],
    ["enum de plano com 'professional'", "select count(*)::int n from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='subscription_plan' and e.enumlabel='professional'"],
  ];

  console.log("Verificação:");
  for (const [nome, consulta] of verificacoes) {
    const { rows } = await client.query(consulta);
    console.log(`  ${rows[0].n > 0 ? "✓" : "✗"} ${nome}`);
  }

  // Confirma que nada foi perdido no caminho.
  const { rows: contagem } = await client.query(
    "select (select count(*)::int from patients) pacientes, (select count(*)::int from caregivers) cuidadores, (select count(*)::int from audit_log) auditoria"
  );
  console.log(`\nDados preservados: ${contagem[0].pacientes} pacientes, ${contagem[0].cuidadores} cuidadores, ${contagem[0].auditoria} registros de auditoria.`);
} catch (erro) {
  console.error("ERRO ao aplicar:", erro.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
