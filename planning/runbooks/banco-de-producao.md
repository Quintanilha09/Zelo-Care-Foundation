# RUNBOOK — Montar o banco de produção

> **Para quando o crédito do Replit voltar.** Escrito em 21/08/2026, logo depois do diagnóstico, para não depender de memória nem de conversa antiga.
> **Estado atual:** desenvolvimento roda normalmente; só produção está parada.
> **Tempo estimado:** 15 a 20 minutos.

---

## 1. O que aconteceu, em uma frase

O banco de **produção** do Replit está **vazio e pausado por limite de gasto** — o teto de gasto mensal estava em **US$ 1** e foi atingido. O app publicado servia a tela de login sem nenhum banco por trás.

Duas descobertas que corrigem entendimentos errados que circularam antes:

- **A lista de tabelas com dados (907 registros de auditoria, 71 cuidadores, 12 pacientes) é do banco de DESENVOLVIMENTO**, não de produção. A aba Overview de produção diz textualmente: *"You don't have any tables in this database yet."*
- Por isso **não serve** aplicar o SQL incremental (`producao-zelo-40-56-58.sql`) — produção precisa do **schema inteiro**, do zero.

**Nada foi perdido.** O código está no GitHub e os dados de desenvolvimento estão íntegros no Development Database.

---

## 2. Pré-requisito — decisão sua, não técnica

Em **Database → Production Database → Overview**, o aviso é: *"You've reached your monthly usage budget. Increase your budget to unpause your database."*

Para destravar é preciso **aumentar o limite de gasto**, o que autoriza cobrança adicional na conta Replit. Enquanto isso não acontecer, nada do resto deste runbook funciona — e **não há problema nenhum em adiar**: sem usuários reais, produção parada não custa nada ao projeto.

Ao ajustar, dois campos na mesma tela:

- **Set a service shutdown limit** — estava em **$1**, quase certamente sem intenção. Ajuste para um valor que reflita o que você aceita gastar.
- **Set a usage alert** — configure para avisar **antes** do teto. Sem isso, o próximo desligamento também vai te pegar no meio de um teste, como aconteceu agora.

---

## 3. Montar o banco (depois de despausado)

Tudo roda no **Shell do Replit**. O `drizzle-kit push` **não funciona** contra produção ali — ele morre em silêncio no "Pulling schema" (o processo é encerrado por falta de memória antes de terminar, sem mensagem de erro). Por isso existe um script próprio.

### 3.1 Atualizar o código

```bash
git pull
```

### 3.2 Copiar a connection string de produção

Em **Database → Production Database → Settings**, clique no ícone de **prancheta** ao lado de `DATABASE_URL`. Não precisa exibir o valor.

### 3.3 Criar as 31 tabelas

```bash
cd lib/db && DATABASE_URL="COLE_AQUI" node scripts/aplicar-sql.mjs sql/producao-schema-completo.sql
```

Saída esperada:

```
✓ SQL aplicado sem erro.

Verificação:
  ✓ tabela patient_access_tokens
  ✓ patients.elder_mode_enabled
  ✓ dose_records.registered_via_elder_mode
  ✓ enum de plano com 'professional'
```

### 3.4 Aplicar o trigger de imutabilidade da auditoria

**Passo fácil de esquecer, e não é opcional:** o `audit_log` só vira append-only por causa deste SQL, que vive fora do Drizzle. Sem ele, o invariante de auditoria imutável (REQ-005) simplesmente não existe no banco.

```bash
DATABASE_URL="COLE_AQUI" node scripts/aplicar-sql.mjs sql/audit-log-immutability.sql
```

### 3.5 Conferir

```bash
DATABASE_URL="COLE_AQUI" node -e "const{Client}=require('pg');(async()=>{const c=new Client({connectionString:process.env.DATABASE_URL});await c.connect();const t=await c.query(\"select count(*)::int n from information_schema.tables where table_schema='public' and table_type='BASE TABLE'\");console.log('tabelas:',t.rows[0].n);const g=await c.query(\"select count(*)::int n from information_schema.triggers where event_object_table='audit_log'\");console.log('triggers no audit_log:',g.rows[0].n);await c.end()})()"
```

