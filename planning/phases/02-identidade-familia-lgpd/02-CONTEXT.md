# CONTEXT — Fase 02: Identidade, Família e LGPD

> Artefato GSD. Saída da etapa Discuss.
> **Data:** 16/08/2026 · **Atualizado:** 16/08/2026 (login com Google)

---

## Ponto de partida — diferente do planejado originalmente

O schema completo já existe, herdado da correção da Fase 01: `users`, `sessions`, `refresh_tokens`, `consent_records`, `caregiver_invites`, `audit_log` (imutável, com trigger). Esta fase não cria tabela nova — é lógica de aplicação sobre schema já pronto e testado. Isso reduz o risco e o custo desta fase significativamente.

## Escopo — REQ-001 a REQ-006 / ZELO-6 a ZELO-11

1. Cadastro, login e sessão revogável individualmente (JWT curto + refresh token opaco, rotação com detecção de reuso)
2. Família como tenant raiz — todo acesso a paciente resolvido no servidor a partir do token, nunca do cliente
3. Suíte de isolamento entre famílias que cresce sozinha (cobertura obrigatória por rota nova)
4. Consentimento LGPD granular e versionado — conta separado de dado de saúde
5. Trilha de auditoria — o serviço `audit.record()` gravando nas ações reais (a tabela já existe)
6. Exportação e exclusão real de dados do titular, com janela de arrependimento de 7 dias

## Invariante mais importante desta fase

**404, nunca 403**, para recurso de outra família — 403 confirma que o recurso existe e já é vazamento de informação. Isso está em `replit.md`/`FOUNDATION.md` mas vale repetir aqui porque é o requisito mais fácil de esquecer sob pressão de prazo.

## Decisão de execução

Como o conector Replit builda a app inteira por chamada (não story a story), o escopo desta fase vai em um único prompt de atualização, assim como a Fase 01. Verificação pós-entrega segue o mesmo padrão: pedir evidência literal via `ask_question`, nunca aceitar resumo.

## Ajustes feitos durante a execução (registro vivo)

### 1. Bypass de verificação de e-mail em desenvolvimento
**Motivo:** nenhum provedor de e-mail real está conectado ao projeto — conectar um é decisão do fundador (qual serviço, criar conta lá) e não pode ser tomada por mim. Sem isso, o fundador não conseguia testar o próprio fluxo de cadastro.
**Decisão:** mesmo padrão já usado nas rotas de relógio de desenvolvimento — atalho ativo **somente fora de produção**, verificado explicitamente para nunca vazar para produção.
**Pendente:** conectar provedor de e-mail real fica como decisão futura do fundador, não bloqueia esta fase.

### 2. Login com Google (OAuth 2.0) — escopo adicionado, fora do plano original
**Motivo:** pedido direto do fundador em 16/08/2026, depois de testar o cadastro manualmente.
**Nota:** a spec original e o PLAN 01-01 desta história (ZELO-6) tinham "nenhum login social" no bloco NÃO FAÇA. Isso foi revogado por pedido explícito — registrado aqui e na história do Plane, não é desvio silencioso.
**Fronteira respeitada:** as credenciais (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET`) só o fundador pode gerar — exige conta e projeto no Google Cloud Console, que é ação de conta de terceiro e não pode ser feita por mim. O código foi pedido para funcionar em modo degradado (botão desabilitado com graça) até as credenciais reais existirem, para não travar o restante do teste do fundador.
**Pendente do fundador:** criar o projeto/credenciais no Google Cloud Console e fornecer os dois valores como Replit Secrets. Guia enviado na conversa.
