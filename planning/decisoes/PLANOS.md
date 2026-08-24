# ZELO — Estrutura de Planos

> **Status:** decidido e implementado (ZELO-56/57) em 20/08/2026
> **Origem:** pedido do fundador de planos para casas de repouso ("um de 15 pacientes e outro de 15+")
> **Relacionado:** [[ZELO - Extensao B2B Institucional]] — que continua valendo integralmente para o segmento institucional
> **Pasta do Vault:** `Pessoal/Projetos/Apps Replit/Zelo`

---

## 1. O pedido, e por que a resposta não foi literal

O fundador pediu dois tiers acima do Família: 15 pacientes e "15+", pensando em casas de repouso e empresas de cuidado. O refinamento mostrou que **um tier por número de paciente não resolve o problema de uma ILPI** — e que o próprio projeto já tinha decidido isso antes, em 18/08, no documento de extensão B2B:

- **§8** — a cobrança institucional é **por leito ativo/mês**, não por faixa de pacientes. É assim que a instituição já pensa, e evita que o valor exploda quando quatro irmãos entram na conta da mesma família.
- **§6** — **conta institucional não é self-service no v1**: cadastro vira solicitação → verificação (CNPJ, CNES ou alvará sanitário) → ativação manual. "Um asilo por semana é volume perfeitamente humano de tratar."
- **§7** — **nada de hedge de schema** para o institucional antes de existir cliente.
- **ZELO-43/44** — dois portões `sem-codigo` (cliente pagante na mão + parecer jurídico) que existem justamente para impedir que a primeira linha desse código seja escrita no escuro.

**O que uma ILPI compra não é capacidade, é prova.** Sem prova de presença por leito (o N2 da §4.2), vínculo com escala de turno, credencial de conselho visível no registro ("Ana Souza, Téc. Enf., COREN-SP 123456") e "não administrada" como campo de primeira classe, um plano de 15 pacientes entrega uma planilha compartilhada com nome bonito — e ela não renova no segundo mês. Pior: a §11.6 aponta que **quem é a controladora do dado muda o contrato e o schema** (paciente vira N:N com organização). Vender antes de responder isso é vender o que não se pode entregar.

---

## 2. O segmento que estava sendo perdido

Existe um cliente real **entre** o Família e o institucional, e ele não precisa de nada da Fase 11: o **cuidador profissional autônomo, o acompanhante e o home care pequeno** — 6 a 15 idosos, cada um com a própria família, sem estrutura institucional.

Ele já é **tecnicamente suportado** (multi-família, papéis, troca de família — construído no bug fix de 18/08) e era **comercialmente órfão**: não existia nada que ele pudesse comprar. É esse o buraco que a ZELO-56 fecha.

---

## 3. Princípio que rege todos os tiers

> **Nada que proteja a segurança do paciente entra em paywall.**

Registrar dose, lembretes, cascata de escalonamento e modo idoso valem em **todos** os planos, inclusive no gratuito. Isso não é generosidade — é a mesma regra que a ZELO-39 já fixava ("o app continua funcionando com pagamento em atraso; lembrete de remédio nunca é cortado por cartão recusado"), e que precisou ser aplicada com força em 20/08, quando se descobriu que um idoso no modo idoso levava um 403 de limite de plano ao apertar "Tomei".

**O que um plano maior vende é capacidade e gestão** — mais pacientes, mais cuidadores, histórico longo, consultas, aviso de estoque, relatório. Nunca segurança.

O diferencial ao paciente vem indireto e é real: **quem cuida de 12 pessoas é quem mais esquece alguém.** É daí que sai a ZELO-57.

---

## 4. Os planos

| | **Grátis** | **Família** | **Profissional** | **Institucional** |
|---|---|---|---|---|
| Para quem | Experimentar | A família cuidando junto | Cuidador autônomo, acompanhante, home care pequeno | ILPI, casa de repouso, empresa de cuidado |
| Pacientes | 1 | até 5 | até 15 | por leito |
| Cuidadores | 1 | ilimitado | ilimitado | ilimitado |
| Medicamentos | 3 | ilimitado | ilimitado | ilimitado |
| Histórico | 7 dias | completo | completo | completo |
| Consultas | — | ✓ | ✓ | ✓ |
| Aviso de estoque | — | ✓ | ✓ | ✓ |
| Relatório médico | — | ✓ | ✓ | ✓ |
| Painel do dia consolidado | ✓ (2+ pacientes) | ✓ | ✓ | ✓ |
| Registro de dose, lembrete, escalonamento, modo idoso | ✓ | ✓ | ✓ | ✓ |
| Como contrata | — | sozinho | sozinho | **fala com a gente** |

**O Profissional não tem recurso exclusivo em relação ao Família — só capacidade.** Foi decisão deliberada: inventar um recurso artificial só pra justificar o tier acima seria criar diferença onde ela não existe no uso real.

**O Institucional não é um tier na tela**: aparece como um bloco de contato, com a explicação de que a cobrança é por leito, o acesso das famílias é incluído e a implantação é acompanhada. Nenhuma estrutura da Fase 11 foi construída.

---

## 5. O painel do dia consolidado (ZELO-57)

A tela inicial responde "está tudo em dia?" para **um** paciente por vez. Quem cuida de 12 teria que trocar de paciente um a um pra descobrir o que precisa de atenção agora.

Decisões de desenho que importam:

- **Ordem por urgência, nunca por desempenho**: dose sem registro primeiro, depois dose para agora, depois o resto. Alfabética seria inútil — a lista existe pra dizer "olhe para cá primeiro".
- **Nenhum percentual de adesão por paciente e nenhum ranking.** Isso viraria um placar de quem "está indo pior", o oposto do produto (CON-012). Há teste automatizado varrendo a resposta da API atrás de `adherenceRate`, `score`, `rank` e afins.
- **Duas consultas, independente da quantidade de pacientes** — nunca uma por paciente. Com 15 pessoas, N+1 vira tela lenta na hora em que ela mais importa. Teste de performance trava isso.
- **Não registra dose pela lista**, de propósito: com 15 pessoas, um toque é fácil demais de errar. O registro acontece na tela do paciente, onde medicamento, dose e horário estão visíveis.
- **Disponível em qualquer plano** para quem tem 2+ pacientes — é ferramenta de não esquecer ninguém, e isso cai na regra do §3.

---

## 6. O que ficou de fora, e por quê

- **Cobrança real** — o PSP segue adiado por decisão do fundador (mesma decisão em lote do SMS). Os botões de assinar dizem "em breve" honestamente, em vez de simular cobrança.
- **Preço** — continua sendo decisão do fundador, e é a única coisa que falta pra estes planos serem vendáveis. Os limites já estão em vigor.
- **Tudo do institucional** — organização/unidade/leito, escala, QR de presença, credencial de conselho, faturamento por leito. Continua atrás das ZELO-43/44, exatamente como o documento de extensão B2B determinou.
