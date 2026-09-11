# Refinamento — o modo escuro que não chegava às cores de dose

> Relato do fundador em 11/09/2026, com cinco capturas do app publicado. Tudo
> abaixo foi **medido no CSS compilado** nesta sessão.

## O relato

1. *"Há alguns bugs no modo escuro, de itens que continuam na mesma
   estilização do modo claro."*
2. *"Em /planos as palavras marcadas em verde estão muito escuras no modo
   escuro, atrapalhando a visualização."*
3. *"Verifique se este problema acontece somente com estes itens."*

A resposta à terceira pergunta é **não**. Os dois primeiros relatos são o
**mesmo defeito**, e ele atinge tudo.

## A causa, medida

O `index.css` declara os tokens dentro de **`@theme inline`**. Com `inline`,
o Tailwind v4 **escreve o valor direto na regra** em vez de deixar uma
referência a variável.

Isso é invisível enquanto o token é declarado com uma indireção dentro, e
fatal quando ele é um literal:

| Declaração no `@theme inline` | Vira, no CSS compilado | Segue o `.dark`? |
|---|---|---|
| `--color-card: hsl(var(--card))` | `.bg-card{background-color:hsl(var(--card))}` | **sim** — o `.dark` troca `--card` |
| `--color-zelo-amber-bg: hsl(38 82% 95%)` | `.bg-zelo-amber-bg{background-color:#fdf5e8}` | **não** — a cor está congelada |

Os **8 tokens `zelo-*` são os únicos declarados com valor literal** no
arquivo. Todo o resto usa `hsl(var(--x))` e por isso sempre funcionou.

### O alcance, contado no CSS compilado

**21 utilitários gerados**, todos congelados na cor do tema claro:

```
.bg-zelo-amber-bg{background-color:#fdf5e8}      ← o cartão creme de /pacientes
.text-zelo-green-fg{color:#3c5d47}               ← o verde escuro de /planos
.text-zelo-amber-fg{color:#95630f}
.bg-zelo-green-bg{background-color:#f0f5f1}
.bg-zelo-amber{background-color:#eaa52e}
.border-zelo-amber{border-color:#eaa52e}
… e mais 15, incluindo as variantes de opacidade
```

São **131 usos em 27 arquivos**. Ou seja: **o modo escuro do ZELO está
quebrado em toda a linguagem de cor de dose**, não em alguns itens.

### As duas capturas, explicadas

- **`/pacientes`**: o cartão do paciente descoberto usa `bg-zelo-amber-bg` →
  `#fdf5e8`, creme. O nome do paciente é `text-foreground`, que no escuro é
  claro. **Claro sobre creme**: o nome some, e é o que a captura mostra.
- **`/planos`**: "Até 5", "Ilimitado", "Completo", "Incluída" usam
  `text-zelo-green-fg` → `#3c5d47`, verde escuro. **Escuro sobre escuro.**

## Por que o teste da #138 passou

`tema-escuro.test.ts` lê o **`index.css`** e verifica que o `.dark` define os
oito tokens, e que cada par passa o piso AA de 4,5:1.

Ele passou porque **as duas coisas são verdade na fonte**. O que ele nunca
verificou foi se o `.dark` **chega ao CSS que o navegador recebe**.

`VULNERABILIDADE CONFIRMADA` de método, não de código: um teste que lê a
**intenção** e não o **resultado** dá exatamente esta falsa segurança. Ele
me deixou entregar a #138 com cinco casos verdes e o recurso inteiro morto.

## Um segundo buraco, achado no caminho

O mesmo teste mede contraste só dos pares **oficiais** — `-bg` com o `-fg` da
mesma cor. Mas as telas não usam só isso:

| Par usado de verdade | Onde | Estava medido? |
|---|---|---|
| `bg-zelo-amber-bg` + `text-foreground` | nome do paciente descoberto (#122) | **não** |
| `bg-zelo-amber-bg` + `text-muted-foreground` | fuso do paciente, dose do cartão | **não** |
| `bg-zelo-green-bg` + `text-foreground` | linha de "Já foi" na tela inicial | **não** |

Depois de consertar a raiz esses pares provavelmente passam — mas
"provavelmente" não é verificação, e foi "provavelmente" que produziu este
relato.

## O que entra

### A — a raiz

Os 8 tokens passam a ter **dois níveis**, como todo o resto do arquivo:

```
@theme inline { --color-zelo-amber-bg: hsl(var(--zelo-amber-bg)); }
:root        { --zelo-amber-bg: 38 82% 95%; }
.dark        { --zelo-amber-bg: 38 30% 20%; }
```

Nenhum valor muda de aparência no claro. O que muda é a cor **passar a
existir** no escuro.

**O teste passa a ler o CSS compilado.** É a única forma de provar que o
override chega — e é o que teria pego isto.

### B — os pares reais

Varrer o código atrás de **toda** combinação de fundo e texto que as telas
realmente usam, e medir todas. Não a lista que eu imaginei: a que existe.

## O que NÃO fazer

- **Não** trocar a matiz das cores de estado. Âmbar é dose pendente, verde é
  dose tomada; o que muda entre os temas é a luminosidade, nunca o
  significado (invariante 5). Vermelho continua proibido em dose.
- **Não** consertar tela por tela com classe `dark:`. São 131 usos em 27
  arquivos, e um remendo por tela deixa a próxima nascer errada. O fundador
  pediu **global**, e global aqui quer dizer no token.
- **Não** confiar em olhar a tela. O piso é número medido: AA 4,5:1 para
  texto, e o público deste produto é idoso.

## As issues

| Issue | Tipo | O quê |
|---|---|---|
| A | Correção · crítica | Os tokens de dose não alcançam o escuro — `@theme inline` congela literal |
| B | Correção | O teste media só os pares oficiais; as telas usam outros |

**A primeiro.** Ela é o app quebrado; B é a rede que impede a volta.
