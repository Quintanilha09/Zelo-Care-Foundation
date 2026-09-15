// Types augmentation — must be referenced before express is imported
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { safeLog } from "./lib/safe-logger.ts";
import { allowsDevelopmentShortcuts } from "./lib/environment.ts";

const app: Express = express();

// ═══════════════════════════════════════════════════════════════════════════
// UM SALTO. O NÚMERO IMPORTA, E É POR ISSO QUE ESTÁ EXPLICADO.
//
// `trust proxy` diz ao Express quantos intermediários na frente do app são
// confiáveis, contando do app para fora. Com 1, ele lê
//
//     [ip do socket, ...X-Forwarded-For invertido]
//
// e devolve, em `req.ip`, o item a um salto de distância — o IP que o
// balanceador apurou, e não o que o cliente escreveu no cabeçalho.
//
// **Um** é o certo nos dois ambientes de hoje: o proxy do Replit e o
// balanceador do serviço de contêiner do Lightsail, cada um sendo um único
// intermediário. Se algum dia entrar um CDN na frente, este número sobe junto
// — e quem mexer precisa saber que ele não é decoração.
//
// ── Alto demais e baixo demais quebram coisas diferentes ─────────────────
//
// Alto demais: o Express passa a aceitar como origem um item que veio do
// cliente, e todo limitador por IP volta a ser contornável (Issue #207).
// Baixo demais: `req.ip` vira o IP do balanceador, e a família inteira do
// Brasil divide um balde só.
//
// Também é ele que faz `req.protocol` dizer `https`, o que a `redirect_uri`
// do Google OAuth precisa para ser montada certa (ver routes/google-auth.ts).
// ═══════════════════════════════════════════════════════════════════════════
app.set("trust proxy", 1);

app.use(cookieParser());
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// ── Cabeçalhos de segurança ───────────────────────────────────────────────
// Aplicados à mão, sem trazer o `helmet`: são cinco cabeçalhos estáveis, e
// cada dependência nova é superfície nova (a auditoria de dependência deste
// projeto já é apertada). Se um dia forem precisos os controles finos do
// helmet, ele entra — hoje seria peso sem ganho.
app.use((_req: Request, res: Response, next: NextFunction): void => {
  // Impede que o app seja embutido em iframe de terceiro (clickjacking) —
  // relevante num app onde um clique registra medicação.
  res.setHeader("X-Frame-Options", "DENY");
  // Impede o navegador de "adivinhar" tipo de conteúdo (MIME sniffing).
  res.setHeader("X-Content-Type-Options", "nosniff");
  // Não vaza a URL do ZELO (que pode conter id de paciente) pra sites externos.
  res.setHeader("Referrer-Policy", "no-referrer");
  // Nenhuma API sensível de dispositivo é usada pelo app.
  res.setHeader("Permissions-Policy", "camera=(self), geolocation=(), microphone=(), payment=()");
  // HSTS só faz sentido sob HTTPS — em http local ele só atrapalharia.
  if (req_isHttps(_req)) {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
});

function req_isHttps(req: Request): boolean {
  return req.protocol === "https" || req.headers["x-forwarded-proto"] === "https";
}

// ── CORS ──────────────────────────────────────────────────────────────────
// `cors()` sem argumento devolve `Access-Control-Allow-Origin: *`, ou seja,
// qualquer site na internet podia chamar esta API (achado da auditoria de
// 21/08/2026). Frontend e backend são servidos pela MESMA origem em produção
// (router = "application" no .replit), então nem seria necessário CORS ali —
// a lista existe pro desenvolvimento local, onde o Vite roda noutra porta.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((o) => o.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Sem Origin = mesma origem, app nativo ou curl — nada a liberar.
      if (!origin) return callback(null, true);
      if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
      if (allowsDevelopmentShortcuts() && /^https?:\/\/localhost(:\d+)?$/.test(origin)) {
        return callback(null, true);
      }
      // Recusa sem lançar: o navegador já bloqueia por não receber o
      // cabeçalho, e lançar aqui viraria erro 500 ruidoso no log.
      return callback(null, false);
    },
    credentials: true,
  }),
);

// Limite explícito de corpo de requisição. O padrão do Express já é 100kb,
// mas deixar implícito é contar com sorte — upload de foto tem caminho
// próprio (multer, 8MB, ver routes/medication-photos.ts).
app.use(express.json({ limit: "100kb" }));
app.use(express.urlencoded({ extended: true, limit: "100kb" }));

app.use("/api", router);

