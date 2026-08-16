---
name: ZELO JWT e armadilhas de Clock
description: Como Clock.now() deve ser usado consistentemente em tokens JWT para evitar falhas de revogação em testes e produção
---

## Regra

`generateAccessToken` deve usar `Clock.now()` (não `Date.now()`) para `iat` e `exp` explícitos.
`revokeAllAccessTokensForUser` deve armazenar `Math.floor(Clock.now().getTime() / 1000)` (segundos).
A verificação em `isAccessTokenRevoked` deve usar `payload.iat < logoutAtSec` (strict less than).

**Why:** JWT `iat` tem resolução de 1 segundo. Se `revokeAllAccessTokensForUser` usar `Clock.now()` mas `jwt.sign` usar `Date.now()` (ms), depois de um `Clock.advance()` nos testes o logoutAtSec = T+1s mas o novo iat = T (real clock) → token rejeitado indevidamente.

**How to apply:**
- Sempre importar `Clock` em `tokens.ts`.
- Nos testes de theft detection, inserir `Clock.advance(1001)` ANTES do ataque (garante iat_token < T_revoke).
- `<` (não `<=`) na comparação evita rejeitar tokens emitidos no mesmo segundo do logout-all.
