# Refinamento — quem cuida de quem, e o que se guarda sobre o cuidador

> Pedido do fundador em **08/09/2026**, depois de testar o app: a foto de perfil
> ainda não existe; `/cuidadores` sugere que todo mundo está na mesma família;
> falta saber que cuidador atende que paciente; falta um alerta quando um
> paciente fica descoberto; e falta dado de identificação do cuidador.
>
> Refinamento antes de qualquer código, como manda o [`PADRAO-GSD.md`](../PADRAO-GSD.md).
> **Cinco Issues: #120 a #124.** A #116 (foto) já existia e continua valendo.

## O pedido, em quatro partes

1. **Foto de perfil** — cada cuidador com foto, para a família saber a aparência
   de quem cuida. *(Já é a #116.)*
2. **`/cuidadores` diz quem cuida de quem** — hoje o título "Quem cuida com você"
   sugere família única. Numa instituição há vários cuidadores, cada um com seus
   pacientes. Quer ver, por cuidador, **os pacientes que ele atende** e **as
   famílias em que está**.
3. **Paciente descoberto** — filtrar por paciente sem cuidador, e receber
   **e-mail depois de 2 dias** se ninguém foi vinculado. *"Isso é grave."*
4. **Identificação do cuidador** — CPF, endereço, número, e-mail, nome completo,
   data de nascimento. *"Para afirmar a segurança."*

---

## O que o refinamento encontrou

Cinco achados. Os dois primeiros mudam o formato do trabalho; o quarto é uma
discordância registrada.

### 1. "Que paciente cada cuidador atende" não existe no banco — é a fase 11.6

Varri `lib/db/src/schema/` inteiro. **Não há nenhuma tabela ligando cuidador a
paciente.** O `caregiverId` aparece em dez tabelas (`dose_records`,
`activities`, `media_assets`, …) sempre com o mesmo sentido: *quem fez a ação*.
Nunca *de quem essa pessoa cuida*.

Hoje o modelo é: **cuidador pertence a uma família, e vê todos os pacientes
dela.** O cabeçalho de `artifacts/api-server/src/lib/capabilities.ts` descreve
exatamente este buraco:

> *"o papel hoje é por FAMÍLIA … a spec original pede granularidade por PACIENTE
> ('cuidador do pai, observador da mãe, mesma conta'). Isso exigiria uma tabela
> de junção caregiver×patient …"*

É a **fase 11.6**, marcada `ADIÁVEL` no `STATE.md` com a justificativa **"sem
caso de uso real"**. O fundador acabou de fornecer um. E não é só o
institucional: o exemplo do próprio spec — pai e mãe, mesma conta — é um caso
de família. **A 11.6 destrava por mérito B2C**, que é a justificativa honesta.

Sem essa junção, os pedidos 2 e 3 são impossíveis: "paciente sem cuidador" não
tem como ser verdade hoje, porque todo cuidador da família cobre todo paciente
dela.

### 2. "Em quais famílias o cuidador está" vaza dado entre famílias

Um cuidador pode estar em várias famílias — é o caso real que o `FamilySwitcher`
existe para resolver: cuidar da própria mãe **e** ser contratada de outra casa.

Mostrar à família Silva que a Ana também trabalha para a família Souza expõe uma
relação que a Silva não tem direito de conhecer. É o **invariante 2** — recurso
de outra família responde 404, não 403 — aplicado a um dado que não é de
paciente, mas é igualmente de terceiro.

**Recomendação: esta parte sai do escopo.** O que sobra de útil é o vínculo
dentro do círculo que quem olha já enxerga, e isso o achado 1 entrega.

### 3. O alerta de 2 dias é a parte mais barata — o encanamento já existe

`lib/queue.ts` já roda **cinco jobs cron em produção** via `boss.schedule`:
extensão de janela de dose (`0 3 * * *`), ciclo de tratamento (`5 3 * * *`),
marcação de dose atrasada (`*/15 * * * *`), monitor operacional (`*/2 * * * *`)
e expurgo de mídia (`20 3 * * *`).

Um job diário que varre paciente sem cuidador há 2+ dias e dispara e-mail pelo
Resend segue o mesmo molde do `QUEUE_MARK_LATE_DOSES`. **Não inventa
infraestrutura nenhuma** — só depende da junção do achado 1.

### 4. `DISCORDÂNCIA REGISTRADA` — CPF, endereço e nascimento não entram agora

O pedido é guardar CPF, endereço, número e data de nascimento *"para afirmar a
segurança"*. **Recomendo separar isso do resto e travar, por quatro motivos
medidos, não por opinião.**

**a) "Afirmar a segurança" não é finalidade.** A LGPD exige finalidade declarada
e minimização. CPF guardado **não prova identidade nenhuma** — ele não é
conferido contra a Receita. Guardar o número dá a *sensação* de rigor sem o
rigor, e o que sobra é passivo.

