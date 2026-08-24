#!/usr/bin/env node
/**
 * check-clock-usage — nenhuma lógica de domínio lê o relógio do sistema.
 *
 * REGRA: código de domínio usa `Clock.now()` / `Clock.todayInTimezone()`, nunca
 * `new Date()` sem argumentos nem `Date.now()`.
 *
 * NÃO são violações:
 *   new Date(algumValor)      — converte entrada em Date
 *   new Date(Clock.now())     — copia um Date produzido pelo Clock
 *
 * ── Por que este script deixou de ser bash — 23/08/2026 ───────────────────
 *
 * A versão anterior era `grep` puro e **não distinguia código de comentário**.
 * Resultado: acusava as próprias linhas que explicavam a regra, como
 * `// Deliberadamente new Date(), não Clock.now()` e `// jwt.sign usa Date.now()`.
 *
 * Eram 4 falsos positivos contra 1 violação real — e a primeira execução de
 * verdade no CI (23/08/2026) mostrou que o lint estava vermelho havia tempo,
 * sem ninguém rodar. Um lint que grita errado é um lint que se aprende a ignorar,
 * e aí ele deixa de proteger. Este arquivo remove comentários e strings antes de
 * procurar, então o que ele aponta é sempre código executável.
 *
 * ── Exceção deliberada ────────────────────────────────────────────────────
 *
 * Marque a linha com `clock-lint-ok: <motivo>` num comentário. O motivo é
 * obrigatório — exceção sem justificativa é violação disfarçada.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative, sep } from "node:path";

const AQUI = dirname(fileURLToPath(import.meta.url));
const RAIZ_SRC = join(AQUI, "..", "src");

/** Arquivos que podem ler o relógio: a própria abstração, testes e seed. */
const ISENTOS = [/clock\.ts$/, /\.test\.ts$/, /seed\.ts$/];

const REGRAS = [
  { nome: "new Date() sem argumentos", padrao: /new\s+Date\(\s*\)/ },
  { nome: "Date.now()", padrao: /Date\.now\(\s*\)/ },
  { nome: "Date.UTC() sem argumentos", padrao: /Date\.UTC\(\s*\)/ },
];

const PRAGMA = /clock-lint-ok:\s*\S/;

/**
 * Apaga comentários e literais de string, preservando o comprimento das linhas
 * para que o número da linha continue exato no relatório.
 */
function apenasCodigo(fonte) {
  const saida = fonte.split("");
  let i = 0;
  const n = fonte.length;
  let estado = "codigo"; // codigo | linha | bloco | aspas | apostrofo | template

  const apagar = (ate) => {
    for (let k = i; k < ate && k < n; k++) {
      if (saida[k] !== "\n") saida[k] = " ";
    }
  };

  while (i < n) {
    const c = fonte[i];
    const prox = fonte[i + 1];

    if (estado === "codigo") {
      if (c === "/" && prox === "/") { estado = "linha"; continue; }
      if (c === "/" && prox === "*") { estado = "bloco"; continue; }
      if (c === '"') { estado = "aspas"; i++; continue; }
      if (c === "'") { estado = "apostrofo"; i++; continue; }
      if (c === "`") { estado = "template"; i++; continue; }
      i++;
      continue;
    }

    if (estado === "linha") {
      const fim = fonte.indexOf("\n", i);
      const ate = fim === -1 ? n : fim;
      apagar(ate);
      i = ate;
      estado = "codigo";
      continue;
    }

    if (estado === "bloco") {
      const fim = fonte.indexOf("*/", i);
      const ate = fim === -1 ? n : fim + 2;
      apagar(ate);
      i = ate;
      estado = "codigo";
      continue;
    }

    // dentro de string: apaga o conteúdo até o fechamento, respeitando escape
    const fecha = estado === "aspas" ? '"' : estado === "apostrofo" ? "'" : "`";
    if (c === "\\") { apagar(i + 2); i += 2; continue; }
    if (c === fecha) { i++; estado = "codigo"; continue; }
    // template literal com ${...}: o interior É código, então não apaga
    if (estado === "template" && c === "$" && prox === "{") {
      const fim = fonte.indexOf("}", i);
      i = fim === -1 ? n : fim + 1;
      continue;
    }
    apagar(i + 1);
    i++;
  }

  return saida.join("");
}

function arquivosTs(dir) {
  const encontrados = [];
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      encontrados.push(...arquivosTs(caminho));
    } else if (nome.endsWith(".ts") && !ISENTOS.some((r) => r.test(caminho))) {
      encontrados.push(caminho);
    }
  }
  return encontrados;
}

const violacoes = [];
const excecoes = [];

for (const caminho of arquivosTs(RAIZ_SRC)) {
  const originais = readFileSync(caminho, "utf8").split(/\r?\n/);
  const limpas = apenasCodigo(readFileSync(caminho, "utf8")).split(/\r?\n/);

  limpas.forEach((linhaLimpa, idx) => {
    for (const regra of REGRAS) {
      if (!regra.padrao.test(linhaLimpa)) continue;
      const original = originais[idx] ?? "";
      const rel = relative(join(AQUI, "..", "..", ".."), caminho).split(sep).join("/");
      const ref = `${rel}:${idx + 1}`;
      if (PRAGMA.test(original)) {
        excecoes.push(`${ref}  ${original.trim()}`);
      } else {
        violacoes.push({ regra: regra.nome, ref, texto: original.trim() });
      }
    }
  });
}

if (excecoes.length > 0) {
  console.log(`\nℹ  ${excecoes.length} exceção(ões) declarada(s) com clock-lint-ok:`);
  for (const e of excecoes) console.log(`    ${e}`);
}

if (violacoes.length === 0) {
  console.log("\n✅  check-clock-usage: nenhuma leitura direta do relógio do sistema em código.");
  console.log("    Comentários e strings são ignorados; new Date(valor) é permitido.");
  process.exit(0);
}

const porRegra = new Map();
for (const v of violacoes) {
  if (!porRegra.has(v.regra)) porRegra.set(v.regra, []);
  porRegra.get(v.regra).push(v);
}

for (const [regra, lista] of porRegra) {
  console.error(`\n❌  VIOLAÇÃO DE RELÓGIO: ${regra} lê o relógio do sistema`);
  for (const v of lista) console.error(`    ${v.ref}\n        ${v.texto}`);
}

console.error("\n💡  Use Clock.now() em vez de new Date() ou Date.now().");
console.error("    Abstração: artifacts/api-server/src/lib/clock.ts");
console.error("    Exceção legítima: marque a linha com `clock-lint-ok: <motivo>` — o motivo é obrigatório.");
process.exit(1);
