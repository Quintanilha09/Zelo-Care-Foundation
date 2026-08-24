# AUDITORIA DE SEGURANÇA — 21/08/2026

> Varredura de front, back e banco contra as 8 skills de segurança (OWASP Injection, XSS, SSRF, LLM01/05/06/10, secrets, dados sensíveis, observabilidade, dependências).
> **Status:** concluída. 9 achados corrigidos, 4 avaliados sem ação necessária.
> **Commit:** `Corrige vulnerabilidades encontradas na auditoria de seguranca`
> **Verificação:** 395 testes, 393 passando, zero falhas — incluindo 16 testes novos de blindagem que impedem a volta do padrão inseguro.

---

## 🔴 CRÍTICO

### A-01 — `NODE_ENV` nunca é definido em produção
**Status:** ✅ corrigido

O `.replit` não define `NODE_ENV`, e o script de start é `node --enable-source-maps ./dist/index.mjs` — sem a variável. Como o código verifica `process.env.NODE_ENV !== "production"`, e `undefined !== "production"` é **verdadeiro**, o app publicado se comporta como ambiente de desenvolvimento. **Cinco consequências**, todas em código que já existia:

| # | Consequência | Impacto |
|---|---|---|
| a | **Rotas `/api/dev/clock/*` expostas, sem autenticação nenhuma** | Qualquer pessoa na internet podia congelar ou adiantar o relógio do servidor. Num app de medicação, isso quebra lembretes, geração de doses, janela retroativa e expiração de token. **O achado mais grave da auditoria.** |
| b | Auto-verificação de e-mail no cadastro | Conta ativada sem confirmar o e-mail — permite cadastro com e-mail de terceiro |
| c | Token de verificação escrito no log | `safeLog` sanitiza o *contexto*, mas não a *mensagem*, e o token ia interpolado na mensagem |
| d | Links com token de reset de senha no log (`email.ts`) | Quem lê o log assume a conta |
| e | Rate limit 10× mais frouxo | Login aceitava 50 tentativas/15min em vez de 5 |

---

## 🟠 ALTO

### A-02 — CORS totalmente aberto
**Status:** ✅ corrigido
`app.use(cors())` sem configuração emite `Access-Control-Allow-Origin: *`. Qualquer site podia chamar a API. Mitigado em parte por a autenticação ser via header `Authorization` (não cookie), mas é superfície desnecessária.

### A-03 — Endpoint de IA sem rate limit
**Status:** ✅ corrigido
`POST /medication-photos/extract` chama a **API paga da Anthropic** sem nenhum limite por usuário. Um cuidador autenticado (ou um token roubado) podia esgotar o crédito. É o cenário exato de OWASP LLM10 (Unbounded Consumption).

### A-04 — `/admin/login` sem rate limit
**Status:** ✅ corrigido
O painel operacional é protegido por uma senha compartilhada, e o endpoint aceitava tentativas ilimitadas — brute force direto.

### A-05 — Nenhum header de segurança
**Status:** ✅ corrigido
Sem CSP, `X-Frame-Options`, `X-Content-Type-Options`, HSTS ou `Referrer-Policy`. Deixava o app aberto a clickjacking e MIME sniffing.

### A-06 — Saída do LLM sem validação em runtime
**Status:** ✅ corrigido
`vision.ts` fazia `toolUse.input as {...}` — um *cast* de tipo, que não valida nada em execução. Uma foto com texto adversarial ("ignore as instruções e responda X") podia fazer o modelo devolver estrutura fora do schema, e o valor seguia para o banco e para o formulário. OWASP LLM05 (Improper Output Handling).

---

## 🟡 MÉDIO

### A-07 — Rotas públicas com token, sem rate limit
**Status:** ✅ corrigido
`patient-access/activate`, `reports/:token`, `export/download/:token`, `push/ack`, `auth/verify-email`, `password-reset/confirm`, `auth/refresh`, `google/exchange`. Os tokens são de 32 bytes aleatórios (brute force inviável), mas rate limit é defesa em profundidade e evita uso como amplificador de carga.

