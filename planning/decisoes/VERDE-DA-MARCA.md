# O verde da marca escureceu — e no tema escuro ele clareou

**Decisão do fundador, 11/09/2026.** Issue #151.

---

## O que foi decidido

O verde da marca do ZELO deixa de ser `#659A76` e passa a ser **`#517B5F`** — o mesmo
matiz, dez pontos de luminosidade mais fechado.

No **tema escuro** ele vai para o outro lado: **`hsl(140 28% 60%)`**, mais claro que o
anterior, com a tinta do rótulo escura (`hsl(140 30% 12%)`) em vez de branca.

Os dois valores estão em `artifacts/zelo/src/index.css`, em `--primary` e
`--zelo-green`, com o cálculo escrito ao lado.

---

## Por que

O botão de ação primária do app é texto branco sobre o verde. Medido em 11/09/2026:

| | verde | branco por cima | piso AA |
|---|---|---|---|
| Claro, antes | `140 21% 50%` | **3,25:1** | 4,5:1 |
| Escuro, antes | `140 20% 45%` | **3,97:1** | 4,5:1 |

Abaixo do piso nos dois temas, e isto vale para **toda ação primária** — "Salvar",
"Convidar", "✓ Registrar", "Enviar acesso" —, porque `--primary` é o fundo do
`<Button>` no variant padrão. O público do ZELO é idoso: é exatamente quem mais perde
com 3,25:1.

O achado saiu da #149, que passou a medir os pares de cor que as telas usam de verdade
em vez de uma lista escrita à mão. Não era defeito de nenhuma issue recente — era
anterior a todas elas.

---

## O que mudou no meio do caminho

A #151 foi escrita supondo que bastava **escurecer nos dois temas**. No claro bastou.
No escuro, medir mostrou que as duas exigências se cancelam:

- branco legível por cima → o verde precisa de **L ≤ 41%**
- botão distinguível do cartão (`40 5% 18%`) → **L ≥ ~46%**

Não existe valor que satisfaça as duas. Em `140 20% 40%` o branco passa (4,87:1) e o
botão cai para **2,77:1 contra o cartão** — abaixo do piso de 3:1 da WCAG 1.4.11 para
componente de interface. O rótulo ficaria legível dentro de um botão que some no fundo.

**A saída foi a outra ponta:** no escuro o verde clareia e a tinta escurece. É o que
todo tema escuro faz com a cor de ação, e mantém intacta a regra que importa nos dois
temas:

> O botão contrasta com a página, e o rótulo contrasta com o botão.

Só o sentido se inverte.

---

## Onde ficou medido

| | rótulo / botão | botão / página | botão / cartão |
|---|---|---|---|
| Claro | **4,81:1** | 4,53:1 | 4,81:1 |
| Escuro | **6,61:1** | 6,35:1 | 5,70:1 |

Os seis acima do piso, e todos melhores que os de antes.

O `contraste-real.test.ts` passou a medir estas três relações direto, nos dois temas —
antes ele só varria classes `bg-zelo-*`, e **o par mais usado do app não estava na
varredura**. A dívida da #151 só tinha aparecido por um proxy (`bg-zelo-green +
text-white`, num arquivo só).

---

## O que mais precisou mudar junto

- **`--ring`**, o anel de foco, é o mesmo verde nos dois temas.
- **`CaregiversPage.tsx`** era o único lugar do app que escrevia `text-white` sobre o
  verde à mão. Virou `text-primary-foreground` — no escuro, `text-white` fixo daria
  branco sobre verde-claro.
- **O e-mail** (`api-server/src/lib/email.ts`) tinha o mesmo botão branco-sobre-verde,
  fora do app e fora de qualquer tema. Foi para `#517B5F`.
- **`/design-tokens`** e a tela `design-reference` publicavam o hex antigo.

---

## A dívida foi paga, o mecanismo ficou

`DIVIDA_CONHECIDA`, no `contraste-real.test.ts`, está **vazia** — e é o estado certo.
A lista existe para o par cujo conserto é decisão de produto, e ela exige piso: pode
não melhorar, nunca piorar. O próximo par nessa situação precisa de número e dono, não
de silêncio.

---

## O que NÃO foi feito

- **Não** se relaxou nenhum piso de teste. O que mudou foi o valor do token.
- **Não** se mexeu no âmbar. O invariante 5 continua inteiro: âmbar para dose pendente
  ou atrasada, verde só para dose tomada, vermelho proibido em contexto de dose.
- **Não** se separou `--primary` de `--zelo-green`. Eles já divergiram uma vez, entre a
  #138 e a #149, e o mesmo verde passou a ter dois valores conforme a classe usada.
  Agora há teste travando os dois juntos.
