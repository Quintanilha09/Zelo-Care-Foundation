---
name: ZELO Testes de integração: isolamento e sequência
description: Padrões obrigatórios para testes que compartilham banco de dados PostgreSQL
---

## Regras

**1. `--test-concurrency=1` é obrigatório no test:all.**
`node --test` roda arquivos em paralelo por padrão. Com banco compartilhado, isso causa race conditions em contagens e cleanup. Sempre usar `tsx --test --test-concurrency=1` no script de testes de integração.

**2. Hooks `before` devem ser idempotentes.**
Se o cleanup falhar em um run anterior, o próximo run tenta criar o mesmo usuário e falha com "duplicate key". Padrão correto: ao início do `before`, deletar os dados de teste com `.catch(() => {})`.

**3. FK com `onDelete: "set null"` exige coluna nullable.**
Schema com `column.notNull().references(..., { onDelete: "set null" })` é uma contradição — o banco rejeita o cascade. Toda FK com set null deve ser nullable (sem `.notNull()`). Colunas afetadas no ZELO: `deletion_requests.requested_by_user_id`, `deletion_requests.family_id`.

**4. Testes de auth não devem revogar tokens usados em testes posteriores.**
No isolation.test.ts, o teste de `POST /auth/logout` deve usar um token temporário (não tokenA), para que tokenA permaneça válido nos testes seguintes de `/export` e `/consent`.

**Why:** Esses padrões foram descobertos após múltiplas falhas de CI com o banco real.