// Sem handler global, um erro não tratado (ex: coluna faltando no banco)
// cai no handler padrão do Express, que devolve HTML — o cliente recebe
// "JSON.parse: unexpected character" em vez de uma mensagem de erro real.
// Toda resposta de /api precisa ser JSON, sempre, mesmo em falha inesperada.

app.use("/api", (_req: Request, res: Response): void => {
  res.status(404).json({ error: "Rota não encontrada" });
});

// ── O front, servido por este mesmo servidor — Issue #194 ─────────────────
//
// ═══════════════════════════════════════════════════════════════════════════
// ATÉ AQUI, QUEM SERVIA O FRONT ERA A PLATAFORMA, E NÃO O CÓDIGO.
//
// O `.replit` tem `router = "application"`, e o Replit mandava `/api` para o
// backend e todo o resto para o estático do Vite. Fora de lá esse roteamento
// não existe: `GET /` devolvia 404 e o app não abria.
//
// Um contêiner só, uma origem só. A alternativa (estático no S3 + CloudFront)
// traria de volta exatamente a complicação de origem cruzada que a
// mesma-origem elimina de graça, para um ganho de cache que é teórico no
// volume do ZELO. Menos peça é menos coisa para quebrar às 3h da manhã.
// ═══════════════════════════════════════════════════════════════════════════
//
// ── Por que depois das rotas de API, e nunca antes ───────────────────────
//
// Montado antes, um arquivo estático engoliria uma rota de API — e o defeito
// seria mudo: a chamada devolveria HTML com status 200, e o cliente quebraria
// no `JSON.parse` sem nenhuma pista de onde.
//
// ── Por que some quando a pasta não existe ───────────────────────────────
//
// Enquanto os dois ambientes convivem, o Replit continua servindo o front
// dele. Se a pasta não estiver lá, este bloco simplesmente não é montado, e o
// comportamento de hoje segue idêntico. Ambiente novo não pode quebrar o
// antigo antes de provar que funciona.
const frontDir = diretorioDoFront();
if (frontDir) {
  app.use(
    express.static(frontDir, {
      // O `index.html` NUNCA é cacheado: ele é o arquivo que aponta para os
      // demais, e cacheá-lo prenderia a pessoa numa versão antiga do app sem
      // ela ter como saber por quê.
      setHeaders(res, caminho) {
        if (caminho.endsWith("index.html")) {
          res.setHeader("Cache-Control", "no-cache");
        } else {
          // O resto tem hash no nome (`index-4kTeGI-C.js`): o nome muda
          // quando o conteúdo muda, então cachear para sempre é seguro.
          res.setHeader("Cache-Control", "public, max-age=31536000, immutable");
        }
      },
    }),
  );

  /**
   * O retorno do SPA.
   *
   * O roteamento do app é do lado do cliente: `/pacientes/3` não é um arquivo.
   * Sem esta linha, recarregar a página em qualquer tela interna devolveria
   * 404 — e recarregar é o primeiro reflexo de quem acha que o app travou.
   *
   * Só GET: um POST para um caminho desconhecido tem que continuar sendo 404,
   * nunca uma página HTML com status 200.
   */
  app.get(/^(?!\/api\/).*/, (_req: Request, res: Response): void => {
    res.setHeader("Cache-Control", "no-cache");
    res.sendFile(path.join(frontDir, "index.html"));
  });
}

/**
 * Onde está o front construído, se estiver em algum lugar.
 *
 * `FRONT_DIR` manda, e é o que a imagem de produção define (#195). Sem ela,
 * tenta o caminho do monorepo — que é onde o `pnpm run build` deixa o
 * resultado quando se roda tudo da raiz.
 *
 * Devolve `null` quando não há pasta nenhuma: sem front para servir, este
 * servidor volta a ser só API, que é o que ele é hoje no Replit e no
 * desenvolvimento local com o Vite noutra porta.
 */
function diretorioDoFront(): string | null {
  const candidatos = [
    process.env.FRONT_DIR,
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../zelo/dist/public"),
  ].filter((c): c is string => typeof c === "string" && c.length > 0);

  for (const dir of candidatos) {
    if (existsSync(path.join(dir, "index.html"))) return dir;
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: unknown, req: Request, res: Response, _next: NextFunction): void => {
  safeLog.error({ action: "unhandled_error", route: req.path, method: req.method }, "Erro não tratado");
  // Detalhe do erro só fora de produção — e "fora de produção" precisa ser
  // explícito (ver lib/environment.ts): com a checagem antiga, um ambiente
  // sem NODE_ENV definido devolvia a mensagem interna ao cliente.
  const message = allowsDevelopmentShortcuts() && err instanceof Error ? err.message : "Erro interno do servidor";
  res.status(500).json({ error: message });
});

export default app;
