# ═══════════════════════════════════════════════════════════════════════════
# A imagem de produção do ZELO — Issue #195.
#
# Até aqui quem construía e rodava era o Replit, a partir do `.replit` — um
# arquivo de uma plataforma só. O serviço de contêiner do Lightsail recebe uma
# IMAGEM, e é ela que este arquivo produz.
#
# Um contêiner serve as duas coisas: a API em `/api` e o app em todo o resto
# (ver #194). Uma origem só, sem CORS e sem CDN para configurar.
# ═══════════════════════════════════════════════════════════════════════════

# ── Estágio 1: construir ──────────────────────────────────────────────────
#
# `bookworm` completo, e não `alpine`, de propósito: o `argon2` é módulo
# NATIVO, e os binários prontos dele são compilados contra glibc. Em alpine
# (musl) o pnpm cairia para compilar da fonte — mais lento, e mais uma coisa
# que pode falhar no dia do deploy.
FROM node:24-bookworm AS construcao

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable

WORKDIR /origem

# Manifestos primeiro, código depois: enquanto as dependências não mudarem,
# esta camada é reaproveitada e o build fica em segundos.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc* ./
COPY artifacts/api-server/package.json ./artifacts/api-server/
COPY artifacts/zelo/package.json ./artifacts/zelo/
COPY artifacts/mockup-sandbox/package.json ./artifacts/mockup-sandbox/
COPY lib ./lib
COPY scripts/package.json ./scripts/

RUN pnpm install --frozen-lockfile

COPY . .

# As duas variáveis são obrigatórias: os `vite.config.ts` lançam sem elas, no
# topo do arquivo, e isso roda também no `build` (não só no `dev`). O valor de
# PORT é irrelevante aqui — só o build de arquivo acontece.
ENV PORT=5000
ENV BASE_PATH=/
RUN pnpm run build

# `pnpm deploy` monta uma pasta autossuficiente com o pacote e SÓ as
# dependências de produção dele, já resolvidas — é a forma que o pnpm oferece
# para tirar um pacote de dentro de um monorepo.
RUN pnpm --filter @workspace/api-server deploy --prod --legacy /pronto

# ── Estágio 2: rodar ──────────────────────────────────────────────────────
FROM node:24-bookworm-slim AS producao

# ═══════════════════════════════════════════════════════════════════════════
# `NODE_ENV` EXPLÍCITO, E ISSO NÃO É ZELO EXCESSIVO.
#
# Neste código, a AUSÊNCIA de `NODE_ENV` já significa produção (ver
# lib/environment.ts) — desenho deliberado, depois de um deploy sem a variável
# ter rodado com cinco proteções desligadas. Declarar mesmo assim é barato e
# tira a dúvida de quem lê o Dockerfile.
# ═══════════════════════════════════════════════════════════════════════════
ENV NODE_ENV=production
# Todo horário de dose é convertido a partir do fuso do PACIENTE
# (lib/scheduling). O fuso do processo nunca deve entrar na conta — fixá-lo em
# UTC garante que ele não entre nem por acidente.
ENV TZ=UTC

WORKDIR /app

# O pacote pronto, com as dependências de produção dentro.
#
# ── Por que o node_modules precisa vir junto ────────────────────────────
#
# O `build.mjs` externaliza o `pdfkit` de propósito: ele lê as métricas de
# fonte do disco em tempo de execução (`data/Helvetica.afm`). Empacotado,
# `__dirname` viraria `dist/`, `dist/data/` não existiria, e a geração do
# relatório estouraria ENOENT — com a rota devolvendo 500 e os testes sem
# perceber, porque eles rodam sobre o node_modules real.
#
# Uma imagem só com `dist/` gera relatório quebrado. Já mordeu em 24/08/2026.
COPY --from=construcao /pronto ./

# O app construído. `FRONT_DIR` aponta para cá, e é o que a #194 lê.
COPY --from=construcao /origem/artifacts/zelo/dist/public ./front
ENV FRONT_DIR=/app/front

# Usuário sem privilégio. A imagem do Node já traz o `node` (uid 1000) — usar
# o que já existe evita criar um e errar a permissão de alguma pasta.
RUN chown -R node:node /app
USER node

ENV PORT=5000
EXPOSE 5000

# ── Atenção: hoje esta rota AINDA checa o banco ─────────────────────────
#
# `/api/healthz` consulta o banco e responde 503 quando ele não responde. Aqui
# dentro isso é informativo — o Docker não reinicia contêiner por conta da
# verificação; quem reinicia é o orquestrador.
#
# No Lightsail, porém, o balanceador REINICIA o que responde fora da faixa. Se
# o banco piscar, o contêiner seria derrubado por um problema que não é dele —
# e o reinício levaria junto o pg-boss e as conexões SSE abertas.
#
# É exatamente o que a #196 conserta, separando `/api/healthz` (o processo
# está vivo?) de `/api/readyz` (ele consegue atender?). Quando ela entrar,
# esta linha continua correta: é a rota rasa que o balanceador deve olhar.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
