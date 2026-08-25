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
