# RUNBOOK — Montar o banco de produção

> Reescrito em **24/09/2026**, na Issue #198. A versão anterior era da era Replit e ficou
> obsoleta em três frentes: o Replit foi cancelado, o esquema passou de 31 para 40 tabelas, e a
> montagem deixou de ser "aplicar um SQL grande" para ser uma migração versionada.
> O texto antigo continua no histórico do git.

---

## A resposta, em uma linha

```bash
pnpm --filter @workspace/db run migrate
```

Com `DATABASE_URL` apontando para o banco de produção. Ele aplica os arquivos de
`lib/db/migrations/` em ordem, **não pergunta nada e não apaga nada**.

Num banco vazio, o resultado é o esquema completo: **40 tabelas**, 29 tipos, 66 chaves
estrangeiras, e o gatilho de imutabilidade do `audit_log` ativo. Medido em 24/09/2026 contra um
PostgreSQL 18.6 zerado.

---

## A restrição que decide *de onde* rodar

**O banco de produção não aceita conexão da internet.** `Public mode` está desligado no Lightsail,
e é assim que tem que ficar — só recursos Lightsail da mesma região alcançam.

Isso significa que **`migrate` não roda do seu computador.** Ele precisa rodar de dentro da AWS.

| Onde | Serve? |
|---|---|
| Sua máquina, pela internet | ❌ o banco recusa |
| GitHub Actions | ❌ mesma coisa: é externo |
| Um deployment no serviço de contêiner `zelo` | ✅ |

**A esteira da #201 é quem resolve isto**, e é item de aceite dela: o deploy precisa aplicar as
migrações de dentro, antes de o app novo começar a atender.

`RISCO POTENCIAL:` abrir o modo público "só para migrar" é a saída tentadora e errada. Um banco
de saúde exposto à internet, mesmo por dez minutos, é varrido por robô — as faixas de IP da AWS
são vasculhadas continuamente.

---

## Antes de rodar

1. **Confirme que é o banco certo.** `DATABASE_URL` trocado é como se erra isto.
2. **Confirme que o backup automático está ligado.** Página do `zelo-db` → *Snapshots & restore*
   deve dizer uma semana de retenção, em incrementos de cinco minutos.
3. **Leia o que vai ser aplicado.** `git log --oneline lib/db/migrations/` mostra o que entrou
   desde a última vez.

---

## Depois de rodar

Confira na mão, não suponha:

```sql
-- 40
select count(*) from information_schema.tables where table_schema='public';

-- audit_log_immutable
select tgname from pg_trigger where tgname='audit_log_immutable';

-- o que já foi aplicado, e quando
select * from drizzle.__drizzle_migrations order by created_at;
```

E prove que a imutabilidade vale, com uma linha de teste:

```sql
insert into audit_log (family_id, entity_type, entity_id, action)
  values (1,'teste','1','created');
update audit_log set entity_type='x';   -- tem que dar ERRO
delete from audit_log;                  -- tem que dar ERRO
```

**Gatilho `FOR EACH ROW` não dispara sem linha.** Rodar o `update` numa tabela vazia devolve
`UPDATE 0` e não prova nada — foi assim que o primeiro teste desta verificação passou sem testar
coisa alguma.

---

## Ao mudar o esquema daqui pra frente

1. Edite `lib/db/src/schema/`.
2. `pnpm --filter @workspace/db run generate` escreve a migração.
3. **Leia o SQL gerado.** É onde se descobre que uma renomeação virou "apaga a coluna e cria
   outra".
4. Migração e esquema entram no **mesmo commit**.
5. O deploy aplica.

**Nunca** rode `push` contra produção. Ele compara esquema com banco vivo e aplica a diferença —
em 12/09/2026 ofereceu **truncar `scheduled_doses`**, o histórico de dose. Detalhes em
[lib/db/README.md](../../lib/db/README.md).

---

## Se der errado no meio

Uma migração que falha no meio deixa o banco parcialmente aplicado, e a linha correspondente
**não** entra em `__drizzle_migrations`.

1. **Não rode de novo às cegas.** Leia o erro: quase sempre é uma constraint brigando com dado
   existente.
2. Veja o que já entrou: compare `information_schema.tables` com o que a migração criava.
3. Desfaça à mão o pedaço aplicado, ou restaure o ponto no tempo anterior (o Lightsail guarda
   uma semana em incrementos de cinco minutos).
4. Corrija a migração, gere de novo, e teste **num banco vazio** antes de repetir em produção.

---

## Arquivos citados

| Arquivo | Para quê |
|---|---|
| `lib/db/migrations/` | as migrações. São o histórico do banco |
| `lib/db/README.md` | os comandos, e por que `push` não vai para produção |
| `lib/db/sql/producao-schema-completo.sql` | despejo da era Replit, **histórico**. Não use |
