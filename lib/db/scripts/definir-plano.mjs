#!/usr/bin/env node
/**
 * Define o plano de uma família — ferramenta de operação, não rota de API.
 *
 * ── Por que isto existe ───────────────────────────────────────────────────
 *
 * Em 24/08/2026 o fundador relatou dois "bugs" que impediam o uso do app:
 * não conseguia agendar consulta nem salvar tratamento. Nenhum dos dois era
 * falha de gravação — eram os limites do plano gratuito, que a tela não
 * mostrava. A conta de teste dele estava presa nos mesmos limites de um
 * usuário comum, então metade do produto era inalcançável para quem precisa
 * testar o produto inteiro.
 *
 * A saída correta NÃO é dar superpoder a uma conta: seria uma fronteira de
 * autorização nova, escrita às pressas, num app de saúde. É mudar o DADO —
 * a família de teste passa a ter uma assinatura ativa, exatamente como uma
 * família pagante teria. O código de autorização continua um só, e o que se
 * testa é o caminho real, não um desvio.
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *
 *   node scripts/definir-plano.mjs --listar
 *   node scripts/definir-plano.mjs --familia 221 --plano professional
 *   node scripts/definir-plano.mjs --familia 221 --plano free
 *
 * Planos: free | basic | premium | professional
 *   basic e premium resolvem para o tier "Família"; professional é o tier de
 *   maior capacidade. Ver artifacts/api-server/src/lib/plan-limits.ts.
 *
 * Exige DATABASE_URL no ambiente.
 */
import pg from "pg";

const PLANOS = ["free", "basic", "premium", "professional"];

function arg(nome) {
  const i = process.argv.indexOf(`--${nome}`);
  return i === -1 ? null : process.argv[i + 1] ?? null;
}
const temFlag = (nome) => process.argv.includes(`--${nome}`);

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL não está definida.");
  console.error("No Replit ela já existe no ambiente; localmente, use o .env.local do api-server.");
  process.exit(1);
}

const client = new pg.Client({ connectionString: url });
await client.connect();

try {
  if (temFlag("listar") || (!arg("familia") && !arg("plano"))) {
    const { rows } = await client.query(`
      SELECT f.id,
             f.name,
             -- ::text antes do COALESCE: plan e status sao ENUM no Postgres,
             -- e ele tenta converter o valor padrao para o enum antes de
             -- comparar. Sem o cast, '—' vira 'invalid input value for enum'.
             COALESCE(s.plan::text, 'free')   AS plano,
             COALESCE(s.status::text, 'sem')  AS status,
             (SELECT count(*) FROM patients p WHERE p.family_id = f.id AND p.archived = false) AS pacientes
      FROM families f
      LEFT JOIN subscriptions s ON s.family_id = f.id
      ORDER BY f.id
    `);
    if (rows.length === 0) {
      console.log("Nenhuma família cadastrada.");
    } else {
      console.log("");
      console.log(" ID  | Plano        | Status   | Pac. | Família");
      console.log("-----|--------------|----------|------|--------------------------------");
      for (const r of rows) {
        console.log(
          String(r.id).padStart(4) + " | " +
          String(r.plano).padEnd(12) + " | " +
          String(r.status).padEnd(8) + " | " +
          String(r.pacientes).padStart(4) + " | " +
          r.name
        );
      }
      console.log("");
      // Nada de <id> aqui: o bash le `<` como redirecionamento, e quem copia a
      // linha recebe "id: No such file or directory". Exemplo real, copiável.
      const exemplo = rows.find((r) => Number(r.pacientes) > 0) ?? rows[0];
      console.log("Para mudar, use um dos ids acima. Por exemplo:");
      console.log(`  node scripts/definir-plano.mjs --familia ${exemplo.id} --plano professional`);
    }
    process.exit(0);
  }

  const familiaId = Number(arg("familia"));
  const plano = arg("plano");

  if (!Number.isInteger(familiaId) || familiaId <= 0) {
    console.error("--familia precisa de um id inteiro. Use --listar para ver os ids.");
    process.exit(1);
  }
  if (!PLANOS.includes(plano)) {
    console.error(`--plano precisa ser um de: ${PLANOS.join(", ")}`);
    process.exit(1);
  }

  const { rows: familias } = await client.query("SELECT id, name FROM families WHERE id = $1", [familiaId]);
  if (familias.length === 0) {
    console.error(`Família ${familiaId} não existe. Rode com --listar para ver os ids disponíveis.`);
    process.exit(1);
  }

  // status "active" porque getPlanTier() só considera pagante quem está
  // active ou trialing; expires_at nulo = sem vencimento, que é o que se quer
  // numa conta de teste.
  const { rows: existente } = await client.query(
    "SELECT id FROM subscriptions WHERE family_id = $1 LIMIT 1",
    [familiaId]
  );

  if (existente.length > 0) {
    await client.query(
      "UPDATE subscriptions SET plan = $1, status = 'active', expires_at = NULL, updated_at = now() WHERE family_id = $2",
      [plano, familiaId]
    );
  } else {
    await client.query(
      "INSERT INTO subscriptions (family_id, plan, status, expires_at) VALUES ($1, $2, 'active', NULL)",
      [familiaId, plano]
    );
  }

  // Verifica o resultado em vez de confiar na ausência de erro — mesma regra
  // do aplicar-sql.mjs, aprendida quando o drizzle-kit morria em silêncio.
  const { rows: depois } = await client.query(
    "SELECT plan, status FROM subscriptions WHERE family_id = $1",
    [familiaId]
  );

  console.log("");
  console.log(`Família ${familiaId} (${familias[0].name})`);
  console.log(`  plano:  ${depois[0].plan}`);
  console.log(`  status: ${depois[0].status}`);
  console.log("");
  console.log("Reinicie o workflow da API para garantir que nada ficou em cache, e recarregue o app.");
} finally {
  await client.end();
}
