
---

## Decisões tomadas junto com este padrão — 25/08/2026

Registradas aqui porque a ausência delas gera a pergunta "por que não usamos X?"
mais tarde, e a resposta se perde.

### Commitlint — NÃO adotado

Ele exigiria commits no formato *conventional commits* (`feat:`, `fix:`). A
convenção deste projeto é **mensagem em português explicando o porquê, sem
acento no assunto** — está no `CLAUDE.md` desde o começo, e produz histórico
mais útil para quem vai ler depois.

Adotar commitlint significaria trocar a convenção por uma pior para este caso.
**Decisão do fundador: fica como está.**

### `kylezantos/design-motion-principles` — NÃO instalada

É uma skill de terceiro que rodaria na máquina do fundador. **Decisão do
fundador: não instalar.** Os princípios de movimento são aplicados à mão — ver
a Issue de movimento na interface.

### Datadog, New Relic e backend de OpenTelemetry — fora

São **alternativas** ao Sentry, não camadas sobre ele. Datadog e New Relic têm
preço de empresa, e o fundador declarou não ter orçamento em 25/08/2026.
OpenTelemetry é especificação, não serviço — precisaria de um desses por trás.

**Escolhido: Sentry, plano gratuito, e desligado até existir produção.**

### Stryker (teste de mutação) — adiado

Gratuito, mas roda a suíte inteira uma vez por mutante. Com ~9 minutos de suíte,
vira horas. No máximo job semanal no CI, e é decisão separada.

### `arch-contract` — não identificado

O fundador citou a ferramenta, mas não encontrei pacote com esse nome. Pode ser
`dependency-cruiser`, `arch-unit-ts` ou outro. **Pendente de esclarecimento** —
instalar o errado custa mais que perguntar.
