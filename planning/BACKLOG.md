# BACKLOG — onde vive e como está estruturado

> Consolidado em 23/08/2026 a partir da memória do agente, que era o único lugar onde isto existia.

## Onde vive

**Plane**, projeto **ZELO**, id `864270aa-59b4-4775-9bda-50fbc3bb8565`.

- **ZELO-1 a ZELO-42** — 42 histórias em 10 módulos-épico (`E0` a `E9`), criadas em 16/08/2026.
- **ZELO-43 a ZELO-55** — **E10, Cuidado Institucional**, adicionado em 18/08/2026: venda B2B para
  ILPI, home care e casa de recuperação, com registro verificado de administração para a família.
  **Hospital foi descartado como nicho.**
- **ZELO-56, ZELO-57, ZELO-58** — criadas depois, a partir de refinamento (planos e acesso do paciente).

No plano gratuito do Plane não existem Epics; **os épicos são Modules**.

## Por que a estrutura difere da spec

A [especificação original](referencia/ESPECIFICACAO.md) tem 8 épicos e 21 histórias. O backlog tem
10+ e 42. As diferenças são deliberadas:

- **E0 — Fundação e Guardrails não existe na spec.** Reúne constituição do projeto, scaffold,
  design system, schema completo do domínio de uma vez, e relógio injetável com time-travel.
  É o épico de maior retorno: schema tardio e relógio real são as duas maiores fontes de
  retrabalho caro.
- **21 histórias viraram 42.** Granularidade menor = escopo verificável por sessão.
- **Toda descrição segue template fixo:** Objetivo / Escopo / Critérios de aceite /
  **NÃO faça nesta story** / Depende de. O bloco "NÃO faça" é o que trava scope creep.
- **As duas primeiras histórias do E10 são `sem-codigo` de propósito** — portão comercial
  (ZELO-43) e portão jurídico (ZELO-44). Combinadas com a regra de ordem numérica estrita, elas
  tornam **impossível começar a codar o institucional sem cliente pagante e parecer jurídico**.

**Labels:** `P0` `P1` `P2` · `backend` `frontend` `infra` · `LGPD` · `coracao-do-produto` · `sem-codigo`.

## Regra de execução

**Ordem numérica estrita.** A próxima história é sempre a de **menor número ainda incompleta** —
e "incompleta" significa qualquer critério de aceite do Plane em aberto, não "o que foi feito
nesta sessão". Se uma história tem ressalva, o próximo passo é fechar a ressalva, não avançar.

A única quebra autorizada dessa regra é pular história bloqueada por fornecedor externo não
decidido (ver abaixo).

## Pesquisa de fornecedores — feita em 18/08/2026

`NÃO VERIFICADO desde 18/08/2026 — preços mudam, reverificar antes de agir.`

**SMS (ZELO-31):**

| Provedor | Preço por SMS (BR) | Observação |
|---|---|---|
| Twilio | ~US$ 0,06–0,075 | + ~US$ 1,15/mês de aluguel de número. Pré-pago, sem mensalidade |
| Zenvia | ~US$ 0,013–0,018 | Pacotes pré-pagos de US$ 20 a US$ 400 |

**Cuidado ao pesquisar a Zenvia:** a página de preços mistura dois produtos. O "Customer Cloud"
(atendimento/CRM) tem mensalidade a partir de ~US$ 130/mês e **não serve** para este caso de uso.
O produto certo é a API de mensagem pura. A diferença de preço para a Twilio é esperada — operadora
local, sem markup internacional.

**PSP de pagamento (ZELO-39):** nenhum avaliado ainda. Candidatos citados: Stripe, Mercado Pago,
Pagar.me. Exige conta própria, KYC e credenciais — provisionamento é do fundador.

**Decisão em vigor:** todos os fornecedores externos pagos (SMS, ligação automática do Épico 9,
PSP) ficam para **decisão em lote no fim do projeto**. Ao chegar numa história bloqueada por isso,
**pule sem perguntar de novo** — a confirmação já foi dada duas vezes (18 e 19/08/2026).
Uma pergunta pontual é aceitável só na primeira vez que um tipo **novo** de dependência aparecer.
