import { defineConfig, devices } from "@playwright/test";

/**
 * Teste de ponta a ponta — Issue #7.
 *
 * ── Por que isto existe ───────────────────────────────────────────────────
 *
 * **516 testes cobrem o servidor. Zero cobriam a tela.**
 *
 * Todos os defeitos que o fundador relatou numa semana estavam na interface:
 * janela de tratamento cortada, botão que não salvava, setinhas minúsculas,
 * campo de endereço preto, foto ocupando a tela inteira. **Nenhum deles seria
 * pego pela suíte existente**, e todos seriam pegos aqui.
 *
 * ── O obstáculo que precisou ser removido antes ───────────────────────────
 *
 * O ZELO nunca pôde rodar fora do Replit. A separação frontend/backend só
 * funcionava atrás do roteamento da plataforma, que entrega `/api` ao backend
 * por fora. Sem isso, o front sobe e não tem com quem falar.
 *
 * A saída foi um proxy no `vite.config.ts` **condicionado a
 * `API_PROXY_TARGET`**: sem a variável, a configuração é exatamente a que o
 * Replit sempre teve; com ela, o vite faz o papel da plataforma.
 *
 * ── Como isto sobe ────────────────────────────────────────────────────────
 *
 * Dois servidores, nesta ordem: a API na 5000, o front na 5173 apontando para
 * ela. O Playwright espera os dois responderem antes do primeiro teste.
 */

const PORTA_API = 5000;
const PORTA_FRONT = 5173;

/**
 * Segredos do ambiente de teste.
 *
 * Os dois PRECISAM ser diferentes — se colidirem, o painel operacional se
 * desabilita (ver lib/admin-auth.ts) e um token de admin passaria por
 * `verifyAccessToken` como sessão de cuidador. É a lição de 23/08/2026, e
 * vale aqui igual.
 */
const SESSION_SECRET = process.env.SESSION_SECRET ?? "e2e-session-nao-use-em-producao";
const ADMIN_PANEL_SECRET = process.env.ADMIN_PANEL_SECRET ?? "e2e-admin-nao-use-em-producao";

const ambiente = {
  NODE_ENV: "development",
  PORT: String(PORTA_API),
  SESSION_SECRET,
  ADMIN_PANEL_SECRET,
  DATABASE_URL: process.env.DATABASE_URL ?? "",
  APP_URL: `http://localhost:${PORTA_FRONT}`,
  LOG_LEVEL: "silent",
  // A suíte faz dezenas de logins legítimos da mesma máquina em poucos
  // minutos, e passou a esbarrar no limitador quando cresceu. O sintoma era
  // enganoso: teste de tela falhando por "elemento não encontrado", quando o
  // login tinha respondido 429.
  //
  // Só tem efeito onde `allowsDevelopmentShortcuts()` já vale — em produção
  // esta variável é ignorada por construção (ver lib/rate-limit.ts).
  RATE_LIMIT_MULTIPLIER: "200",
};

export default defineConfig({
  testDir: "./e2e",
  // Um por vez. O banco é compartilhado, exatamente como na suíte de
  // integração — paralelo aqui daria corrida entre testes.
  fullyParallel: false,
  workers: 1,
  // Sem retentativa local: teste que passa na segunda tentativa esconde
  // instabilidade. No CI, uma só, porque rede de runner falha de verdade.
  retries: process.env.CI ? 1 : 0,
  // Teto por teste. Se um passar disso, o problema não é lentidão — é que
  // ele está esperando algo que nunca vai chegar.
  timeout: 30_000,
  expect: { timeout: 8_000 },
  // `forbidOnly` no CI: um `.only` esquecido faria o job passar rodando um
  // teste só, e ninguém perceberia.
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [["github"], ["list"]] : [["list"]],

  use: {
    baseURL: `http://localhost:${PORTA_FRONT}`,
    // Rastro e captura só quando falha: o valor está em entender o defeito,
    // e guardar vídeo de teste verde é encher o artefato de nada.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "retain-on-failure",
    // Português: o app inteiro é em pt-BR, e data e hora precisam sair no
    // formato que o teste espera.
    locale: "pt-BR",
    timezoneId: "America/Sao_Paulo",
  },

  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      // O público real deste app está no celular. Testar só no desktop
      // deixaria de fora a metade que mais importa — e três dos defeitos
      // relatados eram de tela pequena.
      name: "celular",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: [
    {
      // `build` e `start` em vez do script `dev`, e o motivo e concreto: o
      // `dev` comeca com `export NODE_ENV=development`, sintaxe de shell
      // POSIX que o cmd do Windows nao entende. Aqui o NODE_ENV ja vem pelo
      // `env` abaixo, entao o `export` nao faz falta — e assim o teste roda
      // nos dois sistemas.
      command: "pnpm --filter @workspace/api-server run build && pnpm --filter @workspace/api-server run start",
      url: `http://localhost:${PORTA_API}/api/healthz`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: ambiente,
    },
    {
      command: "pnpm --filter @workspace/zelo run dev",
      url: `http://localhost:${PORTA_FRONT}`,
      reuseExistingServer: !process.env.CI,
      timeout: 120_000,
      stdout: "pipe",
      stderr: "pipe",
      env: {
        ...ambiente,
        PORT: String(PORTA_FRONT),
        BASE_PATH: "/",
        // É esta variável que faz o vite rotear /api para a API. Sem ela, o
        // front sobe e não fala com ninguém.
        API_PROXY_TARGET: `http://localhost:${PORTA_API}`,
      },
    },
  ],
});
