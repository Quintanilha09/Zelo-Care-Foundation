---
name: ZELO — Setup técnico e armadilhas
description: Decisões técnicas e armadilhas conhecidas na fundação do ZELO (monorepo pnpm)
---

# ZELO — Setup Técnico e Armadilhas

## Orval codegen e lib/api-zod

**Regra:** Após qualquer `pnpm --filter @workspace/api-spec run codegen`, o orval
sobrescreve `lib/api-zod/src/index.ts` e readiciona `export * from './generated/types'`.
Isso causa TS2308 (colisão de nomes como `ListScheduledDosesParams`).
Solução: reescrever `lib/api-zod/src/index.ts` após codegen, deixando apenas:
```ts
export * from "./generated/api";
// Note: do NOT re-export ./generated/types
```
**Why:** Orval gera nomes idênticos em `api.ts` e `types.ts` — re-exportar ambos causa conflito.

## node --experimental-strip-types vs tsx

**Regra:** Usar `--experimental-strip-types` apenas para testes SEM dependências de `@workspace/db`.
Para seed e testes de integração que importam `@workspace/db`, usar `tsx`.

**Why:** `--experimental-strip-types` no Node 24 não suporta importação de diretório
(`import from "./schema"` sem extensão explícita falha com ERR_UNSUPPORTED_DIR_IMPORT).
O `tsx` resolve o module graph corretamente.

**Como está configurado:**
- `pnpm run test` → `node --experimental-strip-types --test` (clock + safe-logger)
- `pnpm run test:all` → `tsx --test` (todos, incluindo integridade com banco)
- `pnpm run seed` → `tsx src/seed.ts`

## Integridade do banco — erros de constraint via drizzle

**Regra:** O drizzle envolve erros pg em um objeto de erro próprio. Para verificar
código de constraint unique (23505), checar TANTO `err.code` quanto `err.cause?.code`.

**Padrão nos testes:**
```ts
const code = e.code ?? e.cause?.code;
const msg = (e.message ?? "") + (e.cause?.message ?? "");
assert.ok(code === "23505" || msg.includes("unique") || msg.includes("duplicate"), ...);
```

## Clock — freezeAt + advance são cumulativos

**Regra:** `Clock.freezeAt(date)` define a base; `Clock.advance(ms)` adiciona sobre ela.
A função `now()` aplica o offset SOBRE a data congelada quando ambos estão ativos.
Isso permite simular escalonamento de alertas (15/30/60min) nos testes.

## Restrição de cor âmbar no api-server

- `artifacts/api-server/src/lib/clock.ts` — relógio controlável
- `artifacts/api-server/src/lib/safe-logger.ts` — allowlist de campos seguros
- `lib/db/src/schema/scheduled-doses.ts` — UNIQUE(treatment_id, scheduled_at)
- `lib/db/src/schema/dose-records.ts` — UNIQUE(scheduled_dose_id)
