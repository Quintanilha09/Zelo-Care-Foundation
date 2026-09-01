# Diário — o teste no aparelho, 31/08 e 01/09/2026

> **Isto é diário, não estado.** O que vale hoje está em [../STATE.md](../STATE.md) e em
> [../../CONTEXT.md](../../CONTEXT.md). Aqui fica o que aconteceu e por quê — que é o que se
> perde primeiro quando só o resultado é registrado.

Movido do `STATE.md` em 01/09/2026: aquele arquivo tem teto de ~150 linhas e chegou a 259. É a
terceira vez que ele estufa, e as duas anteriores terminaram com ele parando de ser lido.

---

## O teste no aparelho mudou o rumo — 31/08 e 01/09/2026

As ondas 2 e 3 do refinamento entraram (Issues #47, #50, #52, #54, #55, #56). **E aí o fundador
abriu o app no celular e o resultado foi duro:** *"NADA DO QUE FOI PLANEJADO PARA MOMENTOS
FUNCIONOU"*. Ele estava certo, e as três causas eram diferentes:

- **o teto da grade nunca engatou.** `max-h-[60vh]` contra ~544px de conteúdo em 10 fotos: passava
  por baixo. O teste provava que *existia um teto*, passava, e o problema seguia na tela
- **as setas ainda se mexiam.** A #50 fixou a altura da imagem e deixou a legenda de fora — estava
  escrito no PR como limitação conhecida, e era o caso mais comum
- **a galeria nunca foi feita.** O pedido original dizia "estilo Google Fotos"; virou uma grade
  com teto

Disso saíram as Issues #63, #64 e #65, e a leva seguinte. **Oito PRs entraram entre 31/08 e
01/09**, de `b81c165` a `40ee3da`:

| Issue | O quê entrou |
|---|---|
| #63 | Momentos vira galeria de verdade: prévia FIXA de 8 fotos na ficha, galeria própria com rolagem, setas sobre a foto |
| #64 | Publicar várias fotos de uma vez, com falha parcial tratada. O limitador subiu de 30 para 100/hora — três lotes de dez batiam no teto |
| #65 | Estoque de tratamento encerrado: sem alarme falso, e com rota para excluir (não existia `DELETE`) |
| #45 | Alterar o próprio nome e a própria senha. Trocar senha derruba as outras sessões |
| #48 | Exportação LGPD passa a conter conta, cuidadores, consentimentos e momentos |
| #49 | Exportação em PDF legível, ao lado do JSON — dois tokens, um por formato |

### Duas lições que valem mais que o código

**Capar por quantidade, não por fração da janela.** `60vh` depende do aparelho, da barra do
navegador, do teclado aberto. Oito fotos são oito fotos em qualquer tela. A #52 falhou por escolher
um teto relativo sem medir contra uso real.

**Testar a pergunta certa.** `grade-com-teto.spec.ts` provava que *existe um teto*. O que importava
era *a altura da ficha não muda quando as fotos dobram* — e essa não depende de o teto ter sido bem
escolhido. O arquivo foi substituído por `galeria-de-momentos.spec.ts`.

### O CI segurou coisa que o typecheck não pega

Cinco reprovações nesta leva, **nenhuma do produto** — todas de método, e duas teriam quebrado o
app em produção:

| O erro | Como apareceu |
|---|---|
| Substituir a **primeira** de duas linhas idênticas | A mudança caiu no esqueleto de carregamento, e o comentário `//` virou TEXTO na tela. Typecheck aceita: texto em JSON é válido |
| **Hook depois de `return`** | `useRef` declarado após `if (!mural) return null` derrubou a ficha do paciente inteira — dezenas de testes sem relação nenhuma com a Issue |
| Medir no meio de uma animação | O diálogo abre com `zoom-in-95` em 200ms; `boundingBox()` lia posição intermediária |
| Mudar rótulo sem varrer quem depende | `"Baixar agora"` virou dois links e o `seus-dados.spec.ts` continuou procurando o antigo |
| Supor em vez de procurar | O teste do PDF buscava texto onde o pdfkit escreve HEX. **A resposta já existia** em `adherence-report.test.ts` |

O padrão é um só: **erro em "quem mais depende disto?"**. O `typecheck` não cobre nenhum, e o
Playwright cobriu todos.
