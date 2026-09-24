import { defineConfig } from "drizzle-kit";
import path from "path";

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL, ensure the database is provisioned");
}

export default defineConfig({
  schema: path.join(__dirname, "./src/schema/index.ts").replace(/\\/g, "/"),
  dialect: "postgresql",
  /**
   * Onde os arquivos de migração vivem — Issue #198.
   *
   * ═══════════════════════════════════════════════════════════════════════
   * ANTES DISTO NÃO HAVIA MIGRAÇÃO NENHUMA, E O CAMINHO PARA PRODUÇÃO ERA
   * O `push`, QUE JÁ OFERECEU APAGAR O HISTÓRICO DE DOSE.
   *
   * Em 12/09/2026, rodando `drizzle-kit push`, ele perguntou:
   *
   *   "You are about to add uq_treatment_scheduled_at unique constraint to
   *    the table, which contains 112 items. […] Do you want to truncate
   *    scheduled_doses table?"
   *
   * `scheduled_doses` é o histórico de dose. Um "sim" distraído num terminal
   * apaga o registro de todo remédio que toda família já tomou.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * Os arquivos daqui são versionados no git: eles são o histórico do banco,
   * e a única forma de saber o que produção tem sem abrir produção.
   *
   * ── Por que o caminho é relativo ────────────────────────────────────────
   *
   * Com `out` absoluto, o `drizzle-kit generate --custom` concatena o caminho
   * duas vezes e falha (`lib/db/C:/…/lib/db/migrations`). O `generate` comum
   * funciona, então o defeito só aparece na migração escrita à mão — que é
   * justamente a do gatilho de imutabilidade. Os scripts deste pacote rodam
   * com o diretório dele como raiz, então `./migrations` resolve certo sempre.
   */
  out: "./migrations",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
