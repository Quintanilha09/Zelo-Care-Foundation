# Fases — estado dos artefatos e o padrão daqui pra frente

## Estado honesto, em 23/08/2026

`DÍVIDA DE PROCESSO CONFIRMADA.` Os artefatos de fase pararam na 04 enquanto o projeto chegou
à fase 10:

| Fase | CONTEXT | PLANs | VERIFICATION |
|---|---|---|---|
| 01 — Fundação e Guardrails | ✅ | ✅ 5 | ❌ |
| 02 — Identidade, Família, LGPD | ✅ | ❌ | ❌ |
| 03 — Paciente e Cuidadores | ✅ | ❌ | ❌ |
| 04 — Tratamento e Agenda | ✅ | ❌ | ❌ |
| 05 a 10 | ❌ | ❌ | ❌ |

**Nenhum `NN-VERIFICATION.md` foi criado em nenhuma fase**, apesar de o
[`config.json`](../config.json) exigir em `documentation_protocol.on_phase_complete`.

## O que foi decidido sobre isso

**Não reconstruir retroativamente as fases 05 a 10.** A informação existe — em prosa, com commits
e decisões — em [`../HISTORIAS.md`](../HISTORIAS.md) e
[`../historico/DIARIO-ate-2026-08-23.md`](../historico/DIARIO-ate-2026-08-23.md). Recriar o formato
por cima disso seria trabalho caro produzindo documento que ninguém leria: exatamente o
overengineering que a §11 do GSD proíbe.

**O padrão passa a valer da próxima fase em diante.** Fase nova fecha com os três artefatos.

## Padrão a seguir

```
planning/phases/NN-nome-da-fase/
  NN-CONTEXT.md        antes de começar — o que a fase precisa saber
  NN-MM-PLAN.md        um por unidade de trabalho, antes de implementar
  NN-VERIFICATION.md   ao fechar — evidência de que funcionou
```

### O `NN-VERIFICATION.md` é o que estava faltando

Ele não é resumo do que foi feito — isso é o `HISTORIAS.md`. Ele é **evidência objetiva**, e por
isso precisa conter números medidos, não afirmações:

```markdown
# NN — VERIFICAÇÃO

**Fase:** NN — nome
**Fechada em:** DD/MM/AAAA
**Histórias:** ZELO-xx a ZELO-yy

## Critérios de aceite

| História | Critério | Como foi comprovado |
|---|---|---|
| ZELO-xx | ... | teste `arquivo.test.ts::nome do caso` |

## Evidência executada

- `pnpm --filter @workspace/api-server run test:all` → **N testes, N passando, N falhas**
- `pnpm run typecheck` → exit N
- `pnpm --filter @workspace/api-server run lint:clock` → exit N
- Comportamento verificado em navegador: o quê, por quem, em que ambiente

## Segurança (Security Gate)

Ativos tocados, fronteiras de confiança, entrada de usuário, autorização, secrets, abuso.
Qualquer achado com rótulo: `VULNERABILIDADE CONFIRMADA` / `RISCO POTENCIAL` / `NÃO VERIFICADO`.

## Regressão

O que poderia ter quebrado e como foi descartado.

## O que NÃO foi verificado

Lista explícita. **Um gap declarado é aceitável; um gap oculto não é.**
```

### Regras que valem para todo artefato daqui pra frente

1. **Nenhum número sem medição.** "395 testes passando" só entra se você rodou a suíte naquela
   sessão. Caso contrário, escreva a data e a origem da última medição conhecida e rotule
   `NÃO VERIFICADO`. Já houve documentação afirmando que a suíte passava no mesmo commit que a
   quebrou.
2. **Um gap declarado vale mais que um artefato completo e falso.** A seção "o que NÃO foi
   verificado" é obrigatória, mesmo vazia.
3. **Ao fechar a fase:** `NN-VERIFICATION.md`, atualizar [`../STATE.md`](../STATE.md), e
   [`../ROADMAP.md`](../ROADMAP.md) se o escopo mudou.
4. **`STATE.md` é estado, não diário.** Passou de ~150 linhas, mova o excedente para
   [`../historico/`](../historico/).

## Violações bloqueantes

`CON-001` a `CON-015`, listadas em [`../config.json`](../config.json). Violação de qualquer uma é
devolução automática, **independente dos critérios de aceite terem sido cumpridos**.