Esperado: **31 tabelas** e **2 triggers**. Se vier diferente, pare e investigue antes de seguir.

---

## 4. Secrets de produção

Confira em **Secrets** se todos existem. Em 21/08/2026 estavam lá: `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `SESSION_SECRET`, `VAPID_PRIVATE_KEY`, `VAPID_PUBLIC_KEY`, `VAPID_SUBJECT`.

**Faltando: `ADMIN_PANEL_SECRET`.** Sem ele, o painel `/admin` (ZELO-32) responde erro 500 ao tentar entrar; o resto do app funciona normalmente. Gere um valor forte e **diferente** do que está no `.env.local` local — é a senha do painel operacional em produção.

---

## 5. Google OAuth — a URL mudou

O login com Google falha com `redirect_uri_mismatch` até que a URL de produção seja cadastrada. No [Google Cloud Console](https://console.cloud.google.com/apis/credentials) → **APIs & Services → Credentials** → seu OAuth 2.0 Client ID:

- **Authorized redirect URIs:** `https://zelo-care-foundation.replit.app/api/auth/google/callback`
- **Authorized JavaScript origins:** `https://zelo-care-foundation.replit.app`

Não apague as URLs antigas. Leva cerca de 1 minuto para propagar.

---

## 6. Publicar e testar

Clique em **Republish**. Depois, no app publicado, verifique nesta ordem:

1. **Criar conta** por e-mail e senha — prova que o banco está gravando.
2. **Cadastrar um paciente** — prova o fluxo de consentimento e o limite de plano.
3. **Cadastrar um tratamento** e ver a dose aparecer na tela inicial.
4. **Login com Google** — prova o passo 5.
5. **`/admin`** com o `ADMIN_PANEL_SECRET` — prova o passo 4.

---

## 7. Se der errado

- **Point-in-time recovery está ligado (7 dias)** no banco de produção — dá para voltar o banco a qualquer instante recente. Só é acessível com o banco despausado.
- **Nunca use "Regenerate credentials"**: quebra a conexão do app publicado.
- **Nunca use "Delete database"**.
- Se o script reclamar de comando destrutivo, ele está funcionando como deveria — nenhum dos arquivos acima contém `DROP` ou `TRUNCATE`. Se aparecer esse aviso, **pare** e verifique se está apontando para o arquivo certo.

---

## 8. Ao mudar o schema daqui pra frente

Toda vez que uma história nova mexer no schema, produção precisa acompanhar. O caminho é o mesmo de sempre:

1. `cd lib/db && npx drizzle-kit generate` gera o SQL a partir do schema TypeScript (a fonte da verdade).
2. **Leia o SQL gerado** antes de aplicar — especialmente procurando `DROP`.
3. Aplique com `node scripts/aplicar-sql.mjs <arquivo>`.

O arquivo `sql/producao-zelo-40-56-58.sql` continua no repositório como exemplo de migração **incremental e idempotente**, útil quando produção já tiver dados e só faltarem mudanças pontuais.

---

## Arquivos citados

| Arquivo | Para quê |
|---|---|
| `lib/db/sql/producao-schema-completo.sql` | Cria as 31 tabelas do zero (banco vazio) |
| `lib/db/sql/audit-log-immutability.sql` | Torna a auditoria append-only — **obrigatório** |
| `lib/db/sql/producao-zelo-40-56-58.sql` | Migração incremental (só se produção já tiver dados) |
| `lib/db/scripts/aplicar-sql.mjs` | Aplica qualquer um dos acima e verifica o resultado |

Todos testados em 21/08/2026 contra bancos que simulam produção — vazio e com dados —, incluindo execução repetida (idempotência) e a trava contra comando destrutivo.
