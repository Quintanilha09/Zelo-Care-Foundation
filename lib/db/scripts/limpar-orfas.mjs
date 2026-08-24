#!/usr/bin/env node
/**
 * Remove famílias órfãs deixadas pela suíte de testes.
 *
 * ── O problema ────────────────────────────────────────────────────────────
 *
 * Os testes de integração criam família via cadastro, e o `after` de cada um
 * apaga o USUÁRIO — não a família. Como `families` não tem cascade a partir de
 * `users` (uma família pode legitimamente sobreviver a um usuário), a família
 * fica para trás. Em 24/08/2026 havia ~90 delas no banco de dev.
 *
 * Não afeta produção e não quebra nada, mas cresce a cada rodada e atrapalha
 * qualquer inspeção — foi por isso que a família real do fundador (id 221)
 * ficou perdida no meio da listagem de planos.
 *
 * ── O critério ────────────────────────────────────────────────────────────
 *
 * Só apaga família que é **lixo por definição**: sem nenhum cuidador E sem
 * nenhum paciente. Uma família sem cuidador não pode ser acessada por ninguém —
 * não existe login que chegue nela.
 *
 * NÃO usa o nome como critério. "Família de Teste Auth" parece resíduo, mas
 * apagar por nome apagaria uma família real de alguém que se chame Teste.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/limpar-orfas.mjs              # simula, não apaga nada
 *   node scripts/limpar-orfas.mjs --apagar     # apaga de verdade
 *
 * Exige DATABASE_URL. Roda em transação: ou apaga tudo, ou nada.
 */
import pg from "pg";

const APAGAR = process.argv.includes("--apagar");

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não está definida.");
  console.error("No Replit ela já existe no ambiente; localmente, use o .env.local do api-server.");
  process.exit(1);
}

const SELECT_ORFAS = `
  SELECT f.id, f.name
  FROM families f
  WHERE NOT EXISTS (SELECT 1 FROM caregivers c WHERE c.family_id = f.id)
    AND NOT EXISTS (SELECT 1 FROM patients  p WHERE p.family_id = f.id)
  ORDER BY f.id
`;

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  const { rows: orfas } = await client.query(SELECT_ORFAS);
  const { rows: [{ total }] } = await client.query("SELECT count(*)::int AS total FROM families");

  console.log("");
  console.log(`Famílias no banco:  ${total}`);
  console.log(`Órfãs encontradas:  ${orfas.length}   (sem cuidador e sem paciente)`);

  if (orfas.length === 0) {
    console.log("");
    console.log("Nada a limpar.");
    process.exit(0);
  }

  console.log("");
  for (const f of orfas.slice(0, 15)) {
    console.log(`  ${String(f.id).padStart(5)} | ${f.name}`);
  }
  if (orfas.length > 15) console.log(`  … e mais ${orfas.length - 15}`);

  if (!APAGAR) {
    console.log("");
    console.log("SIMULAÇÃO — nada foi apagado.");
    console.log("Para apagar de verdade:  node scripts/limpar-orfas.mjs --apagar");
    process.exit(0);
  }

  // Transação: ou apaga todas, ou nenhuma. Uma limpeza pela metade deixaria o
  // banco num estado que ninguém pediu.
  await client.query("BEGIN");
  const ids = orfas.map((f) => f.id);
  const { rowCount } = await client.query("DELETE FROM families WHERE id = ANY($1::int[])", [ids]);
  await client.query("COMMIT");

  // Confere o resultado em vez de confiar na ausência de erro — mesma regra do
  // aplicar-sql.mjs, aprendida quando o drizzle-kit morria em silêncio.
  const { rows: sobraram } = await client.query(SELECT_ORFAS);

  console.log("");
  console.log(`Apagadas: ${rowCount}`);
  console.log(`Órfãs restantes: ${sobraram.length}`);
  if (sobraram.length > 0) {
    console.log("Sobrou órfã depois do DELETE — investigar antes de rodar de novo.");
    process.exit(1);
  }
} catch (erro) {
  await client.query("ROLLBACK").catch(() => {});
  console.error("");
  console.error("Falhou, nada foi apagado:", erro instanceof Error ? erro.message : erro);
  process.exit(1);
} finally {
  await client.end();
}
