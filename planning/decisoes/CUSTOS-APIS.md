# Custo mensal das APIs pagas

> Levantado em **24/08/2026**, a pedido do fundador, antes de contratar qualquer fornecedor.
> **Serve a dois leitores:** o fundador, para decidir; e o eventual comprador, para entender que a
> análise foi feita com número e que o adiamento do SMS foi escolha consciente — ver
> [PLATFORM_DECISIONS.md](PLATFORM_DECISIONS.md) §12.
> Preços buscados nas páginas oficiais na data, não de memória. O que não pôde ser verificado
> está rotulado.

## A conclusão, antes dos números

**Só o SMS importa.** Tudo o mais junto — leitura de receita por IA, Google Maps, e-mail, push —
custa **menos de US$ 4 por mês até mil pacientes**. O SMS sozinho pode custar **centenas**.

E a segunda conclusão, que reabre uma decisão do backlog: **o Google Maps sairia de graça** no
volume previsível deste produto. A camada gratuita cobre folgadamente o uso real.

> **Ampliado em 25/08/2026**, a pedido do fundador: a versão original olhava só APIs. Agora inclui
> **hospedagem no Replit, armazenamento de mídia e taxas das lojas**, com o custo em três tamanhos
> de base — ver [Custo durante o crescimento](#custo-durante-o-crescimento).
>
> **E uma correção no meio do caminho:** a primeira versão da tabela de crescimento **esqueceu o
> compute do banco de produção**, que é a maior linha de todas — US$ 116,80/mês, praticamente fixa,
> porque o pg-boss mantém o Postgres acordado 24/7. Com ela, o custo real vai de **~US$ 158 (100
> famílias) a ~US$ 397 (10 mil)**, não de US$ 40 a US$ 250.
>
> O SMS continua sendo o único item capaz de mudar isso de patamar.

---

## Preços verificados em 24/08/2026

| Serviço | Preço | Situação |
|---|---|---|
| **Claude Haiku 4.5** (leitura de receita) | US$ 1,00 entrada / US$ 5,00 saída por milhão de tokens | ✅ verificado |
| **Twilio SMS Brasil** | US$ 0,0599 por SMS + US$ 1,15/mês pelo número | ✅ verificado |
| **Zenvia SMS Brasil** | ~US$ 0,013–0,018 por SMS | ⚠️ `NÃO VERIFICADO` desde 18/08/2026 |
| **Places Autocomplete — por sessão** | **grátis, ilimitado** | ✅ verificado |
| **Places Autocomplete — por requisição** | US$ 2,83/mil, após 10 mil grátis/mês | ✅ verificado |
| **Place Details** | US$ 5,00/mil, após 10 mil grátis/mês | ✅ verificado |
| **Dynamic Maps** (mapa na tela) | US$ 7,00/mil, após 10 mil grátis/mês | ✅ verificado |
| **Stripe — cartão nacional** | 3,99% + R$ 0,39 | ✅ verificado |
| **Stripe — Pix** | 1,19% (só por convite) | ✅ verificado |
| **Stripe Billing** (assinatura recorrente) | +0,7% do volume | ✅ verificado |
| **Resend** (e-mail) | grátis até 3.000/mês e 100/dia | ✅ verificado |
| **Web Push (VAPID)** | **grátis** — é padrão do navegador, não serviço | ✅ |

---

## Premissas de uso

Por paciente, por mês: **270 lembretes de dose** (3 medicamentos × 3 doses × 30 dias),
**2 consultas** agendadas, **1 leitura de receita** por foto depois do cadastro inicial.

A variável que decide tudo é **quantos lembretes acabam virando SMS** — o SMS é o *fallback* de
quando o push não confirma entrega (ZELO-31). Modelei duas taxas: **5%** (otimista) e **15%**
(pessimista, provável se a entrega no iOS for ruim — que é justamente o cenário que motivou a
existência da história).

---

## Custo mensal por cenário, em USD

| Pacientes | Taxa de SMS | SMS/mês | Twilio | Zenvia | Anthropic | Maps |
|---|---|---|---|---|---|---|
| 10 | 5% | 135 | **$9,24** | $2,09 | $0,04 | $0,00 |
| 10 | 15% | 405 | **$25,41** | $6,28 | $0,04 | $0,00 |
| 50 | 5% | 675 | **$41,58** | $10,46 | $0,18 | $0,00 |
| 50 | 15% | 2.025 | **$122,45** | $31,39 | $0,18 | $0,00 |
| 200 | 5% | 2.700 | **$162,88** | $41,85 | $0,70 | $0,00 |
| 200 | 15% | 8.100 | **$486,34** | $125,55 | $0,70 | $0,00 |
| 1.000 | 5% | 13.500 | **$809,80** | $209,25 | $3,50 | $0,00 |
| 1.000 | 15% | 40.500 | **$2.427,10** | $627,75 | $3,50 | $0,00 |

---

## O que isso significa para o preço da assinatura

`RISCO DE MARGEM CONFIRMADO.`

Com **200 pacientes e 15% de SMS na Twilio**, o custo é **US$ 2,43 por paciente/mês só de SMS**.
Se a assinatura for R$ 29,90, isso consome perto de **metade da receita bruta** — antes de
hospedagem, antes de imposto, antes de qualquer outra coisa.

Com a **Zenvia na mesma taxa**, cai para US$ 0,63 por paciente — cerca de **11% da receita**.
Com 5% de SMS na Zenvia, ~4%.

**A escolha de fornecedor de SMS é uma decisão de modelo de negócio, não de tecnologia.**
A diferença entre Twilio e Zenvia é de ~4× no custo unitário, e é ela que define se a margem existe.

### Custo do PSP por assinatura de R$ 29,90 — comparação de 25/08/2026

Os três fornecedores, sobre o mesmo ticket:

| Fornecedor | Cartão | Pix | Cartão em R$ 29,90 | Pix em R$ 29,90 |
|---|---|---|---|---|
| **Stripe** | 3,99% + R$ 0,39 **+ 0,7%** (Billing) | 1,19% + 0,7% — **só por convite** | R$ 1,79 — 6,0% | R$ 0,57 — 1,9% |
| **Mercado Pago** (receber em 30 dias) | 3,99%, sem taxa fixa e sem adicional de assinatura | **0%** para a maioria dos vendedores | **R$ 1,19 — 4,0%** | **R$ 0,00** |
| **Pagar.me (Stone)** | não publica preço | não publica preço | — | — |

**O que decide, e não é a diferença no cartão:**

1. **A taxa fixa da Stripe machuca desproporcionalmente num ticket baixo.** R$ 0,39 sozinho é 1,3%
   de R$ 29,90. Numa assinatura barata, taxa fixa pesa mais que ponto percentual.
2. **A Stripe cobra 0,7% a mais só por ser assinatura** (add-on do Billing). O Mercado Pago não
   tem esse adicional — a recorrência está incluída.
3. **O Pix do Mercado Pago é gratuito na escala do ZELO**; o da Stripe custa R$ 0,57 **e é por
   convite**, ou seja, pode simplesmente não estar disponível.

Prazos do Mercado Pago no cartão: **3,99% recebendo em 30 dias**, 4,49% em 14 dias, 4,99% na hora.
Assinatura não precisa de dinheiro na hora — o prazo de 30 dias é o certo, e é o mais barato.

**Pagar.me está fora por enquanto:** exige **CNPJ ou MEI ativo** e **não publica preço** — só por
contato comercial. Fornecedor cujo preço só se descobre negociando é o errado para começar.

#### A pergunta que decide, e ainda não tem resposta

`NÃO VERIFICADO — RISCO ALTO`

A documentação de assinaturas do Mercado Pago lista Pix entre os meios aceitos, mas **não menciona
"Pix Automático" pelo nome**. Se a cobrança recorrente por Pix exigir que a pessoa aprove todo mês,
a vantagem do "Pix de graça" **evapora na prática** — vira atrito mensal, e atrito mensal em
assinatura é cancelamento.

**Confirmar isso antes de escrever a primeira linha da QUI-12.** É a única coisa que pode inverter
a recomendação.

Outros pontos não verificados, que valem confirmar no cadastro:

| Ponto | Estado |
|---|---|
| Stripe Brasil exige CNPJ | `NÃO VERIFICADO` |
| Mercado Pago aceita CPF (vendedor pessoa física) | `NÃO VERIFICADO` |
| Condições do Pix 0% do Mercado Pago por tipo de conta | `NÃO VERIFICADO` — a fonte cita 0,49% para CNPJ novo acima de R$ 15 mil/mês |

#### Desenhar para poder trocar

Independente da escolha, a QUI-12 deve manter o PSP **atrás de uma interface fina** — criar
assinatura, cancelar, tratar webhook. O resto do app não deve saber o nome do fornecedor.

Dois motivos concretos: o Pix Automático pode obrigar a trocar, e **um comprador internacional
provavelmente vai querer Stripe** — o Mercado Pago é só Brasil. Com o adaptador, trocar é um dia de
trabalho; sem ele, é reescrever a cobrança inteira.

**Fontes:** [Stripe Brasil — preços](https://stripe.com/br/pricing),
[Mercado Pago — assinaturas (docs)](https://www.mercadopago.com.br/developers/pt/docs/subscriptions/landing),
[Mercado Pago — custo do Pix](https://www.mercadopago.com.br/ajuda/qual-o-custo-de-um-pix_21723),
[Mercado Pago — quanto custa vender online](https://www.mercadopago.com.br/blog/quanto-custa-vender-on-line-com-mercado-pago),
[Pagar.me — preços](https://www.pagar.me/precos).

---

## Como ler "US$ 5,00/mil" — pergunta do fundador em 25/08/2026

**É por MIL requisições, não por requisição.** A barra quer dizer "por mil".

> *"Depois de 10 mil places autocomplete, place details e dynamic maps eu pago de 2 a 7 mil
> dólares para usar?"*

Não. A conta real, no Place Details:

| Requisições no mês | Cobradas (as 10 mil primeiras são grátis) | Custo |
|---|---|---|
| 10.000 | 0 | **US$ 0,00** |
| 11.000 | 1.000 | **US$ 5,00** |
| 20.000 | 10.000 | **US$ 50,00** |
| 110.000 | 100.000 | **US$ 500,00** |

Para chegar aos **US$ 2.830** que a leitura sugeria, seriam necessárias cerca de **576 mil**
requisições de Place Details num mês — o que, nas premissas deste produto (2 consultas por família
por mês), significa **~288 mil famílias**. Não é o risco deste projeto.

---

## Todos os recursos pagos — a lista completa

Separados pelo que muda a decisão: **o que já é necessário** e **o que só existe se algo acontecer
antes**.

### Necessários hoje

| # | Recurso | Para quê | Cobrança | Já contratado? |
|---|---|---|---|---|
| 1 | **Replit** (plano + publicação) | hospedar a API e o app | assinatura + uso | sim, o app vive lá |
| 2 | **Postgres do Replit** | o banco inteiro | compute + armazenamento | sim (produção pausada) |
| 3 | **Object Storage do Replit** | fotos, vídeos e áudios dos Momentos (QUI-5) | por GB | **provisionado e ocioso** — nunca usado até 25/08/2026 |
| 4 | **Anthropic (Claude Haiku 4.5)** | ler a receita por foto e pré-preencher o cadastro | por token | sim |
| 5 | **Google Maps** | campo "Local" da consulta: buscar endereço e mostrar o mapa | por requisição, com 10 mil grátis por SKU/mês | sim — R$ 150 de pré-pagamento já feitos |
| 6 | **Resend** | e-mail de verificação, convite e recuperação de senha | por volume, 3 mil/mês grátis | **não** — bloqueado pela escolha de domínio |
| 7 | **Domínio `.com.br`** | endereço do produto **e** pré-requisito do e-mail | ~R$ 40–60/ano | **não** |
| 8 | **PSP** (Mercado Pago recomendado) | cobrar a assinatura | % sobre o que entra | **não** — QUI-12 |

### Só se algo acontecer antes

| # | Recurso | Depende de | Custo |
|---|---|---|---|
| 9 | **Google Play** | QUI-13 (app nativo) | **US$ 25, uma vez só** |
| 10 | **Apple Developer** | QUI-13 (app nativo) | **US$ 99/ano**; conta de organização exige D-U-N-S |
| 11 | **SMS** (Zenvia recomendada) | decisão de retomar — hoje é trabalho do comprador | por mensagem |
| 12 | **Ligação automática** | ZELO-41, fora do v1 | por minuto, bem mais caro que SMS |

**Grátis para sempre, e não é promoção:** o **Web Push (VAPID)** é padrão do navegador. Não há
fornecedor, não há conta, não há fatura. E é o canal principal de lembrete do produto.

---

## Para que exatamente o SMS seria usado

Duas coisas diferentes, que o backlog separou de propósito:

**1. Rede de segurança quando o push não confirma entrega** (ZELO-31, fase 06).
O produto manda o lembrete por push. Se o aparelho está desligado, sem rede, ou a permissão foi
revogada, o push **não chega e ninguém fica sabendo**. A cascata desenhada é:
push → push repetido → **SMS** → escalonar para outro cuidador.

**2. Alcançar um paciente que não tem smartphone** (ZELO-41, fase 10).
Parte do público deste app usa aparelho básico. Para essa pessoa, push simplesmente não existe —
SMS é o único canal que chega.

### Por que ele foi adiado, e por que isso está certo

**Ele é o único item que ameaça a margem.** Nas premissas deste documento, com **10 mil famílias**
e 5% dos lembretes virando SMS:

| Fornecedor | SMS/mês | Custo mensal |
|---|---|---|
| Twilio (US$ 0,0599) | 45.000 | **US$ 2.695** |
| Zenvia (~US$ 0,015) | 45.000 | **US$ 675** |

**Os "milhares de dólares" existem — só que no SMS, não no Google Maps.** É por isso que a decisão
de 24/08/2026 tirou ZELO-31 e ZELO-41 do v1 e os deixou como trabalho do comprador: quem comprar
decide se o canal vale a margem, com dado de entrega real na mão.

**Antes de ligar SMS, medir push.** O painel operacional (REQ-027) mede a taxa de entrega real. Se
o push entrega bem, o SMS quase não dispara e o custo é irrelevante. Ligar SMS sem essa medição é
comprar o pior cenário sem saber se ele existe.

---

## Custo durante o crescimento

`MODELO — as premissas são minhas; os preços unitários são verificados.`

**Premissas por família, por mês** (1 paciente, sem SMS):

| | Quanto | Por quê |
|---|---|---|
| Consultas com endereço | 2 | 2 Place Details + 2 carregamentos de mapa |
| Leitura de receita por foto | 1 | só quando muda tratamento |
| E-mail transacional | 0,5 | cadastro e convite são quase só no início |
| Momentos enviados | 30 fotos × ~300 KB = **9 MB** | já com a compressão no aparelho da QUI-7 |
| Momentos armazenados | **~27 MB** | 9 MB/mês × retenção de 90 dias |
| Momentos vistos | **~27 MB** de saída | cada foto vista ~3 vezes |

### Preços de nuvem do Replit — verificados em 25/08/2026

Vieram da tabela de atualização de preços de agosto de 2026, que é a que vale hoje.

| Item | Preço |
|---|---|
| **Banco — compute** | **US$ 0,16 por hora ativa** |
| **Banco — armazenamento** | US$ 0,35 por GiB/mês *(caiu de US$ 1,50)* |
| **App Storage — armazenamento** | US$ 0,015 por GiB/mês *(caiu de US$ 0,03)* |
| **App Storage — saída de dados** | US$ 0,05 por GiB *(caiu de US$ 0,10)* |
| **App Storage — operações básicas** (leitura) | US$ 0,0004 por mil |
| **App Storage — operações avançadas** (escrita) | US$ 0,005 por mil |
| **Reserved VM 0,5 vCPU / 2 GiB** | US$ 0,0208/h → **US$ 15,18/mês** |
| **Reserved VM 1 vCPU / 4 GiB** | US$ 0,0486/h → **US$ 35,48/mês** |
| **Reserved VM dedicada 2 vCPU / 8 GiB** | US$ 0,0694/h → **US$ 50,66/mês** |

Cada objeto guardado tem **período mínimo de cobrança de 7 dias** — irrelevante para a retenção de
90 dias dos Momentos, mas registrado.

### CORREÇÃO — o compute do banco é a maior linha, e eu tinha omitido

`ERRO MEU, corrigido em 25/08/2026.`

A primeira versão desta seção somava ~US$ 40 / US$ 64 / US$ 250 e **não incluía o compute do banco
de produção**. Com o preço verificado, ele sozinho é **US$ 116,80 por mês** — 730 horas × US$ 0,16.

**E ele não escala com o número de famílias: é praticamente fixo.** O banco só para de ser cobrado
depois de **5 minutos sem nenhuma consulta**, e neste app isso nunca acontece: o **pg-boss é uma
fila dentro do próprio Postgres** e consulta o banco continuamente para disparar lembrete de dose
na hora certa. O banco fica acordado 24/7 por desenho do produto.

**Isso explica um fato que já estava registrado e sem causa.** O `STATE.md` diz que o banco de
produção "está pausado por limite de gasto (teto de US$ 1 atingido)". A US$ 0,16/h, **US$ 1 dura
6 horas e 15 minutos** — bate com o que aconteceu. O teto não foi atingido por uso anormal; foi
atingido porque o teto era baixo demais para um banco que fica acordado.

### O que se paga em cada tamanho

| | **100 famílias** | **1.000 famílias** | **10.000 famílias** |
|---|---|---|---|
| **Banco — compute** (730 h) | **$116,80** | **$116,80** | **$116,80** |
| Banco — armazenamento | $0,35 (~1 GiB) | $1,05 (~3 GiB) | $10,50 (~30 GiB) |
| Replit — plano Core | $25,00 | $25,00 | $25,00 |
| Replit — publicação (Reserved VM) | $15,18 (0,5 vCPU) | $35,48 (1 vCPU) | $50,66 (2 vCPU) |
| Google Maps | **$0** (dentro dos 10 mil) | **$0** (dentro dos 10 mil) | $120,00 |
| Anthropic (Haiku) | $0,35 | $3,50 | $35,00 |
| Resend | **$0** (dentro dos 3 mil) | **$0** | $20,00 (Pro) |
| App Storage (Momentos) | $0,19 | $1,91 | $19,06 |
| Web Push | $0 | $0 | $0 |
| **Total** | **~US$ 158** | **~US$ 184** | **~US$ 397** |

> `NÃO VERIFICADO`: há indício de que o plano Core inclua **100 horas de compute e 3 GiB** de banco
> por mês, o que derrubaria ~US$ 16 de cada linha. Não achei essa franquia escrita em página
> oficial, então a tabela cobra tudo — se estiver errada, é para menos.

### O que a conta dos Momentos revela

O App Storage é barato, mas **a maior parte não é guardar: é entregar.** Em 10 mil famílias:

| | Valor |
|---|---|
| Guardar ~264 GiB | $3,96 |
| **Entregar ~264 GiB** | **$13,20** — 69% do total |
| Escritas (300 mil) | $1,50 |
| Leituras (1 milhão) | $0,40 |

Duas consequências práticas:

1. **A retenção de 90 dias economiza no lugar menor.** Ela corta armazenamento, não entrega. O
   motivo dela continua sendo a LGPD, não o custo — e agora com número para provar.
2. **O cache curto de 10 minutos que a QUI-5 implementou custa dinheiro, e vale a pena.** Cache
   longo cortaria parte dos US$ 13,20, mas serviria do navegador uma foto que o consentimento já
   revogou — é exatamente o que a QUI-6 existe para impedir. **US$ 13/mês é preço baixo por isso.**

**Sensibilidade a vídeo (QUI-9):** um vídeo de 30 s comprimido é ~5 MB, contra ~300 KB de uma foto —
**16 vezes mais**. Se 10% dos momentos virarem vídeo, a saída de dados quase triplica: os US$ 13,20
viram ~US$ 34. Continua pequeno, mas é o único item cujo custo pode disparar com uma mudança de
comportamento do usuário. Vale medir depois que a QUI-9 entrar.

**Onde o Maps começa a custar:** só a partir de ~5 mil famílias, porque cada família consome
2 requisições de cada SKU e a franquia é de 10 mil por SKU. Em 10 mil famílias são US$ 50 de
Place Details + US$ 70 de mapa. **Tirar o mapa da tela corta US$ 70 dos US$ 120** — o endereço em
texto já resolve o caso de uso, e o mapa é enfeite.

### O que isso significa

Com 10 mil famílias e **5% pagando** R$ 29,90, a receita bruta é ~R$ 14.950/mês (~US$ 2.700).
Os ~US$ 397 de infraestrutura são cerca de **15% disso** — mais a taxa do PSP, que é proporcional
à receita, não à base.

**O ponto de virada é cedo, e é o que importa saber.** Com o banco custando ~US$ 117 fixos, o
produto precisa de aproximadamente **8 assinantes pagantes** só para cobrir infraestrutura. Isso é
pouco — mas é diferente de "custa quase nada até mil famílias", que era o que a versão anterior
deste documento dava a entender.

**Infraestrutura ainda não é o risco deste negócio.** Conversão é. E SMS seria, se fosse ligado.

**Fontes:** [Replit — atualização de preços de agosto/2026](https://docs.replit.com/billing/aug-cloud-billing-updates),
[Replit — App Storage Billing](https://docs.replit.com/billing/object-storage-billing),
[Replit — preços de publicação](https://docs.replit.com/billing/deployment-pricing),
[Replit — bancos de produção](https://docs.replit.com/cloud-services/storage-and-databases/production-databases).

---

## Lojas de aplicativo

**Hoje o custo é zero, e isso é decisão de plataforma, não sorte.** O ZELO é PWA: instala pelo
navegador, sem loja, sem comissão de 15 a 30%, e a assinatura acontece na web.

Quando a QUI-13 (app nativo) for destravada pelo gatilho medido:

| Loja | Custo | Observação |
|---|---|---|
| **Google Play** | **US$ 25, uma vez só** | taxa de registro, não recorrente |
| **Apple App Store** | **US$ 99/ano** | recorrente; conta de organização exige número D-U-N-S |

São valores pequenos. **O custo real de estar nas lojas não é a taxa — é a comissão sobre a
assinatura**, e a QUI-13 diz explicitamente para manter a cobrança na web justamente por isso.

**Fontes desta seção:** [Replit — preços de publicação](https://docs.replit.com/billing/deployment-pricing),
[Replit — preços](https://replit.com/pricing),
[Resend — preços](https://resend.com/pricing),
[Google Play — taxa de registro](https://support.google.com/googleplay/android-developer/answer/6112435),
[Apple Developer Program](https://developer.apple.com/support/enrollment/).

---

## O que NÃO precisa ser pago

- **Google Maps** — a camada gratuita é de **10 mil chamadas por SKU por mês**, e o Autocomplete
  *por sessão* é gratuito e ilimitado. Com 2 consultas por paciente/mês, seriam necessários
  **~5.000 pacientes** para começar a pagar.

  ⚠️ **CORREÇÃO de 24/08/2026 — eu tinha omitido uma barreira de entrada.** A versão original
  deste documento dizia apenas que o Google exige "cartão cadastrado". Está incompleto: no
  Brasil, o Google Cloud exige um **pré-pagamento único de R$ 150,00** antes de ativar o
  faturamento. O valor **não é taxa** — vira saldo na conta, é consumido pelo uso e é
  reembolsado ao encerrar a conta de faturamento. Ainda assim é dinheiro parado e uma
  barreira real, e eu deveria ter verificado antes de recomendar.

  **Alternativa gratuita, verificada em 24/08/2026:** o **ViaCEP** (`viacep.com.br`) é o
  serviço público de CEP do Brasil — gratuito, **sem chave, sem cadastro e sem cartão**,
  ~1,6 milhão de CEPs, devolve rua, bairro, cidade e estado em JSON. O mapa visual pode vir do
  **OpenStreetMap**, também sem chave. Cobre o pedido original ("digitei o CEP e o campo me
  retorna o endereço") por R$ 0,00.

  O que só o Google faz: buscar pelo **nome** do estabelecimento ("Hospital Albert Einstein")
  e endereços fora do Brasil. Para este produto, o cuidador costuma ter o endereço em mãos.

  Restrição do ViaCEP, do próprio site: proíbe uso massivo para validar bases locais, e proíbe
  redistribuição comercial dos dados. Uma consulta por consulta agendada não se encaixa em
  nenhuma das duas.
- **Leitura de receita por IA** — US$ 3,50/mês com mil pacientes. Irrelevante.
- **E-mail** — o plano gratuito do Resend (3.000/mês) cobre milhares de famílias, já que só há
  e-mail transacional: verificação, recuperação de senha e convite.
- **Push** — VAPID é padrão do navegador. Custo zero, para sempre.

---

## O que ficou fora desta conta

| Item | Por quê |
|---|---|
| **Hospedagem (Replit)** | Já é custo fixo existente. `NÃO VERIFICADO`: o banco de produção foi congelado num teto de US$ 1, então o custo real de banco + deploy em escala **nunca foi medido** |
| **Ligação automática** (Épico 9) | Voz custa por minuto e é bem mais cara que SMS. Só faz sentido estimar quando a história for retomada |
| **Domínio** | ~R$ 40–60/ano num `.com.br`. Irrelevante no total, mas **bloqueia o e-mail** (o provedor exige domínio verificado), que por sua vez bloqueia o cadastro |
| ~~**Mercado Pago / Pagar.me**~~ | Pesquisados em 25/08/2026 — ver a comparação acima |

---

## Recomendação

1. **A escolha de SMS passou a ser do comprador** (decisão de 24/08/2026: ZELO-31 e ZELO-41 saíram
   do v1). Quando for retomada, **a Zenvia é a recomendação, não a Twilio** — a diferença de ~4× é o que
   separa margem de prejuízo. Confirmar o preço antes: a pesquisa é de 18/08.
2. **Reduzir a taxa de SMS por desenho**, não só por preço. Cada ponto percentual a menos vale
   mais que qualquer negociação. Vale **medir a entrega real de push antes de ligar o SMS** — e o
   painel que mede isso (REQ-027) depende do `ADMIN_PANEL_SECRET`, que o fundador informou já
   estar configurado no Replit em 25/08/2026 — `NÃO VERIFICADO` por mim, falta abrir `/admin` e
   confirmar que entra.
3. **Endereço: Google Maps — decidido em 24/08/2026.** O fundador ativou o faturamento e pagou o
   pré-pagamento de R$ 150, que virou saldo na conta (custo consumido até agora: R$ 0,00).
   Recomendado criar alerta de orçamento de R$ 10 para não descobrir surpresa na fatura.
   **O ViaCEP fica registrado como alternativa** para o caso de o comprador não querer herdar a
   conta de faturamento do Google: cobre o mesmo caso de uso (CEP → endereço) por R$ 0,00,
   perdendo só a busca por nome do estabelecimento.

   ~~Preferir ViaCEP ao Google Maps.~~ O custo recorrente dos dois é zero,
   mas o Google exige R$ 150 de pré-pagamento no Brasil e uma conta de faturamento que teria de
   ser transferida ao comprador. O ViaCEP não exige nada.
4. **PSP: Mercado Pago é a recomendação**, com uma condição. Ele é mais barato no cartão
   (4,0% contra 6,0%) e o Pix sai de graça, enquanto o da Stripe custa R$ 0,57 e depende de convite.
   **A condição:** confirmar se a assinatura por Pix cobra sozinha todo mês (Pix Automático). Se
   não cobrar, a vantagem some e a Stripe volta a ser a escolha. Em qualquer caso, **priorizar Pix
   na tela** e manter o fornecedor atrás de um adaptador, para poder trocar.
5. **Definir o domínio** — ele bloqueia o e-mail, que bloqueia o cadastro (fase 11.1b).

> Conversões para real dependem do câmbio do dia, que **não verifiquei**. Os valores estão em USD
> de propósito.
