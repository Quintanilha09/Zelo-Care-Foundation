import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import pg from "pg";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL must be set. Did you forget to provision a database?");
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sqlDir = path.join(__dirname, "../sql").replace(/\\/g, "/");

const files = [
  "audit-log-immutability.sql",
];

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

for (const file of files) {
  const sql = readFileSync(path.join(sqlDir, file), "utf-8");
  console.log(`Aplicando ${file}...`);
  await pool.query(sql);
}

await pool.end();
console.log("SQL cru aplicado com sucesso.");
