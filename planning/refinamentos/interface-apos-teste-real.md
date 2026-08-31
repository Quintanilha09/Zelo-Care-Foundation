# Refinamento — a leva que saiu do teste no aparelho

> Pedido do fundador em **31/08/2026**, depois do primeiro roteiro de teste feito **no app
> publicado, em navegador de verdade**, com o deploy no Replit já aplicado.
>
> Refinamento antes de qualquer código, como manda o [`PADRAO-GSD.md`](../PADRAO-GSD.md).
> **Doze Issues abertas no GitHub, #45 a #56.**

## De onde esta leva vem, e por que isso importa

As levas anteriores nasceram de **captura de tela** (QUI-14 a QUI-19) e de **auditoria**
(fase 11). Esta é a primeira que nasce de alguém **usando o app no próprio aparelho**, com dado
real, do começo ao fim.

A diferença aparece no tipo de achado. Cinco dos doze itens só existem no celular, e três deles
nenhuma leitura de código encontraria — inclusive o único que faz a pessoa **perder trabalho**
(#53, a foto que some ao publicar).

Vale registrar também o que o teste **não** encontrou: nenhum defeito de registro de dose, nenhum
de escalonamento, nenhum de autorização entre famílias. O núcleo do produto passou. O que apareceu
foi acabamento — e um buraco de conformidade.

---

## O que o refinamento acrescentou ao pedido

Quatro coisas saíram da leitura do código e **não** estavam no pedido original. As três primeiras
mudam o trabalho; a quarta é uma discordância registrada.

### 1. A exportação não é só ilegível — ela é incompleta (#48)

O pedido era trocar `.json` por `.pdf`. Ao ler `routes/export.ts:74-88` contra o arquivo exportado
de verdade, apareceu coisa pior que formato: **o pacote não contém os dados pessoais de quem o
pediu.** Sem nome, sem e-mail, sem os cuidadores, sem os consentimentos, sem os Momentos. Só os
números `userId: 169` e `caregiverId: 196`.

E o arquivo afirma, de si mesmo: *"Exportação de dados pessoais conforme solicitação LGPD."*

Gerar um PDF bonito desse conteúdo tornaria a falha mais visível, não menor. Por isso **#48 vem
antes de #49**, e por isso #48 é `correcao` + `seguranca`, não `melhoria`.

### 2. "Convites pendentes" não é um vazio sem mensagem — é uma condição errada (#47)

O sintoma era "a área fica vazia com o título". A causa está em `CaregiversPage.tsx:321`: a guarda
de fora conta `invites.length` — **todos** os convites — e a lista de dentro filtra
`status === "pending"`. Um convite aceito e nenhum pendente faz a guarda passar e a lista sair
vazia.

Não é falta de mensagem de estado vazio. São **duas linhas contando conjuntos diferentes**, e a
mensagem é a segunda metade da correção.

### 3. "Alterar e-mail" não cabe na mesma Issue que nome e senha (#45 e #46)

Nome e senha não dependem de nada e podem ser feitos hoje. **E-mail exige verificar o endereço
novo**, e isso exige provedor de e-mail, que não existe — a cadeia é
`nome/domínio → DNS → Resend → fase 11.1b → #46`.

Fundir os três numa Issue só bloquearia dois trabalhos prontos atrás de uma decisão de negócio sem
data. Separados, o #45 anda agora.

### 4. Discordância registrada: "apenas Nome e Sobrenome" (#56)

O pedido foi limitar o nome do paciente a **exatamente** duas palavras. **A recomendação é "pelo
menos duas"**, e a evidência está nos dados de teste do próprio projeto: o paciente cadastrado
chama-se **"Jailson Mendes Delicia"** — três palavras. "Maria da Silva" e "José dos Santos Neto"
também seriam recusados.

O objetivo declarado — *"evitar textos gigantes ou maliciosos"* — é atingido pelo **teto de 60
caracteres** e pela **allow-list de caracteres**. A contagem de palavras não acrescenta segurança;
só recusa nome de gente de verdade.

**A decisão é do fundador.** Se for por duas palavras exatas, é uma linha de regex — mas então é
preciso decidir o que fazer com os pacientes já cadastrados que não passam, porque o
`UpdatePatientBody` passaria a recusar qualquer edição deles.

---

## Uma premissa do pedido que os dados não confirmam

O relato sobre "Atividade recente" foi *"a lista cresce infinitamente"*. **Ela não cresce.**
`CaregiversPage.tsx:343` passa `limit={15}`, e `routes/activity.ts:74` limita a 100 no servidor.

O incômodo é real — 15 itens ocupam muita altura, e o feed fica no fim da página. Mas a correção
muda: **paginação não resolve** um problema que não é de quantidade de dados. O que resolve é teto
de altura com rolagem própria, que é a mesma correção da grade de Momentos (#52). Ver **#54**.

---

## O plano — quatro ondas

A ordem não é por tamanho nem por área da tela. É por **o que custa mais a quem usa**, com uma
regra de dependência: nada que dependa de decisão do fundador entra antes do que não depende.

### Onda 1 — o que faz perder trabalho ou afirma o que não cumpre

| Issue | Por que primeiro |
|---|---|
| [#53](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/53) Foto some ao publicar no celular | **É o único item que destrói trabalho da pessoa.** Todos os outros são incômodo |
| [#48](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/48) Exportação LGPD incompleta | Afirma conformidade que não entrega. É risco jurídico, não acabamento |

**O #53 é a exceção do plano: ele começa por reprodução, não por código.** A regra do `CLAUDE.md`
é explícita e existe por causa deste projeto — *corrigir pelo sintoma já falhou duas vezes
seguidas no mesmo bug*. A hipótese principal está na Issue (o token de acesso vive só em memória,
e o sistema descartar a página ao abrir a galeria explicaria o "voltou para a tela inicial"), mas
**hipótese não é diagnóstico**.

### Onda 2 — defeito visível, correção pequena e independente

Quatro Issues sem dependência entre si, todas de poucas linhas. Podem ir em qualquer ordem, e em
paralelo se houver mais de uma sessão.

| Issue | Tamanho |
|---|---|
| [#47](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/47) Convites pendentes com título órfão | duas linhas + mensagem |
| [#50](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/50) Setas do visualizador se movem | uma classe de CSS |
| [#55](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/55) Botão "Enviar acesso" estoura | `truncate` + encurtar o rótulo |
| [#56](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/56) Validar o nome do paciente | schema + formulário |

**O #55 e o #56 andam juntos de propósito, e nenhum substitui o outro:** a validação reduz a
probabilidade, mas 60 caracteres ainda estouram um botão em tela pequena — e os pacientes já
cadastrados não passam pela validação nova.

### Onda 3 — o mesmo padrão aplicado duas vezes

| Issue | |
|---|---|
| [#52](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/52) Grade de Momentos sem teto | |
| [#54](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/54) Atividade recente sem teto | |

São o **mesmo defeito em dois lugares**: seção que cresce e empurra a página. Fazer as duas na
mesma leva, com a mesma solução, para o app não ficar com dois jeitos diferentes de resolver a
mesma coisa. Quem fizer a primeira deixa o padrão pronto para a segunda.

Cuidado registrado no #52: a QUI-18 entregou paginação por cursor, e rolagem infinita presa a um
container é caso clássico de scroll que não dispara. Conferir antes de implementar.

### Onda 4 — o que é maior, ou depende de decisão

| Issue | Estado |
|---|---|
| [#51](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/51) Deslizar para trocar de foto | Pronta. Depois do #50, que mexe no mesmo componente |
| [#45](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/45) Alterar nome e senha | Pronta. Rota nova, limitador de taxa, revogação de sessões |
| [#49](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/49) Exportação em PDF | **Depende do #48** |
| [#46](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/46) Trocar o e-mail | 🔒 **Bloqueada** por provedor de e-mail |

---

## O que vale para todas

- **Issue → branch → commits → PR que menciona a Issue → merge com `--squash`.** Nada entra no
  `main` sem isso ([`decisoes/FLUXO-GITHUB.md`](../decisoes/FLUXO-GITHUB.md)).
- **Uma sessão por vez no `main`.** Havendo outra ativa, trabalhe em branch — já houve colisão
  neste repositório em 31/08/2026.
- **A suíte não roda nesta máquina** desde 31/08/2026: o Smart App Control bloqueia
  `argon2.glibc.node` e `biome.exe`. **O CI em Linux é a única verificação real**, e todo número
  vai para o PR com o id da execução.
- **Toda Issue de interface ganha teste em `e2e/`**, no projeto `celular` (Pixel 7) quando o
  defeito for de tela pequena. Cinco destes doze só existem no celular — e a QUI-15 já provou que
  o Playwright pega o que ninguém vê.
- **Invariantes 3, 4 e 5 valem em tudo**: nenhum log com nome de medicamento; o app não
  interpreta; âmbar e nunca vermelho em contexto de dose. O #49 (PDF) é o que mais encosta nos
  três.

---

## Sobre o Linear

O backlog de **produto** vive no Linear; as Issues do GitHub são a unidade de **trabalho no
código** ([`decisoes/FLUXO-GITHUB.md`](../decisoes/FLUXO-GITHUB.md)). As doze acima estão no
GitHub e prontas para virar cards.

**Não foi possível criar os cards do Linear nesta sessão:** o conector exige autenticação e a
sessão não é interativa. Os títulos e corpos das Issues servem de texto pronto para colar, e o PR
de cada uma deve citar os dois quando o card existir — `Closes #NN` e `Linear: QUI-NN`.
