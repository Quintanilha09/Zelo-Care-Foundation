# Memória do ZELO — consolidada

As memórias que viviam nesta pasta foram **consolidadas em 23/08/2026** e não existem mais aqui.

O motivo: o contexto do projeto estava espalhado por seis lugares (esta pasta, a raiz do
repositório, um vault do Obsidian e uma branch de CI). Duas fontes divergiram, dois agentes
trabalharam com quadros diferentes, e um arquivo desta pasta descrevia uma tabela e um arquivo
de teste que **nunca existiram** — o que quebrou a suíte inteira no `main`.

## Onde está agora

| Você procurava | Agora está em |
|---|---|
| Regras operacionais, invariantes, armadilhas em resumo | [`CLAUDE.md`](../../CLAUDE.md) na raiz — carregado automaticamente |
| Estado atual verificado do projeto | [`CONTEXT.md`](../../CONTEXT.md) |
| Armadilhas técnicas em detalhe | [`planning/decisoes/ARMADILHAS.md`](../../planning/decisoes/ARMADILHAS.md) |
| Decisões de produto e invariantes | [`planning/decisoes/FOUNDATION.md`](../../planning/decisoes/FOUNDATION.md) |
| Decisões de plataforma | [`planning/decisoes/PLATFORM_DECISIONS.md`](../../planning/decisoes/PLATFORM_DECISIONS.md) |
| Onde o desenvolvimento parou | [`planning/STATE.md`](../../planning/STATE.md) |

**Não crie memórias novas aqui.** Registre em `planning/` e aponte a partir do `CLAUDE.md`,
que é o único arquivo garantidamente lido por todo agente que abrir este repositório.
