# BACKLOG — onde vive e como está estruturado

> Consolidado em 23/08/2026 a partir da memória do agente, que era o único lugar onde isto existia.

## Mudança de ferramenta — 24/08/2026: Plane → Linear

**O backlog sai do Plane e passa a viver no Linear.** Decisão do fundador.

O histórico abaixo descreve o Plane e continua valendo como registro do que foi construído —
as 41 histórias concluídas contam a história do produto. O que muda é onde o trabalho **novo** vive.

### A migração é o filtro da auditoria

Auditei os 17 itens que estavam abertos no Plane. O veredito não é "apagar": é **decidir o que
atravessa**. Não migrar é a forma mais limpa de descartar, porque o Plane continua guardando o que
ficou para trás.

**Resultado: 2 atravessam, 15 ficam.**

| Item | Veredito | Por quê |
|---|---|---|
| **ZELO-39** — assinatura pela web | ✅ **migrar** | Sem PSP não há receita. Segue bloqueada por decisão de fornecedor, mas é trabalho real |
| **ZELO-42** — app nativo | ✅ **migrar** | Bem desenhada, travada pelo próprio gatilho medido. Não custa nada aberta |
| **ZELO-43** — portão comercial | ❌ **não migrar** | Não é código: são 5 entrevistas em ILPI e um turno de medicação observado. É *condição* do B2B, e o B2B não vai ser construído |
| **ZELO-44** — portão jurídico | ❌ **não migrar** | O próprio texto dele depende de o 43 produzir um cliente real. Portão atrás de portão fechado |
| **ZELO-31** — fallback por SMS | ❌ **não migrar** | Fora do escopo do v1 desde 24/08. Vira trabalho do comprador |
| **ZELO-41** — SMS e ligação ao paciente | ❌ **não migrar** | Mesma decisão |
| **ZELO-45 a ZELO-55** — 11 histórias institucionais | ❌ **não migrar** | Ver abaixo |

### Por que a trilha institucional inteira fica para trás — os 13 itens

Minha primeira leitura foi migrar os dois portões (ZELO-43 e ZELO-44) e deixar só as 11 de
implementação. **Reli os textos originais e mudei de ideia.**

**O próprio backlog já dizia isso.** O texto da ZELO-43 é explícito:

> *"Nenhuma story de ZELO-45 em diante existe até esta fechar."*

O portão nunca foi aberto — não houve conversa com ILPI, nem turno observado, nem carta de
intenção. E os portões **não são desenvolvimento**: o 43 é trabalho de campo de semanas, o 44 é
consulta jurídica que só começa depois de o 43 produzir um cliente real.

Backlog de desenvolvimento não é lugar de pré-condição de negócio. Um card parado ali parece
trabalho planejado; a mesma análise escrita em documento parece decisão tomada. Manter 13 itens
abertos atrás de um portão fechado inventaria dívida que não existe.

**E o desenho não se perde.** Ele está em
[referencia/EXTENSAO-B2B.md](referencia/EXTENSAO-B2B.md), no repositório, versionado. Para quem
for comprar o produto, uma análise B2B escrita vale mais que 11 cards especulativos num quadro —
cards abertos e parados parecem dívida; um documento de análise parece trabalho feito.

Se o portão abrir um dia, as histórias voltam do documento em uma tarde.

### Onde vive agora

**Linear**, time `Quintanilha` (prefixo `QUI`).
Projeto **ZELO — Momentos**: <https://linear.app/quintanilha/project/zelo-momentos-12115e18244a>

| Card | História | Prioridade |
|---|---|---|
| QUI-5 | Fundação de mídia: guardar arquivo fora do banco | Alta |
| QUI-6 | Consentimento de imagem, separado e revogável | **Urgente** |
| QUI-7 | Momentos do paciente: o cuidador publica, a família vê | Alta |
| QUI-8 | Recado do paciente, em áudio | Alta |
| QUI-9 | Vídeo curto, até 30 segundos | Média |
| QUI-10 | Aviso de momento novo, e um coração | Média |
| QUI-11 | Retenção de 90 dias, e o que a família quer guardar | Alta |

Projeto **ZELO — Plataforma e Receita**: <https://linear.app/quintanilha/project/zelo-plataforma-e-receita-63df35b33b62>
Os dois itens que atravessaram do Plane. Não é sobre o cuidado — é sobre como o produto **cobra** e
como ele **chega ao aparelho**.

| Card | História | Prioridade | Vinha de |
|---|---|---|---|
| [QUI-12](https://linear.app/quintanilha/issue/QUI-12) | Assinatura pela web, fora da comissão das lojas | Alta | ZELO-39 |
| [QUI-13](https://linear.app/quintanilha/issue/QUI-13) | App nativo com push FCM e APNs | Baixa | ZELO-42 |

QUI-1 a QUI-4 são os itens de boas-vindas do próprio Linear, não trabalho do projeto.

O consentimento (QUI-6) é o único **urgente**: nenhuma foto pode existir antes dele. A retenção
(QUI-11) é alta apesar de ser a última — é a única história que fica *mais cara* quanto mais se adia.

### O que passa a ser trabalho de verdade

Além dos 2 itens que atravessam, entra o refinamento novo:
[refinamentos/momentos-fotos-e-videos.md](refinamentos/momentos-fotos-e-videos.md) — 7 histórias,
escritas e prontas para colar no Linear.

E as pendências das fases 11 e 12, que nunca estiveram no Plane porque nasceram de auditoria e de
teste ao vivo: ver [phases/](phases/).

---

## Onde vivia (histórico do Plane)

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

## SMS e ligação automática saíram do v1 — 24/08/2026

**ZELO-31 e ZELO-41 deixaram de estar "adiadas por falta de fornecedor" e passaram a estar
deliberadamente FORA DO ESCOPO do v1.** A diferença importa: não é indecisão, é escopo.

O motivo é estratégico — o objetivo do projeto é a **venda para uma empresa compradora**
(ver [decisoes/PLATFORM_DECISIONS.md](decisoes/PLATFORM_DECISIONS.md) §12). Um comprador com
escala negocia SMS em condições que um projeto sem usuários não consegue, e a análise de custo
([decisoes/CUSTOS-APIS.md](decisoes/CUSTOS-APIS.md)) mostra que a escolha errada de fornecedor
consome perto de metade da receita bruta.

A métrica de sucesso nº 1 foi ajustada junto, para não prometer 99% sem mecanismo — ver
"alerta efetivo" em [REQUIREMENTS.md](REQUIREMENTS.md).

---

**Decisão anterior, ainda válida para o PSP:** os fornecedores externos pagos restantes (PSP,
PSP) ficam para **decisão em lote no fim do projeto**. Ao chegar numa história bloqueada por isso,
**pule sem perguntar de novo** — a confirmação já foi dada duas vezes (18 e 19/08/2026).
Uma pergunta pontual é aceitável só na primeira vez que um tipo **novo** de dependência aparecer.
