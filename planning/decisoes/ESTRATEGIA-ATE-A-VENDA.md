# Estratégia de ambiente até a venda

> Escrito em **25/08/2026**, a partir de uma proposta do fundador. O objetivo declarado do projeto
> é **vender o produto para uma empresa compradora** — este documento decide em que ambiente ele
> vive até lá, e por quê.
>
> Números em dólar **e** em real, a R$ 5,45/US$ (spot de R$ 5,14 + IOF de 3,5% + spread).
> Base de preços: [CUSTOS-APIS.md](CUSTOS-APIS.md).

## A proposta do fundador

> *"Pagar o banco - compute no momento é inviável para o meu orçamento. Acredito que a solução
> seria apresentar o serviço em dev para uma empresa compradora, não subir isso para produção por
> causa dos custos. Caso a empresa se interesse eu passo todos os custos possíveis de acordo com o
> crescimento do app."*

**O instinto está certo, e a premissa está errada por um detalhe que muda tudo.**

## A premissa errada: produção não é assinatura, é hora

O banco de produção custa **US$ 0,16 por hora ativa**. Os US$ 116,80/mês só aparecem se ele ficar
ligado o mês inteiro. **Ligar por alguns dias custa alguns dólares.**

| Janela de produção | Banco | + VM (0,5 vCPU) | Total |
|---|---|---|---|
| **3 dias** (demonstração) | US$ 11,52 | US$ 1,50 | **US$ 13** · **R$ 71** |
| **1 semana** (avaliação técnica do comprador) | US$ 26,88 | US$ 3,49 | **US$ 30** · **R$ 165** |
| **30 dias** (piloto com famílias reais) | US$ 116,80 | US$ 15,18 | **US$ 132** · **R$ 719** |

Ou seja: **o fundador não precisa escolher entre "dev para sempre" e "R$ 637 por mês".** Existe um
meio-termo de R$ 71 a R$ 165 por janela, que é o que uma venda realmente exige.

## Por que o banco não consegue dormir — e por que não adianta otimizar

O banco de produção do Replit entra em estado ocioso (e para de cobrar) depois de **5 minutos sem
nenhuma consulta**. Neste app isso nunca acontece, por três motivos somados:

| Causa | Frequência | Verificado em |
|---|---|---|
| **pg-boss consulta a fila continuamente** (padrão: a cada 2 s) | contínua | `lib/queue.ts:72` — construtor sem `pollingIntervalSeconds` |
| Monitor operacional (REQ-027) | a cada **2 min** | `lib/queue.ts:141` |
| Marcar doses atrasadas | a cada **15 min** | `lib/queue.ts:139` |

**Só o pg-boss já basta.** Ele é uma fila *dentro do próprio Postgres* — escolha deliberada da
ZELO-18, que é o que permite gravar a dose e enfileirar o lembrete **na mesma transação**, sem que
os dois possam divergir.

`HIPÓTESE DESCARTADA:` cheguei a considerar aumentar o intervalo dos crons para deixar o banco
dormir. **Não funciona.** Mesmo desligando os dois crons, o polling do pg-boss mantém o banco
acordado; e aumentar o polling atrasaria o lembrete de dose, que é a única coisa que o produto não
pode errar. **O custo é estrutural, não desperdício.** Mudar isso seria trocar a arquitetura da
fila — trabalho grande, para economizar num ambiente que quase não vai ficar ligado.

## Três modos, e quando usar cada um

### Modo 1 — Desenvolvimento (o padrão, e o de hoje)

**Custo: só o plano Core, US$ 25/mês · R$ 136.** O banco de desenvolvimento do Replit é gratuito.

Serve para: construir, rodar teste, e demonstrar o produto **ao vivo, com alguém junto**.

**O que ele NÃO consegue provar, e isto precisa estar claro:**

1. **Lembrete que dispara sozinho no dia seguinte.** O ambiente de desenvolvimento não fica de pé
   quando ninguém está com ele aberto. O produto inteiro existe para que a notificação chegue às
   8h — e essa é justamente a parte que uma demonstração em dev **não** demonstra.
2. **A taxa de entrega real de notificação (REQ-027).** Ela só existe com gente de verdade, em
   aparelho de verdade, ao longo de dias. Sem ela, três perguntas ficam sem resposta:
   se o push é confiável, se vale ligar SMS, e se o app nativo é necessário (QUI-13).

### Modo 2 — Produção por janela (a peça que faltava)

**Custo: R$ 71 por 3 dias, R$ 165 por semana.**

Liga-se a produção quando há um comprador avaliando, e desliga-se depois. É o que permite entregar
**um link que funciona sozinho**, sem o fundador presente — que é como um avaliador técnico
realmente testa.

### Modo 3 — Piloto real (só quando houver interessado concreto)

**Custo: R$ 719 por mês, e não deveria durar mais que um.**

10 a 20 famílias reais por 30 dias. **É a única forma de produzir a taxa de entrega.** É o gasto
mais caro da lista e, provavelmente, o que mais aumenta o valor de venda — porque troca
*"achamos que funciona"* por um número medido.

**Não fazer isso agora.** Fazer quando houver conversa avançada com um comprador, e apresentá-lo
como parte da negociação.

## O que entregar ao comprador em vez de um ambiente ligado

Um comprador técnico não avalia só a tela. O que já existe neste repositório e vale mais que um
servidor de pé:

| Artefato | O que ele responde |
|---|---|
| [CUSTOS-APIS.md](CUSTOS-APIS.md) | quanto custa operar em 100, mil e 10 mil famílias, com fonte |
| [PLATFORM_DECISIONS.md](PLATFORM_DECISIONS.md) | o que foi decidido e o que foi descartado, com motivo |
| [referencia/EXTENSAO-B2B.md](referencia/EXTENSAO-B2B.md) | a análise da venda institucional, sem ter construído |
| Suíte de 432 testes | que o comportamento é verificado, não prometido |
| [HISTORIAS.md](HISTORIAS.md) | o que cada uma das 42 histórias entregou |

**Dizer "não subimos para produção porque medimos o custo e decidimos esperar" é mais forte que
subir e não saber explicar a fatura.** Vira sinal de disciplina, não de falta de recurso — desde
que venha acompanhado do número, que é o que este documento existe para dar.

## Recomendação

1. **Continuar em desenvolvimento como padrão.** R$ 136/mês, e é o que já se paga.
2. **Manter a produção pronta para subir**, com o roteiro já escrito em
   [runbooks/banco-de-producao.md](runbooks/banco-de-producao.md), e **um teto de gasto realista**
   — o teto de US$ 1 que pausou o banco corresponde a **6 horas e 15 minutos** de operação normal.
   Para uma janela de uma semana, o teto precisa ser de ~US$ 40.
3. **Ligar produção por janela** quando houver comprador avaliando: R$ 71 a R$ 165.
4. **Piloto de 30 dias só com interessado concreto**, e vendido como parte da negociação.
5. **Ser explícito na apresentação** sobre o que ainda não foi medido. A honestidade sobre a taxa
   de entrega ausente é mais convincente que um silêncio que o comprador vai descobrir sozinho.
