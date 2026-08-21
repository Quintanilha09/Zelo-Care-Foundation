// Types augmentation — must be referenced before express is imported
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { safeLog } from "./lib/safe-logger.ts";
import { allowsDevelopmentShortcuts } from "./lib/environment.ts";

const app: Express = express();

// Confia no proxy reverso do Replit para X-Forwarded-Proto / X-Forwarded-Host
// Necessário para req.protocol e construção correta da redirect_uri do Google OAuth
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
