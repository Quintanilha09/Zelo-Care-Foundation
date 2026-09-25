# RUNBOOK — Restaurar uma cópia de segurança

> Issue #199. Escrito em 24/09/2026, depois de uma restauração de verdade —
> não de leitura de documentação.
>
> **Quem usar isto vai estar num dia ruim.** Por isso os passos estão em ordem, os erros
> previsíveis estão nomeados, e nada aqui depende de lembrar de nada.

---

## O que você precisa ter em mãos

| | Onde está |
|---|---|
| **A chave privada** | no cofre de senhas do fundador. **Não existe na AWS** |
| Acesso ao bucket `zelo-backup-producao` | credencial com `s3:GetObject` e `s3:ListBucket` — **não** é a do app |
| Um Postgres vazio para restaurar | crie um novo. Nunca restaure por cima de um banco em uso |
| `pg_restore` da série 18 | mesma versão maior do servidor |

**Sem a chave privada não há restauração.** Nem por você, nem pela AWS, nem por ninguém. É por
desenho: é o que torna o arquivo no bucket inútil para quem o pegar. Ela é o item mais importante
do cofre.

---

## 1. Escolher qual cópia

As camadas são prefixos, e o nome ordena por tempo:

```bash
aws s3 ls s3://zelo-backup-producao/horario/ --profile SEU-PERFIL | tail -5
aws s3 ls s3://zelo-backup-producao/diario/  --profile SEU-PERFIL | tail -5
aws s3 ls s3://zelo-backup-producao/mensal/  --profile SEU-PERFIL | tail -5
```

| Camada | Cobre |
|---|---|
| `horario/` | as últimas 48 horas |
| `diario/` | os últimos 30 dias |
| `mensal/` | os últimos 12 meses |

**Não pegue a mais recente por reflexo.** Se o problema foi um dado corrompido há seis horas, a
cópia de uma hora atrás já está contaminada. A pergunta certa é *"qual é a última cópia anterior
ao problema"*, e não *"qual é a mais nova"*.

## 2. Baixar

```bash
aws s3 cp s3://zelo-backup-producao/horario/zelo-2026-09-24T20-09-41Z.dump.zbk . --profile SEU-PERFIL
```

## 3. Criar o banco de destino

```bash
createdb -h HOST -U USUARIO zelo_restaurado
```

**Vazio, e novo.** Restaurar por cima de um banco em uso mistura dado antigo com novo, e a mistura
é pior que qualquer um dos dois sozinhos.

## 4. Restaurar

```bash
pnpm --filter @workspace/api-server exec tsx src/restaurar-backup.ts \
  --arquivo ./zelo-2026-09-24T20-09-41Z.dump.zbk \
  --chave-privada ./chave-privada.pem \
  --destino "postgresql://USUARIO:SENHA@HOST:5432/zelo_restaurado"
```

Para só abrir o arquivo e olhar antes de restaurar, troque `--destino` por `--somente-decifrar`.
Ele escreve o despejo em claro num arquivo temporário e diz onde — **apague quando terminar**, é o
banco inteiro sem cifra.

## 5. Conferir antes de apontar o app

```sql
-- 40
select count(*) from information_schema.tables where table_schema='public';

-- o gatilho de imutabilidade volta junto com o despejo
select tgname from pg_trigger where tgname='audit_log_immutable';

-- e o que importa: tem dado?
select count(*) from dose_records;
select max(created_at) from audit_log;
```

Aquele `max(created_at)` é a resposta para *"até quando esta cópia vai"*.

---

## Erros previsíveis

| Mensagem | O que é |
|---|---|
| `marca ausente ou de outra versão` | o arquivo não é uma cópia do ZELO, ou o download veio truncado |
| erro de decifragem, sem mais detalhe | chave privada de outro par, ou arquivo adulterado. O AES-GCM detecta um único byte trocado |
| `pg_restore: error: ... already exists` | o banco de destino não estava vazio |
| `unsupported version` no `pg_restore` | seu cliente é mais antigo que a série 18 |

---

## O que foi medido, e quando

Em **24/09/2026**, o caminho inteiro, com a função de produção de verdade:

| Etapa | Resultado |
|---|---|
| `fazerCopiaDeSeguranca()` contra um banco real | gravou 918.518 bytes cifrados em `horario/` |
| Baixar do S3 | mesmo tamanho, byte a byte |
| **Procurar termo legível no objeto** | `PGDMP`, `dose_records`, `audit_log`, `medications` — **nenhum** |
| Decifrar com a chave privada | 918.222 bytes, começando em `PGDMP` |
| `pg_restore` num banco vazio | **0 → 40 tabelas**, com o gatilho de imutabilidade |
| Suíte completa contra o banco restaurado | ver o PR da #199 |

**Backup que nunca foi restaurado não é backup, é esperança.** Refaça esta medição sempre que
mudar o formato do pacote, a versão do Postgres ou a imagem de produção.

---

## O que este backup NÃO cobre

- **A mídia** (fotos do mural, documentos). Ela vive no bucket `zelo-midia-producao`, com
  versionamento ligado — mas não entra no despejo do banco. O banco guarda as chaves; os arquivos
  ficam onde estão.
- **Perder a chave privada.** Não há recuperação, e isso é o desenho, não uma falha.
