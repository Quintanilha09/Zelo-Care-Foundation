# Fluxo de trabalho — Issues e Pull Requests

> Padrão definido pelo fundador em **25/08/2026**. Vale para **qualquer agente,
> de qualquer modelo**, e para o próprio fundador.
>
> Até esta data, o trabalho ia direto para o `main`. Isso funcionou enquanto
> havia uma sessão só — mas não deixa rastro de *por que* cada mudança
> aconteceu, e é exatamente o rastro que um comprador vai querer ler.

## A regra, em uma frase

**Nenhuma mudança de código entra no `main` sem uma Issue e um PR que a
mencione.**

## O ciclo

```
Issue  →  branch  →  commits  →  PR (menciona a Issue)  →  merge  →  Issue fecha sozinha
```

### 1. Toda tarefa começa como Issue

Três tipos, cada um com template próprio em `.github/ISSUE_TEMPLATE/`:

| Tipo | Quando | Rótulo |
|---|---|---|
| **Correção** | algo que existe está errado | `correcao` |
| **Melhoria** | algo que existe pode ficar melhor | `melhoria` |
| **Nova função** | algo que ainda não existe | `nova-funcao` |

Criar pelo CLI:

```bash
gh issue create --title "[Correção] Foto em pe ocupa a tela inteira" --label correcao
```

### 2. Uma branch por Issue

O nome carrega o número. Sem isso, ninguém liga branch a motivo três semanas
depois:

```bash
git checkout -b correcao/12-foto-ocupa-tela-inteira
```

Prefixos: `correcao/`, `melhoria/`, `funcao/`.

### 3. Commits como sempre

Mensagem em **português**, **sem acento no assunto**, explicando o *porquê*.
Isso não mudou.

### 4. O PR menciona a Issue — e isso é obrigatório

O template (`.github/pull_request_template.md`) já vem com o campo. A palavra
importa:

| Escreva | Efeito |
|---|---|
| `Closes #12` | fecha a Issue automaticamente no merge |
| `Refs #12` | liga sem fechar — para PR que só avança a Issue |

```bash
gh pr create --fill --base main
```

**PR sem Issue mencionada não entra.** Não é burocracia: é o que faz o histórico
responder "por que isto existe?" sem depender de alguém lembrar.

### 5. O merge

```bash
gh pr merge --squash --delete-branch
```

`--squash` de propósito: o `main` fica com um commit por Issue, e o histórico
vira uma lista legível do que foi feito — não do caminho tortuoso até lá.

## O que o PR precisa dizer

O template cobra quatro coisas, e as quatro existem por um motivo aprendido
neste projeto:

1. **A Issue.** Sem ela, o PR é uma mudança sem causa.
2. **O que foi verificado, com número medido.** Nunca escrever um número que não
   se mediu — regra do GSD que vale em todo o repositório.
3. **O que NÃO foi verificado.** Campo obrigatório. Neste projeto isso é rotina,
   não exceção: a interface não abre nesta máquina, e dizer isso em voz alta é
   melhor que deixar quem lê supor que foi testado.
4. **Se mexe no banco ou exige Secret novo.** É o que quebra o deploy no Replit
   quando alguém esquece.

## Onde isto NÃO substitui nada

**O Linear continua sendo o backlog de produto.** Lá vivem as histórias — o que
o produto vai virar. As Issues do GitHub são a unidade de **trabalho no
código**.

Uma história do Linear pode virar várias Issues. Uma correção pequena vira Issue
sem nunca ter passado pelo Linear. Os dois convivem, e o PR liga um ao outro
citando os dois quando fizer sentido:

```
Closes #14
Linear: QUI-9
```

## Exceções, e são poucas

**Só documentação** (`planning/`, `CLAUDE.md`, `CONTEXT.md`) pode ir direto ao
`main`, sem Issue. Documento não quebra produção, e exigir PR para corrigir uma
frase adiciona atrito sem proteger nada.

**Qualquer coisa em `artifacts/`, `lib/` ou `.github/workflows/` passa por PR.**

## Pré-requisito, uma vez só

O `gh` (GitHub CLI) já está instalado nesta máquina. Falta autenticar, e **só o
dono da conta pode fazer isso** — é login, e login não se delega:

```bash
gh auth login --hostname github.com --git-protocol https --web
```

Escolha "Login with a web browser", copie o código de oito caracteres que
aparecer e cole no navegador. Uma vez feito, vale para sempre nesta máquina.

Conferir depois:

```bash
gh auth status
```
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

### `kylezantos/design-motion-principles` — instalada em 26/08/2026

**O fundador reverteu a decisão** algumas horas depois de tomá-la, e vale
registrar as duas metades para não parecer contradição no histórico.

Primeira decisão: não instalar, por ser skill de terceiro rodando na máquina
dele. Segunda: *"Usaremos sim"*.

Instalada com `npx skills add kylezantos/design-motion-principles`. O scanner do
instalador classificou como **Safe, 0 alertas, baixo risco**.

Fica em `.agents/skills/`, **fora do git** — é ferramenta de agente, não código
do projeto, mesma regra do `.claude/`. O que **entra** no git é o
`skills-lock.json`: ele registra qual skill e em que versão, e isso é decisão do
projeto, não configuração de máquina.

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
