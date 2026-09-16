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
# ── O `--chown` aqui vale 156 MB, e isso foi medido ─────────────────────
#
# A forma óbvia é copiar e depois `RUN chown -R node:node /app`. Ela funciona
# e é cara: camada de imagem é imutável, então mudar o dono de um arquivo
# **grava uma cópia inteira dele** na camada nova. Medido em 14/09/2026, com
# `docker history`: a linha do `chown -R` sozinha pesava 156 MB, num conteúdo
# total de 149 MB — a imagem carregava tudo duas vezes.
#
# `COPY --chown` grava o dono certo de uma vez só, sem segunda cópia.
COPY --from=construcao --chown=node:node /pronto ./

# O app construído. `FRONT_DIR` aponta para cá, e é o que a #194 lê.
COPY --from=construcao --chown=node:node /origem/artifacts/zelo/dist/public ./front
ENV FRONT_DIR=/app/front

# Usuário sem privilégio. A imagem do Node já traz o `node` (uid 1000) — usar
# o que já existe evita criar um e errar a permissão de alguma pasta.
#
# ── Efeito colateral bem-vindo: /app fica somente-leitura para o app ────
#
# O `WORKDIR` cria a pasta como root, e o `--chown` acima muda o dono do
# CONTEÚDO, não o dela. Resultado: o processo lê tudo o que precisa e não
# consegue criar arquivo nenhum dentro de /app.
#
# Isso é desejável e foi verificado em 14/09/2026: o api-server não escreve em
# disco em lugar nenhum — o log vai para stdout, os dois `multer` usam
# `memoryStorage()`, e o PDF é gerado em memória e transmitido. Um processo que
# não precisa escrever não deve poder.
USER node

ENV PORT=5000
EXPOSE 5000

# ── É a rota RASA que entra aqui, e a escolha é deliberada ──────────────
#
# Desde a #196 existem duas perguntas separadas:
#
#   /api/healthz — "este processo está vivo?"   não toca no banco
#   /api/readyz  — "ele consegue atender?"      consulta o banco
#
# Quem verifica aqui decide REINICIAR o contêiner, e banco fora do ar não é
# motivo para isso: reiniciar não conserta o banco, e levaria junto o pg-boss
# e todas as conexões SSE abertas — uma indisponibilidade curta do banco
# viraria uma longa do aplicativo, causada pela própria verificação.
#
# Por isso `/api/healthz`. O `/api/readyz` é para o monitoramento externo, que
# avisa uma pessoa em vez de derrubar o processo.
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||5000)+'/api/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "./dist/index.mjs"]