**b) O repositório é público.** Medido em 08/09/2026: `visibility: PUBLIC`. Isso
não expõe o banco, mas é o termômetro do endurecimento em que o projeto está — e
é a decisão pendente nº 7 do `STATE.md`.

**c) Não há Encarregado de Dados.** Decisão pendente nº 6 do `STATE.md`. Guardar
documento de identificação sem DPO definido é assumir obrigação sem ter quem
responda por ela.

**d) O `docs/lgpd.md` não tem onde isso caber.** Ele cobre a foto de medicamento
e lista as tabelas com dado de saúde. **Não existe seção de base legal nem
inventário de categorias.** Guardar CPF exige criar as duas.

E o próprio [`referencia/EXTENSAO-B2B.md`](../referencia/EXTENSAO-B2B.md) §5 diz
que **"o profissional não é suspeito"**, e a escada de evidência do §4 começa em
registro nominal autenticado — **não em documento**.

**O que sai agora, sem travar nada:** foto, nome completo, telefone, e-mail e
parentesco/função. Tudo isso já está na **#116**. O que trava é só o bloco de
identificação, na **#124**.

### 5. A tensão com a decisão institucional, e como ela é respeitada

O `EXTENSAO-B2B.md` §7 tem recomendação explícita, já aprovada:

> **"não implementar nada disso agora, e não fazer hedge de schema … construir
> estrutura para um cliente que ainda não existe é a forma mais cara de errar."**

E os portões ZELO-43/44 (cliente pagante + parecer jurídico) ocupam as duas
primeiras posições **de propósito**, para que seja impossível escrever a
primeira linha institucional sem eles.

**Nenhuma issue deste refinamento cria entidade "instituição"**, nem a relação
N:N paciente×organização, nem escala, nem turno, nem prova de presença. A junção
cuidador×paciente vive **dentro da família que já existe** e serve o caso B2C do
spec original. Ela passa pelos portões porque **não é hedge institucional: é uma
dívida B2C conhecida e datada**.

### Uma ideia que foi pensada e descartada

"Último acesso" ou "atividade por cuidador" na tela de cuidadores seria fácil e
pareceria útil para uma instituição. **Não entra.** O `EXTENSAO-B2B.md` §5 e §10
são explícitos: o profissional não é suspeito, e o painel do gestor é *"sem
métrica individual"*. Transformar `/cuidadores` em vigilância de trabalhador é
exatamente o produto que aquele documento decidiu não ser.

---

## A decisão de arquitetura que barateia tudo

A fase 11.6, como está descrita, é cara: mudar o modelo de autorização do JWT
(que carrega **um** `role` por sessão) para resolver papel por requisição.

**Recomendação: separar VÍNCULO de AUTORIZAÇÃO.**

| | O que é | Entra agora? |
|---|---|---|
| **Vínculo** | Quem é responsável por quem. Informativo: aparece na tela, alimenta o filtro e o alerta | **Sim — #120** |
| **Autorização** | O papel muda por paciente; o JWT deixa de carregar um `role` único | **Não** — continua a 11.6, adiável |

Isso entrega os pedidos 2 e 3 **sem tocar no modelo de autenticação**, que é a
parte cara e arriscada. Quem tem acesso continua tendo o mesmo acesso de hoje; o
que muda é a tela passar a dizer de quem cada um cuida.

**Consequência que precisa estar escrita:** um cuidador não vinculado a um
paciente **continua enxergando** aquele paciente. O vínculo responde
*"quem é o responsável?"*, não *"quem pode ver?"*. Se isso não bastar, a 11.6
inteira volta à mesa — e aí é mudança de arquitetura, com o custo dela.

---

## As cinco Issues

| # | Tipo | O quê | Depende de |
|---|---|---|---|
| **#120** | Nova função | Vincular cuidador a paciente — a junção que falta | nada |
| **#121** | Melhoria | `/cuidadores` diz quem cuida de quem | #120 |
| **#122** | Melhoria | `/pacientes`: coluna de cuidador e filtro "sem cuidador" | #120 |
| **#123** | Nova função | Alerta por e-mail: paciente descoberto há 2 dias | #120, #122 |
| **#124** | Nova função | Identificação do cuidador — **BLOQUEADA** | 4 pré-condições |

**Onde mora o filtro, já que o fundador deixou a escolha:** em **`/pacientes`**.
A pergunta é *"qual paciente está descoberto?"* — isso é propriedade do
paciente, e o alerta é sobre um paciente. `/cuidadores` responde outra pergunta:
*"quem trabalha aqui"*. Cada tela responde a sua.

**Ordem:** #116 (foto, já aberta) → #120 → #121 → #122 → #123. A #124 fica
parada até as quatro pré-condições caírem.
