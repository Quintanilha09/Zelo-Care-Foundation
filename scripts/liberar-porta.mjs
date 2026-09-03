#!/usr/bin/env node
/**
 * Mata quem estiver escutando numa porta, para o workflow poder subir.
 *
 * ── Por que isto existe ───────────────────────────────────────────────────
 *
 * No Replit, o botão Run monta sozinho um workflow "Project" que roda os três
 * workflows em paralelo — ele não está no `.replit`, é gerado a partir do
 * `runButton`. Com ele ligado, as três portas estão ocupadas, e clicar em play
 * num workflow individual falha com `EADDRINUSE` sem dizer por quê.
 *
 * O mesmo acontece depois de subir um servidor à mão no Shell (o que este
 * projeto exige para testar e-mail, porque o workflow roda em modo
 * desenvolvimento e ali nenhum e-mail sai).
 *
 * O sintoma é sempre o mesmo e a causa nunca aparece na tela: o workflow
 * simplesmente não inicia.
 *
 * ── Por que ler /proc, e não usar `lsof`, `fuser` ou `ss` ─────────────────
 *
 * Nenhum dos três existe nesta imagem. Verificado em 03/09/2026: `ss` responde
 * `command not found`, e o `fuser` fez o Nix sugerir instalar o `psmisc`.
 *
 * Depender de binário que não está lá seria trocar um erro silencioso por
 * outro. `/proc` é o mesmo lugar de onde essas ferramentas leem, e está sempre
 * presente no Linux.
 *
 * ── O que ele NÃO faz ─────────────────────────────────────────────────────
 *
 * Não mata por nome, nem por padrão de linha de comando. Só quem estiver
 * **escutando naquela porta** — que é exatamente quem impediria o workflow de
 * subir. Um `pkill -f` seria mais curto e mataria junto o que não devia,
 * inclusive a si mesmo (já aconteceu nesta sessão).
 *
 * Uso:  node scripts/liberar-porta.mjs 22427
 */
import { readFileSync, readdirSync, readlinkSync } from "node:fs";

const porta = Number(process.argv[2]);
if (!Number.isInteger(porta) || porta <= 0 || porta > 65535) {
  console.error("uso: node scripts/liberar-porta.mjs <porta>");
  process.exit(1);
}

/** Inodes dos sockets em LISTEN naquela porta, em IPv4 e IPv6. */
function inodesEscutando(porta) {
  const alvo = porta.toString(16).toUpperCase().padStart(4, "0");
  const inodes = new Set();

  for (const arquivo of ["/proc/net/tcp", "/proc/net/tcp6"]) {
    let conteudo;
    try {
      conteudo = readFileSync(arquivo, "utf8");
    } catch {
      continue; // IPv6 pode não existir; não é motivo para falhar.
    }
    for (const linha of conteudo.split("\n").slice(1)) {
      const campos = linha.trim().split(/\s+/);
      if (campos.length < 10) continue;
      const [, endereco, , estado] = campos;
      // 0A = TCP_LISTEN. Conexão estabelecida na mesma porta não interessa:
      // quem bloqueia o `bind` é quem escuta.
      if (estado !== "0A") continue;
      if (endereco?.split(":")[1] !== alvo) continue;
      inodes.add(campos[9]);
    }
  }
  return inodes;
}

function pidsComInode(inodes) {
  const pids = new Set();
  if (inodes.size === 0) return pids;

  for (const entrada of readdirSync("/proc")) {
    if (!/^\d+$/.test(entrada)) continue;
    let fds;
    try {
      fds = readdirSync(`/proc/${entrada}/fd`);
    } catch {
      continue; // processo de outro dono, ou que morreu no meio da varredura
    }
    for (const fd of fds) {
      try {
        const alvo = readlinkSync(`/proc/${entrada}/fd/${fd}`);
        const m = /^socket:\[(\d+)\]$/.exec(alvo);
        if (m && inodes.has(m[1])) pids.add(Number(entrada));
      } catch {
        // fd fechado entre o readdir e o readlink
      }
    }
  }
  return pids;
}

const pids = pidsComInode(inodesEscutando(porta));

if (pids.size === 0) {
  console.log(`[liberar-porta] ${porta} já está livre.`);
  process.exit(0);
}

for (const pid of pids) {
  if (pid === process.pid) continue;
  try {
    process.kill(pid, "SIGTERM");
    console.log(`[liberar-porta] ${porta} estava com o pid ${pid} — encerrado.`);
  } catch (erro) {
    console.log(
      `[liberar-porta] não consegui encerrar o pid ${pid}: ${
        erro instanceof Error ? erro.message : String(erro)
      }`,
    );
  }
}

// SIGTERM é assíncrono: sem esta folga, o servidor novo tenta o `bind` antes
// de o antigo soltar o socket, e o workflow falha do mesmo jeito.
await new Promise((r) => setTimeout(r, 400));
