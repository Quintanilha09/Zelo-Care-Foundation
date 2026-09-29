#!/usr/bin/env node
/**
 * Sobe o ZELO inteiro na máquina, com um comando — Issue #221.
 *
 * ── Por que isto existe ───────────────────────────────────────────────────
 *
 * Até 24/09/2026 o fundador testava no Replit: havia uma URL, ele abria no
 * celular, e pronto. O Replit foi cancelado. O que sobrou era subir Postgres,
 * exportar meia dúzia de variáveis, migrar, semear, subir a API e subir o
 * front — seis passos em três terminais, e qualquer um deles falhando em
 * silêncio deixa o front no ar conversando com ninguém.
 *
 * Este script é o botão Run que o Replit tinha.
 *
 * ── O que ele NÃO faz ─────────────────────────────────────────────────────
 *
 * Não mata processo de ninguém. Se a porta estiver ocupada ele diz qual é e
 * para — matar processo por conta própria na máquina de outra pessoa é o tipo
 * de ajuda que um dia mata a coisa errada.
 */

import { spawn, spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { networkInterfaces } from "node:os";
import { createConnection } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// ═══════════════════════════════════════════════════════════════════════════
// PORTAS DIFERENTES DAS DO PLAYWRIGHT, E ISSO É O PONTO MAIS IMPORTANTE AQUI.
//
// O `playwright.config.ts` usa 5000 (API) e 5173 (front), com
// `reuseExistingServer: !process.env.CI`. Ou seja: fora do CI, se já houver
// algo escutando nessas portas, o Playwright NÃO sobe as suas — ele usa as que
// achou.
//
// Se o ambiente local morasse em 5000/5173, rodar `pnpm test:e2e` com ele no ar
// faria a suíte inteira rodar contra o banco de desenvolvimento, criando e
// apagando dados no meio do que o fundador estivesse olhando. E passaria, o que
// é pior: nada avisaria.
//
// Por isso 5100 e 5273. As duas duplas convivem, e nenhuma enxerga a outra.
// ═══════════════════════════════════════════════════════════════════════════
const PORTA_API = 5100;
const PORTA_FRONT = 5273;

// ═══════════════════════════════════════════════════════════════════════════
// BANCO SEPARADO DO BANCO DE TESTE, PELO MESMO MOTIVO.
//
// `banco-de-teste-local.md` usa `zelo_dev`, e é lá que o `test:all` roda. A
// suíte de integração cria e apaga dados o tempo todo; apontar o ambiente de
// desenvolvimento para o mesmo banco significaria perder a família que o
// fundador acabou de montar, no meio do teste dele, sem aviso.
//
// Mesmo container, mesma porta, banco diferente.
// ═══════════════════════════════════════════════════════════════════════════
/**
 * A conta que a semente cria.
 *
 * Repetida aqui de propósito: quando o banner aparece, a saída da semente já
 * rolou para cima e sumiu. Se mudar em `artifacts/api-server/src/seed.ts`,
 * mude aqui — são os dois únicos lugares.
 */
const CONTA_DA_SEMENTE = {
  email: "joao.teste@zelo.test",
  senha: "zelo-local-123",
};

const CONTAINER = "zelo-test-pg";
const USUARIO_PG = "zelo_dev";
const BANCO_LOCAL = "zelo_local";
const PORTA_PG = 5433;
const URL_DO_BANCO = `postgresql://${USUARIO_PG}@localhost:${PORTA_PG}/${BANCO_LOCAL}`;

const filhos = [];
let encerrando = false;

// ── Utilidades ────────────────────────────────────────────────────────────

function passo(texto) {
  console.log(`\x1b[36m▸\x1b[0m ${texto}`);
}

function erro(texto) {
  console.error(`\x1b[31m✗\x1b[0m ${texto}`);
}

function ok(texto) {
  console.log(`\x1b[32m✓\x1b[0m ${texto}`);
}

// ═══════════════════════════════════════════════════════════════════════════
// SHELL SÓ PARA O `pnpm`, E ISSO CUSTOU UM BUG.
//
// No Windows o `pnpm` é um `.cmd`, e `spawn` sem `shell` não o encontra. A
// tentação é ligar `shell: true` para tudo — e foi o que eu fiz primeiro.
//
// Com `shell: true` o Node **re-junta os argumentos numa linha de comando**, e
// quem tem espaço dentro se parte em vários. Medido em 29/09/2026:
//
//   psql -U zelo_dev -c "CREATE DATABASE zelo_local"
//
// virou `-c CREATE`, `DATABASE`, `zelo_local`, e o psql respondeu
// `database "DATABASE" does not exist`. A mensagem não tem nada a ver com a
// causa, que é o pior tipo de erro.
//
// O `docker` é executável de verdade e não precisa de shell. Então: shell só
// onde é inevitável.
// ═══════════════════════════════════════════════════════════════════════════
// O `pnpm` vai como LINHA ÚNICA, e não como comando + lista de argumentos.
//
// Com `shell: true` e lista de argumentos, o Node avisa:
//
//   DeprecationWarning: Passing args to a child process with shell option true
//   can lead to security vulnerabilities, as the arguments are not escaped
//
// Ele tem razão — foi exatamente assim que o `CREATE DATABASE zelo_local` se
// partiu em três. Linha única não tem esse problema: quem escapa é o shell, e
// aqui todos os comandos são fixos, sem nada vindo de fora.
function pnpmOuParar(linha, oQueEra, opcoes = {}) {
  const r = spawnSync(linha, { cwd: RAIZ, stdio: "inherit", shell: true, ...opcoes });
  if (r.status !== 0) {
    erro(`${oQueEra} falhou.`);
    process.exit(1);
  }
}

/** Roda e devolve o resultado, sem derrubar o script no erro. */
function rodar(comando, args, opcoes = {}) {
  return spawnSync(comando, args, {
    cwd: RAIZ,
    encoding: "utf8",
    ...opcoes,
  });
}

/** Roda e encerra o script se falhar, dizendo o que fazer. */
function rodarOuParar(comando, args, oQueEra, opcoes = {}) {
  const r = spawnSync(comando, args, {
    cwd: RAIZ,
    stdio: "inherit",
    ...opcoes,
  });
  if (r.status !== 0) {
    erro(`${oQueEra} falhou.`);
    process.exit(1);
  }
}

/** Alguém já está escutando nesta porta? */
function portaOcupada(porta) {
  return new Promise((resolve) => {
    const s = createConnection({ port: porta, host: "127.0.0.1" });
    s.on("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.on("error", () => resolve(false));
    setTimeout(() => {
      s.destroy();
      resolve(false);
    }, 700);
  });
}

/**
 * Lê o `.env.local`, se existir.
 *
 * O `tr -d '\r'` do runbook está aqui: o arquivo é escrito no Windows, e sem
 * isso o `\r` entra DENTRO do valor da variável. O sintoma é péssimo — uma
 * chave que "está certa" e o serviço recusando, porque o valor termina em
 * caractere invisível.
 */
function lerEnvLocal() {
  const caminho = path.join(RAIZ, "artifacts", "api-server", ".env.local");
  if (!existsSync(caminho)) return {};

  const vars = {};
  for (const linha of readFileSync(caminho, "utf8").split(/\r?\n/)) {
    const limpa = linha.trim();
    if (!limpa || limpa.startsWith("#")) continue;
    const i = limpa.indexOf("=");
    if (i === -1) continue;
    const chave = limpa.slice(0, i).trim();
    let valor = limpa.slice(i + 1).trim().replace(/\r/g, "");
    if (
      (valor.startsWith('"') && valor.endsWith('"')) ||
      (valor.startsWith("'") && valor.endsWith("'"))
    ) {
      valor = valor.slice(1, -1);
    }
    vars[chave] = valor;
  }
  return vars;
}

/**
 * Os endereços desta máquina na rede local, do mais provável ao menos — é o
 * que se digita no celular.
 *
 * ── Por que não basta "o primeiro que não for interno" ────────────────────
 *
 * Foi o que eu escrevi primeiro, e estava errado. Nesta máquina, em
 * 29/09/2026, o Node enxerga três:
 *
 *   172.24.240.1    vEthernet (Default Switch)      <- Hyper-V
 *   172.18.128.1    vEthernet (WSL ...)             <- WSL
 *   192.168.10.8    Ethernet                        <- a rede de verdade
 *
 * Nenhum dos três é `internal`, e o primeiro da lista é virtual. O celular
 * nunca alcança um adaptador de máquina virtual — a tela simplesmente não
 * carrega, sem mensagem nenhuma, e a pessoa culpa o firewall.
 *
 * Dois sinais, porque cada um sozinho erra: o NOME da placa (Docker e WSL se
 * anunciam) e a FAIXA do endereço (192.168 é rede doméstica; 172.16–31 é onde
 * a virtualização costuma morar).
 */
function enderecosNaRede() {
  const VIRTUAL = /vEthernet|WSL|Docker|Hyper-?V|VirtualBox|VMware|Loopback|TAP|Tailscale/i;
  const candidatos = [];

  for (const [nome, placas] of Object.entries(networkInterfaces())) {
    for (const placa of placas ?? []) {
      if (placa.family !== "IPv4" || placa.internal) continue;

      let nota = 0;
      if (VIRTUAL.test(nome)) nota -= 100;
      if (placa.address.startsWith("192.168.")) nota += 30;
      else if (placa.address.startsWith("10.")) nota += 20;
      else if (/^172\.(1[6-9]|2\d|3[01])\./.test(placa.address)) nota += 5;

      candidatos.push({ endereco: placa.address, nome, nota });
    }
  }

  return candidatos.sort((a, b) => b.nota - a.nota);
}

// ── Preparo ───────────────────────────────────────────────────────────────

/**
 * O `pnpm` responde? — acrescentado em 29/09/2026, depois de morder.
 *
 * O fundador rodou `pnpm dev` e o PowerShell respondeu "não é reconhecido como
 * nome de cmdlet". A causa não era instalação faltando: o `pnpm` estava em
 * `AppData\Roaming\npm`, e esse caminho estava no PATH persistido do usuário.
 *
 * **A janela do terminal era mais velha que a entrada no PATH.** Processo lê o
 * PATH uma vez, ao nascer, e nunca mais. Toda janela aberta antes da instalação
 * continua sem enxergar.
 *
 * Quem entra por `pnpm dev` nem chega aqui — falha antes, no próprio pnpm. Mas
 * quem entra por `node scripts/desenvolver.mjs` (o `node` costuma estar em
 * outro caminho, e sobrevive) chegaria até o meio e quebraria com uma mensagem
 * de pnpm sem contexto nenhum.
 */
function conferirPnpm() {
  passo("Conferindo o pnpm");
  const r = spawnSync("pnpm --version", { shell: true, encoding: "utf8" });
  if (r.status !== 0) {
    erro("O pnpm não respondeu neste terminal.");
    console.error("  Quase sempre é janela velha: ela foi aberta antes do pnpm ser instalado,");
    console.error("  e processo não relê o PATH depois de nascer.");
    console.error("");
    console.error("  Feche este terminal, abra outro, e rode de novo.");
    console.error("  Se ainda assim não achar:  npm install -g pnpm");
    process.exit(1);
  }
  ok(`pnpm ${r.stdout.trim()}`);
}

function conferirDocker() {
  passo("Conferindo o Docker");
  if (rodar("docker", ["--version"]).status !== 0) {
    erro("O Docker não respondeu.");
    console.error("  Abra o Docker Desktop e espere ele terminar de subir.");
    process.exit(1);
  }

  const emPe = rodar("docker", ["ps", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"]);
  if (emPe.stdout?.includes(CONTAINER)) {
    ok("Postgres já está de pé");
    return;
  }

  const existe = rodar("docker", ["ps", "-a", "--filter", `name=^${CONTAINER}$`, "--format", "{{.Names}}"]);
  if (existe.stdout?.includes(CONTAINER)) {
    passo("Religando o Postgres que já existia");
    rodarOuParar("docker", ["start", CONTAINER], "Religar o Postgres");
  } else {
    passo("Criando o Postgres (primeira vez)");
    // `POSTGRES_HOST_AUTH_METHOD=trust` é o que o runbook manda, e não é
    // descuido: a URL do banco não tem senha. Subir com `POSTGRES_PASSWORD`
    // faz o Postgres exigir uma, e o sintoma é uma conexão que trava em vez
    // de dar erro claro. Banco descartável, só em localhost.
    rodarOuParar(
      "docker",
      [
        "run", "-d", "--name", CONTAINER,
        "-e", `POSTGRES_USER=${USUARIO_PG}`,
        "-e", `POSTGRES_DB=${USUARIO_PG}`,
        "-e", "POSTGRES_HOST_AUTH_METHOD=trust",
        "-p", `${PORTA_PG}:5432`,
        "postgres:16-alpine",
      ],
      "Criar o Postgres",
    );
  }
  ok("Postgres de pé");
}

async function esperarPostgres() {
  passo("Esperando o Postgres aceitar conexão");
  for (let i = 0; i < 45; i++) {
    const r = rodar("docker", ["exec", CONTAINER, "pg_isready", "-U", USUARIO_PG, "-q"]);
    if (r.status === 0) {
      ok("Postgres pronto");
      return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  erro("O Postgres não ficou pronto em 45 segundos.");
  console.error(`  Veja o que ele diz:  docker logs ${CONTAINER}`);
  process.exit(1);
}

function garantirBancoLocal() {
  passo(`Garantindo o banco "${BANCO_LOCAL}"`);
  const existe = rodar("docker", [
    "exec", CONTAINER, "psql", "-U", USUARIO_PG, "-tAc",
    `SELECT 1 FROM pg_database WHERE datname='${BANCO_LOCAL}'`,
  ]);
  if (existe.stdout?.trim() === "1") {
    ok(`"${BANCO_LOCAL}" já existe`);
    return;
  }
  rodarOuParar(
    "docker",
    ["exec", CONTAINER, "psql", "-U", USUARIO_PG, "-c", `CREATE DATABASE ${BANCO_LOCAL}`],
    `Criar o banco ${BANCO_LOCAL}`,
  );
  ok(`"${BANCO_LOCAL}" criado`);
}

// ── Ambiente ──────────────────────────────────────────────────────────────

function montarAmbiente() {
  const doArquivo = lerEnvLocal();

  // `SESSION_SECRET` e `ADMIN_PANEL_SECRET` PRECISAM ser diferentes.
  //
  // Iguais, `getAdminSecret()` desliga o painel administrativo de propósito —
  // proteção deliberada, porque um token de admin passaria por
  // `verifyAccessToken` como se fosse sessão de cuidador. Ver lib/admin-auth.ts
  // e a nota de 23/08/2026 no validate.yml.
  const sessao = doArquivo.SESSION_SECRET || "zelo-local-sessao-nao-use-em-producao";
  const admin = doArquivo.ADMIN_PANEL_SECRET || "zelo-local-admin-nao-use-em-producao";
  if (sessao === admin) {
    erro("SESSION_SECRET e ADMIN_PANEL_SECRET estão iguais no .env.local.");
    console.error("  Iguais, o painel administrativo se desliga sozinho (proteção, não defeito).");
    console.error("  Troque um dos dois e rode de novo.");
    process.exit(1);
  }

  return {
    ...process.env,
    ...doArquivo,
    NODE_ENV: "development",
    DATABASE_URL: URL_DO_BANCO,
    SESSION_SECRET: sessao,
    ADMIN_PANEL_SECRET: admin,
    APP_URL: `http://localhost:${PORTA_FRONT}`,
    TZ: "UTC",
  };
}

// ── Subida ────────────────────────────────────────────────────────────────

function subir(nome, cor, linha, env) {
  const filho = spawn(linha, {
    cwd: RAIZ,
    env,
    shell: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  filhos.push(filho);

  const prefixo = `\x1b[${cor}m[${nome}]\x1b[0m`;
  const repassar = (fluxo, destino) => {
    fluxo.setEncoding("utf8");
    let resto = "";
    fluxo.on("data", (pedaco) => {
      const linhas = (resto + pedaco).split("\n");
      resto = linhas.pop() ?? "";
      for (const l of linhas) destino.write(`${prefixo} ${l}\n`);
    });
  };
  repassar(filho.stdout, process.stdout);
  repassar(filho.stderr, process.stderr);

  filho.on("exit", (codigo) => {
    if (encerrando) return;
    erro(`O processo "${nome}" morreu (código ${codigo}). Derrubando o resto.`);
    encerrar(1);
  });

  return filho;
}

function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;
  for (const f of filhos) {
    try {
      f.kill();
    } catch {
      /* já morreu */
    }
  }
  process.exit(codigo);
}

// ── Principal ─────────────────────────────────────────────────────────────

async function principal() {
  console.log("\n\x1b[1mZELO — ambiente local\x1b[0m\n");

  for (const [porta, quem] of [[PORTA_API, "a API"], [PORTA_FRONT, "o front"]]) {
    if (await portaOcupada(porta)) {
      erro(`A porta ${porta} (${quem}) já está ocupada.`);
      console.error("  Feche o que está usando ela e rode de novo.");
      console.error(`  Para descobrir quem é:  netstat -ano | findstr :${porta}`);
      process.exit(1);
    }
  }

  conferirPnpm();
  conferirDocker();
  await esperarPostgres();
  garantirBancoLocal();

  const env = montarAmbiente();

  passo("Aplicando as migrações");
  pnpmOuParar("pnpm --filter @workspace/db run migrate", "Migrar o banco", { env });

  passo("Semeando a família fictícia");
  pnpmOuParar("pnpm --filter @workspace/api-server run seed", "Semear", { env });

  passo("Construindo a API");
  pnpmOuParar("pnpm --filter @workspace/api-server run build", "Construir a API", {
    env: { ...env, PORT: String(PORTA_API), BASE_PATH: "/" },
  });

  passo("Subindo API e front\n");

  subir("api", "35", "pnpm --filter @workspace/api-server run start", {
    ...env,
    PORT: String(PORTA_API),
  });

  subir("front", "34", "pnpm --filter @workspace/zelo run dev", {
    ...env,
    PORT: String(PORTA_FRONT),
    BASE_PATH: "/",
    // Sem isto o front sobe e não fala com ninguém: é esta variável que liga
    // o proxy de `/api` no vite.config.ts. No Replit a plataforma fazia esse
    // roteamento por fora; aqui, é o vite que faz.
    API_PROXY_TARGET: `http://localhost:${PORTA_API}`,
  });

  const enderecos = enderecosNaRede();
  setTimeout(() => {
    console.log(`\n\x1b[1m  Nesta máquina\x1b[0m   http://localhost:${PORTA_FRONT}`);
    if (enderecos.length > 0) {
      const melhor = enderecos[0];
      console.log(
        `\x1b[1m  No celular\x1b[0m      http://${melhor.endereco}:${PORTA_FRONT}   \x1b[2m(mesma Wi-Fi)\x1b[0m`,
      );
      // Se houver outros, mostra — o palpite acima é heurística, e quando ela
      // erra a pessoa precisa ter a alternativa à mão em vez de adivinhar.
      const outros = enderecos.slice(1);
      if (outros.length > 0) {
        console.log(
          `\x1b[2m                  se não abrir, tente: ${outros
            .map((o) => `http://${o.endereco}:${PORTA_FRONT}`)
            .join("  ")}\x1b[0m`,
        );
      }
    } else {
      console.log("\x1b[2m  (não achei o endereço desta máquina na rede — sem acesso pelo celular)\x1b[0m");
    }
    console.log(`\n\x1b[1m  Entrar como\x1b[0m     ${CONTA_DA_SEMENTE.email}`);
    console.log(`\x1b[1m  Senha\x1b[0m           ${CONTA_DA_SEMENTE.senha}`);
    console.log("\n\x1b[2m  Ctrl+C encerra os dois.\x1b[0m\n");
  }, 4000);
}

process.on("SIGINT", () => encerrar(0));
process.on("SIGTERM", () => encerrar(0));

principal().catch((e) => {
  erro(e?.message ?? String(e));
  encerrar(1);
});
