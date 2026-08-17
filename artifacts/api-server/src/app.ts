// Types augmentation — must be referenced before express is imported
import express, { type Express, type Request, type Response, type NextFunction } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { safeLog } from "./lib/safe-logger.ts";

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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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
  const message = process.env.NODE_ENV !== "production" && err instanceof Error ? err.message : "Erro interno do servidor";
  res.status(500).json({ error: message });
});

export default app;
