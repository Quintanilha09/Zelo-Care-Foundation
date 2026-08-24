# Custo mensal das APIs pagas

> Levantado em **24/08/2026**, a pedido do fundador, antes de contratar qualquer fornecedor.
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

### Custo do PSP por assinatura de R$ 29,90

| Meio | Taxa efetiva | Custo | Líquido |
|---|---|---|---|
| Cartão (3,99% + R$ 0,39 + 0,7%) | 6,0% | R$ 1,79 | R$ 28,11 |
| Pix (1,19% + 0,7%) | 1,9% | R$ 0,57 | R$ 29,33 |

O Pix custa **um terço** do cartão. Vale priorizá-lo na tela de assinatura — mas o Pix da Stripe é
**por convite**, o que pode empurrar a decisão para Mercado Pago ou Pagar.me, onde o Pix é padrão.
`NÃO VERIFICADO`: não busquei os preços desses dois.

---

## O que NÃO precisa ser pago

- **Google Maps** — a camada gratuita é de **10 mil chamadas por SKU por mês**, e o Autocomplete
  *por sessão* é gratuito e ilimitado. Com 2 consultas por paciente/mês, seriam necessários
  **~5.000 pacientes** para começar a pagar. **Isso reabre o item 12-12 do backlog**: o campo de
  endereço com mapa custaria zero por muito tempo. O que ele exige é **conta no Google Cloud com
  cartão cadastrado** — cobrança só existe acima da cota, mas o cartão é obrigatório.
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
| **Mercado Pago / Pagar.me** | `NÃO VERIFICADO` — não busquei. Provavelmente melhores que a Stripe para Pix no Brasil |

---

## Recomendação

1. **Escolher a Zenvia, não a Twilio**, quando o SMS for retomado — a diferença de ~4× é o que
   separa margem de prejuízo. Confirmar o preço antes: a pesquisa é de 18/08.
2. **Reduzir a taxa de SMS por desenho**, não só por preço. Cada ponto percentual a menos vale
   mais que qualquer negociação. Vale **medir a entrega real de push antes de ligar o SMS** — e o
   painel que mede isso (REQ-027) está inacessível hoje por falta do `ADMIN_PANEL_SECRET`.
3. **Reabrir o Google Maps** (item 12-12): o custo é zero na prática. A pergunta vira "quer
   cadastrar cartão no Google Cloud?", não "quanto vai custar".
4. **Priorizar Pix** na assinatura: um terço do custo do cartão.
5. **Definir o domínio** — ele bloqueia o e-mail, que bloqueia o cadastro (fase 11.1b).

> Conversões para real dependem do câmbio do dia, que **não verifiquei**. Os valores estão em USD
> de propósito.
