/**
 * Restaurar uma cópia de segurança — Issue #199.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO É METADE DO BACKUP.
 *
 * Um arquivo cifrado que ninguém sabe abrir não é cópia de segurança, é um
 * blob. Quem for usar isto vai estar num dia ruim, provavelmente de
 * madrugada, provavelmente sem tempo de ler código. Por isso o comando é um
 * só, os erros dizem o que fazer, e nada aqui depende de lembrar de nada.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Uso ───────────────────────────────────────────────────────────────────
 *
 *   tsx src/restaurar-backup.ts \
 *     --arquivo ./zelo-2026-09-24T15-10-00Z.dump.zbk \
 *     --chave-privada ./chave-privada.pem \
 *     --destino "postgresql://usuario:senha@host:5432/banco_novo"
 *
 * Ou, para só abrir o arquivo e olhar antes de restaurar:
 *
 *   tsx src/restaurar-backup.ts --arquivo … --chave-privada … --somente-decifrar
 *
 * ── A chave privada ───────────────────────────────────────────────────────
 *
 * Ela NUNCA esteve na AWS. Está no cofre de senhas do fundador. Sem ela não há
 * restauração — nem por ele, nem pela AWS, nem por ninguém. É por desenho:
 * é o que torna o arquivo no bucket inútil para quem o pegar.
 *
 * ── RESTAURE NUM BANCO NOVO ───────────────────────────────────────────────
 *
 * O `--destino` deve apontar para um banco VAZIO, criado para isto. Restaurar
 * por cima de um banco em uso mistura dado antigo com novo, e a mistura é pior
 * que qualquer um dos dois sozinhos.
 */
import { readFileSync, writeFileSync, unlinkSync } from "node:fs";
import { spawn } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
import crypto from "node:crypto";

import { decifrar } from "./lib/backup-cifra.ts";

function argumento(nome: string): string | undefined {
  const i = process.argv.indexOf(`--${nome}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

function temBandeira(nome: string): boolean {
  return process.argv.includes(`--${nome}`);
}

function morrer(mensagem: string): never {
  console.error(`\n  ERRO: ${mensagem}\n`);
  console.error("  Uso:");
  console.error("    tsx src/restaurar-backup.ts --arquivo <copia.zbk> \\");
  console.error("      --chave-privada <chave.pem> \\");
  console.error('      --destino "postgresql://usuario:senha@host:5432/banco_novo"');
  console.error("");
  console.error("    Acrescente --somente-decifrar para so abrir o arquivo, sem restaurar.\n");
  process.exit(1);
}

const caminhoDoArquivo = argumento("arquivo");
const caminhoDaChave = argumento("chave-privada");
const destino = argumento("destino");
const somenteDecifrar = temBandeira("somente-decifrar");

if (!caminhoDoArquivo) morrer("falta --arquivo");
if (!caminhoDaChave) morrer("falta --chave-privada");
if (!destino && !somenteDecifrar) morrer("falta --destino (ou use --somente-decifrar)");

console.log(`  Lendo ${path.basename(caminhoDoArquivo)}...`);
const pacote = readFileSync(caminhoDoArquivo);
const chavePrivada = readFileSync(caminhoDaChave, "utf-8");

let despejo: Buffer;
try {
  despejo = decifrar(pacote, chavePrivada);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  morrer(
    `nao foi possivel decifrar: ${msg}\n` +
      "  Causas comuns: chave privada de outro par, arquivo corrompido no download,\n" +
      "  ou arquivo que nao e uma copia do ZELO.",
  );
}

console.log(`  Decifrado: ${(despejo.length / 1024 / 1024).toFixed(2)} MB`);

// Nome aleatório: dois operadores restaurando ao mesmo tempo na mesma máquina
// não podem sobrescrever o arquivo um do outro.
const temporario = path.join(tmpdir(), `zelo-restaurar-${crypto.randomUUID()}.dump`);
writeFileSync(temporario, despejo);

if (somenteDecifrar) {
  console.log(`\n  Despejo em claro: ${temporario}`);
  console.log("  APAGUE ESSE ARQUIVO quando terminar — ele e o banco inteiro, sem cifra.\n");
  process.exit(0);
}

const url = new URL(destino!);

const argumentos = [
  "--no-owner",
  "--no-privileges",
  "--host", url.hostname,
  "--port", url.port || "5432",
  "--username", decodeURIComponent(url.username),
  "--dbname", url.pathname.replace(/^\//, ""),
  temporario,
];

console.log(`  Restaurando em ${url.hostname}/${url.pathname.replace(/^\//, "")}...`);

const processo = spawn("pg_restore", argumentos, {
  // A senha vai por ambiente, e não na linha de comando: argumento de processo
  // é lido por qualquer `ps` da mesma máquina.
  env: { ...process.env, PGPASSWORD: decodeURIComponent(url.password) },
  stdio: ["ignore", "inherit", "inherit"],
});

processo.on("close", (codigo) => {
  try {
    unlinkSync(temporario);
  } catch {
    // Se não deu para apagar, o aviso abaixo é o que importa.
    console.error(`\n  ATENCAO: nao consegui apagar ${temporario}. Apague a mao.`);
  }

  if (codigo !== 0) {
    console.error(`\n  pg_restore terminou com codigo ${codigo}.`);
    console.error("  Avisos sobre objetos que ja existem sao normais num banco nao-vazio;");
    console.error("  erro de verdade em banco VAZIO nao e, e precisa ser lido.\n");
    process.exit(codigo ?? 1);
  }

  console.log("\n  Restaurado. Confira antes de apontar o app para ele:");
  console.log("    select count(*) from information_schema.tables where table_schema='public';");
  console.log("    select count(*) from dose_records;\n");
});
