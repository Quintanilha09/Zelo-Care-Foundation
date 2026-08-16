---
name: ZELO TypeScript Express req.user
description: Por que module augmentation não funciona neste projeto e qual é o padrão correto
---

## Regra

Não usar `declare module "express-serve-static-core" { interface Request { user? } }` neste projeto.

**Why:** `isolatedModules: true` no tsconfig.base.json impede que module augmentations se propaguem entre arquivos. Triple-slash references e imports do arquivo .d.ts/.ts de augmentation não resolvem o problema.

**How to apply:**
- Usar `getAuth(req)` de `src/lib/auth-types.ts` em todos os route handlers.
- `getAuth(req)` faz cast interno `(req as Request & { user?: ZeloUser }).user` e lança se não autenticado.
- `require-auth.ts` atribui via `(req as AuthedReq).user = {...}` com tipo local.
- Nunca criar arquivos `src/types/express.d.ts` ou `src/types/express.ts` com module augmentation de express-serve-static-core — quebra o IRouter e outros tipos do módulo.