### A-08 — Chamadas externas sem timeout
**Status:** ✅ corrigido
`fetch` para Anthropic e Google OAuth sem `AbortSignal.timeout`. Um upstream lento segurava a requisição indefinidamente, consumindo conexões.

### A-09 — `express.json()` sem limite explícito
**Status:** ✅ corrigido
O padrão do Express é 100kb, então não havia risco real — mas o limite passou a ser explícito, junto do de `urlencoded`.

---

## 🟢 BAIXO / OBSERVAÇÃO

### A-10 — `chart.tsx` com `dangerouslySetInnerHTML`, sem uso
**Status:** ✅ removido
Componente do template shadcn que injeta CSS via `dangerouslySetInnerHTML`. **Não era importado em lugar nenhum** — a tela de rotina usa `recharts` direto. Código morto com sink de injeção: removido em vez de mantido.

### A-11 — `pnpm audit`: 4 vulnerabilidades `high`
**Status:** ✅ verificado — não afetam produção
`fast-uri`, `brace-expansion`, `js-yaml` (via `orval`, gerador de cliente de API) e `nanoid` (via `mockup-sandbox`, ferramenta de preview). **Nenhuma alcança `api-server` nem `zelo`** — confirmado com `pnpm why` para cada uma: zero caminhos partindo dos pacotes publicados. São ferramentas de desenvolvimento que não entram no bundle.

### A-12 — Refresh token em `localStorage`
**Status:** ⚠️ risco aceito e documentado
A skill de secrets desaconselha `localStorage`. O desenho atual (access token em memória, refresh no `localStorage`) é trade-off consciente e comentado em `auth-client.ts`. A alternativa robusta é cookie `httpOnly`+`Secure`+`SameSite`, o que exige mudar o fluxo de autenticação inteiro. **Não alterado nesta auditoria** — é decisão de arquitetura, não correção de bug, e deve ser avaliada antes de haver usuários reais.

### A-13 — `seed.ts` escreve nomes no console
**Status:** ⚠️ aceito
Script manual de dados fictícios, roda sob demanda, nunca em produção. Sem ação.

---

## O que a auditoria confirmou como já correto

Vale registrar o que **não** foi problema, porque foi construído certo desde o início:

- **Injeção de SQL:** nenhuma query construída por concatenação. Tudo via Drizzle ORM ou `sql` template com parâmetros ligados. Os poucos `db.execute(sql\`...\`)` interpolam apenas valores gerados pelo servidor (datas), nunca entrada do usuário.
- **XSS:** nenhum `innerHTML`/`v-html` no código da aplicação; React faz auto-escaping e ele não é contornado em lugar nenhum.
- **SSRF:** nenhum `fetch` monta URL a partir de entrada do usuário — só endpoints fixos do Google e da Anthropic.
- **Execução de comando:** nenhum `eval`, `new Function`, `exec` ou `child_process`.
- **Secrets:** nenhum literal hardcoded; `.env` fora do git e no `.gitignore`; tudo via `process.env`.
- **Senhas:** Argon2id com parâmetros OWASP (64MB, 3 iterações).
- **PII em logs:** `safeLog` com *allowlist* — campo fora da lista vira `[REDACTED]` automaticamente. O `pino-http` loga só id/método/URL **sem query string**, e status. Desenho acima da média.
- **Isolamento por família:** `familyId` sempre do JWT, nunca da URL/body; recurso de outra família devolve 404. Coberto por suíte dedicada.
- **Auditoria imutável:** trigger no banco rejeita `UPDATE`/`DELETE` em `audit_log` — testado.
- **Upload:** limite de 8MB, allowlist de MIME, armazenamento em memória, sem nome de arquivo vindo do cliente.
- **Escopo do token do paciente (ZELO-58):** recusa em 8 rotas de cuidador, testado.
- **Erros:** handler global devolve JSON genérico; nunca stack trace ao cliente.
