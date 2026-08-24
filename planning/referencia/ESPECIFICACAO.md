# ZELO — Especificação Completa

> **Status:** Especificação v1.1 — em execução
> **Antigo codinome:** ROTINA
> **Última atualização:** 16/08/2026
> **Pasta do Vault:** `Pessoal/Projetos/Apps Replit/Zelo`
> **Prioridade no portfólio:** 1º a ser desenvolvido

> [!info] O que mudou da v1.0 para a v1.1
> Quatro decisões de plataforma foram fechadas em 16/08/2026, todas motivadas pela restrição real do projeto: **crédito do Replit**. Elas alteram a **§3.1** e tocam **§5** e **§7**.
>
> 1. **PWA-first + Web Push** no lugar de React Native + Expo
> 2. **pg-boss sobre o Postgres** no lugar de Redis + BullMQ
> 3. **Claude Vision API** para extração de receita
> 4. **Cobrança pela web**, fora das lojas
>
> Tudo o mais nesta spec — dor, público, regras de negócio, LGPD, fronteira clínica, UX e tom — **continua valendo integralmente**. O raciocínio completo de cada decisão está em `planning/phases/01-fundacao-e-guardrails/01-CONTEXT.md`.

---

## 1. Visão Geral & Pitch

### Pitch de 1 frase
Um lugar só para acompanhar o remédio, a consulta e a rotina de quem você cuida — e para que a família inteira veja que foi feito, sem precisar perguntar.

### Pitch de elevador (30s)
Cuidar de alguém é um trabalho invisível e mal distribuído. Um filho carrega tudo na cabeça — o horário do remédio, quando acaba a cartela, qual dia é a consulta — enquanto os outros irmãos perguntam pelo WhatsApp e não ajudam. O ZELO transforma essa carga mental em um painel compartilhado: quem está presente registra com um toque, e todo mundo vê em tempo real. Não é prontuário, não é app de saúde. É o fim do "você deu o remédio pra mãe?".

### A dor real

Existem três dores empilhadas, e a terceira é a que ninguém endereça:

**1. Carga cognitiva.** Um idoso com duas ou três condições crônicas toma facilmente 5 a 8 medicamentos em horários diferentes. Guardar isso na cabeça, todo dia, indefinidamente, é exaustivo. O erro é frequente: dose pulada, dose dobrada, remédio que acabou sem ninguém perceber.

**2. Adesão ao tratamento.** A Organização Mundial da Saúde estima que a adesão a tratamentos crônicos em países em desenvolvimento fica em torno de 50%. Metade do tratamento simplesmente não acontece — e isso vira internação, agravamento e custo.

**3. Conflito familiar (a dor negligenciada).** O cuidado quase nunca é dividido igualmente. Um cuidador principal acumula tudo e desenvolve ressentimento; os demais sentem culpa mas não têm visibilidade para ajudar. O grupo de família vira um interrogatório. **Nenhum produto no mercado trata o cuidado como algo compartilhado — todos tratam como tarefa individual.** É aí que está o espaço.

### Público-alvo

**Usuário primário — o cuidador familiar**
Adulto de 30 a 60 anos que cuida de pai/mãe idoso, e que é quem instala, configura e paga. Tem smartphone, tem pouco tempo, e sente culpa constante. É o comprador.

**Usuários secundários**
- Cuidadores periféricos (irmãos, cônjuge, cuidador contratado) — só consomem visibilidade e assumem turnos
- Pessoa cuidada (idoso) — **não precisa usar o app**, decisão de design central
- Pais de criança com condição crônica ou rotina médica
- Adulto com condição crônica cuidando de si mesmo (caso de uso solo)

### Dimensionamento
O Brasil tem mais de 30 milhões de pessoas com 60 anos ou mais, e a projeção demográfica é de crescimento acelerado dessa faixa nas próximas duas décadas. A maioria das famílias brasileiras vai passar por esse arranjo de cuidado em algum momento. Some as famílias com criança em tratamento contínuo e os cerca de 40 milhões de brasileiros com hipertensão diagnosticada, e o TAM é praticamente populacional.

### Por que ZELO tem a melhor retenção do portfólio
O gatilho de abertura é o **horário do remédio** — várias vezes por dia, todo dia, por anos. Não depende de motivação, campanha ou lembrete artificial. E a carga emocional torna a desinstalação quase impossível: ninguém remove o app que garante que a mãe tomou o remédio. É o único dos cinco onde o churn natural é a alta ou o falecimento do paciente, não a perda de interesse.

---

## 2. Regras de Negócio & Monetização

### 2.1 Modelo de receita

| Linha | Como funciona | Momento de ativação |
|---|---|---|
| **Assinatura familiar** | Um plano cobre vários cuidadores e mais de um paciente. Preço não é questionado porque a alternativa é ansiedade | Dia 1 |
| **Comissão de recompra farmacêutica** | Integração com farmácia: o app sabe quando a cartela vai acabar e oferece reposição automática antes | Fase 2 — linha mais escalável |
| **Marketplace de cuidado** | Comissão sobre cuidador, enfermagem domiciliar, exame em casa, fisioterapia | Fase 3 |
| **B2B — operadoras e planos** | Licenciamento para plano de saúde focado em idoso; adesão a tratamento reduz internação e custa caro para eles | Fase 3 — maior ticket |

**Estrutura de plano sugerida:**

| | Grátis | Família |
|---|---|---|
| Pacientes | 1 | Até 5 |
| Cuidadores | 1 | Ilimitado |
| Medicamentos | Até 3 | Ilimitado |
| Histórico | 7 dias | Completo + exportável |
| Consultas e exames | — | ✓ |
| Relatório para o médico | — | ✓ |
| Alerta de estoque baixo | — | ✓ |

> **Decisão de PM:** o gratuito precisa ser **generoso o suficiente para virar hábito** e limitado exatamente onde a dor real aparece — que é o segundo cuidador. A conversão acontece quando o irmão quer entrar. O paywall é social, não funcional.

### 2.2 Regras de negócio essenciais

**Modelo de dados central**
```
Família (conta) → tem N Pacientes
Paciente → tem N Cuidadores (com papéis distintos)
Paciente → tem N Tratamentos
Tratamento → gera N Doses agendadas
Dose → tem exatamente 1 Registro (tomada / pulada / adiada / não registrada)
```

**Regras de registro de dose**
- Qualquer cuidador com permissão pode registrar — o primeiro registro vence
- Registro é **idempotente por dose**: dois cuidadores tocando ao mesmo tempo não geram duplicidade
- Estados da dose: `agendada` → `tomada` | `pulada` | `adiada` | `perdida` (expira sem registro)
- Registro retroativo permitido dentro de janela configurável; fora dela exige justificativa
- Toda mudança fica na trilha de auditoria com autor e horário

**Regras de escalonamento de alerta** *(coração do produto)*
```
T-0min    → notificação para o cuidador de plantão
T+15min   → segunda notificação, mais insistente
T+30min   → escalona para TODOS os cuidadores da família
T+60min   → marca como perdida, registra no histórico, notifica o cuidador principal
```
> Este escalonamento é o que faz o produto valer a assinatura. Sem ele é uma lista de tarefas; com ele é uma rede de segurança.

**Regras de estoque**
- Cuidador informa a quantidade da cartela ao cadastrar
- App decrementa a cada dose registrada
- Alerta de reposição em `estoque ≤ 5 dias de tratamento`
- Alerta considera o tempo de recompra (receita vencida, necessidade de nova consulta)

**Regras de papel e permissão**

| Papel | Ver | Registrar | Editar tratamento | Convidar | Financeiro |
|---|---|---|---|---|---|
| Cuidador principal | ✓ | ✓ | ✓ | ✓ | ✓ |
| Cuidador | ✓ | ✓ | ✓ | — | — |
| Cuidador contratado | ✓ | ✓ | — | — | — |
| Observador (familiar distante) | ✓ | — | — | — | — |

> O papel **Observador** é estratégico: é o irmão que mora longe. Ele entra de graça, ganha paz de espírito, e vira o principal vetor de crescimento orgânico da conta.

### 2.3 Limites obrigatórios do produto — o que o ZELO NÃO faz

Esta seção é regra de negócio, não disclaimer. Cada item abaixo protege o produto de virar dispositivo médico regulado ou de causar dano.

- **Não prescreve, não sugere e não altera dose.** O app registra o que o médico prescreveu. Nunca calcula, propõe ou ajusta posologia.
- **Não faz checagem de interação medicamentosa no v1.** É tentador e é onde produtos parecidos se machucam: exige base licenciada, atualizada e validada clinicamente, e um falso negativo pode matar. Fica fora do escopo até existir contrato com base farmacêutica reconhecida e revisão clínica.
- **Não dá orientação de saúde.** Nenhuma tela responde "posso tomar isso com aquilo" ou "o que fazer se pulei a dose". A resposta padrão é sempre encaminhar ao médico ou farmacêutico.
- **Não substitui atendimento de emergência.** Sinal de risco na tela → botão direto para contato de emergência.
- **Não é prontuário eletrônico.** Não armazena diagnóstico, resultado de exame interpretado ou evolução clínica.
- **Não vende medicamento diretamente.** A integração com farmácia é encaminhamento de recompra do que já foi prescrito, respeitando a exigência de receita — e **medicamento controlado fica fora da recompra automatizada**, sempre.

> **Nota de PM:** essa disciplina de escopo é ativo, não limitação. É o que permite operar sem registro de software como dispositivo médico na Anvisa e o que torna a empresa comprável — um adquirente foge de passivo regulatório mal resolvido.

---

## 3. Arquitetura Técnica & Segurança

### 3.1 Stack definida `v1.1`

| Camada | Escolha | Justificativa |
|---|---|---|
| Cliente | **React + Vite + TypeScript + Tailwind, PWA instalável** | Uma base de código serve celular e desktop. Web Push cobre Android e desktop nativamente, e iOS a partir do 16.4 com o app na Tela de Início. Todo o ciclo de build e teste acontece dentro do Replit |
| Servidor | Node.js + TypeScript (**Express**), monolito modular | Consistência de linguagem, e é o caminho que o Replit Agent percorre com menos atrito |
| Banco | PostgreSQL + Drizzle, migrations versionadas | Relacional é o certo aqui — o modelo é fortemente relacional |
| Fila | **pg-boss** sobre o mesmo Postgres | Dose e job entram **na mesma transação**. Elimina por construção a classe de bug "a dose existe mas o job sumiu" — que é exatamente o requisito da §3.3 |
| Tempo real | **SSE por paciente** | Unidirecional resolve o caso inteiro, reconecta sozinho por padrão do navegador e atravessa proxy sem drama |
| Push | **Web Push (VAPID)** | Entrega de notificação é função vital. FCM + APNs entram junto do app nativo, sobre o mesmo contrato de servidor |
| Visão | **Claude Vision API** | Uma chamada resolve OCR e interpretação de posologia em JSON estruturado, sem pipeline de OCR e parser separados |
| Cobrança | **PSP na web** | Ver §2.1 e o risco de comissão de loja na §7 |
| Storage | Object storage criptografado | Foto de receita e cartela, sempre por URL assinada e expirável |
| Hospedagem | Replit | Infraestrutura e segurança de plataforma. **Segurança de aplicação — isolamento entre famílias, autorização, auditoria, LGPD — é responsabilidade inteiramente nossa** |

> **Por que não React Native + Expo no v1.** Expo exige EAS build, device físico e certificados APNs/FCM — boa parte do ciclo acontece fora do Replit, e cada volta custa crédito sem entregar produto. O app nativo virou a última fase do roadmap, com **gatilho medido**: só é executado se a taxa de entrega no iOS ficar consistentemente abaixo de 95%, ou se a instalação do PWA se provar barreira real de aquisição. E quando for executado, será com **Capacitor** sobre a base React existente, não com reescrita.

> **Consequência não óbvia e favorável:** sendo PWA, a assinatura acontece na web e a comissão de 15–30% das lojas simplesmente não existe. O risco listado na §7 deixa de ser risco e vira vantagem — que precisa ser preservada quando o app nativo chegar.

<details><summary>Stack recomendada na v1.0 — superada, mantida como registro</summary>

| Camada | Escolha |
|---|---|
| Mobile | React Native + Expo |
| Web | React + TypeScript + Tailwind |
| Backend | Node.js + TypeScript (Fastify) |
| Banco | PostgreSQL |
| Cache/Fila | Redis + BullMQ |
| Realtime | WebSocket |
| Push | FCM + APNs |
| Storage | Object storage criptografado |

</details>

### 3.2 Padrão arquitetural

Monolito modular, mesma filosofia do BOLEIA:

```
/src
  /modules
    /identity       → conta, família, autenticação
    /patient        → paciente, perfil, condições
    /caregiving     → cuidadores, papéis, convites, permissões
    /treatment      → medicamento, posologia, tratamento
    /scheduling     → geração de doses, agenda, recorrência
    /adherence      → registro de dose, histórico, escalonamento
    /inventory      → estoque, alerta de reposição
    /appointments   → consultas, exames, lembretes
    /notifications  → push, SMS, ligação automática
    /reports        → relatório de adesão para o médico
    /billing        → assinatura, planos
  /shared
    /db /events /audit /observability
```

Eventos de domínio: `DoseScheduled`, `DoseTaken`, `DoseMissed`, `EscalationTriggered`, `StockLow`, `CaregiverJoined`.

### 3.3 O desafio técnico central: confiabilidade de notificação

**Um lembrete que não chega é uma falha grave.** Não é bug de UX — é a promessa inteira do produto quebrando, com consequência clínica real. Este é o ativo técnico defensável e onde deve ir a maior parte do rigor de engenharia.

Requisitos:

1. **Agendamento resiliente.** Doses geradas com antecedência e persistidas no banco, nunca dependendo apenas de timer em memória. Se o processo cair e subir, a agenda continua íntegra.
2. **Job idempotente.** Reprocessar o mesmo job nunca pode gerar notificação duplicada.
3. **Múltiplos canais em cascata.** Push falha (aparelho desligado, sem rede, permissão revogada). Cascata: push → push repetido → SMS → escalonamento para outros cuidadores.
4. **Confirmação de entrega.** Rastrear se o push foi entregue, não só enviado. Sem confirmação em X minutos, escalar canal.
5. **Fuso horário e horário de verão.** Dose das 8h é 8h no relógio da parede do paciente. Armazenar em UTC, agendar no fuso do paciente, e **testar explicitamente a virada de horário**.
6. **Monitoramento ativo.** Alerta interno se a taxa de entrega de push cair abaixo do limiar. A operação precisa saber antes do usuário.

> Um adquirente do setor de saúde vai auditar exatamente isso. É a diferença entre "app de lembrete" e "infraestrutura de adesão".

### 3.4 Segundo desafio: alcançar quem não usa o app

Decisão de design que define o produto: **a pessoa cuidada não precisa de smartphone**. Como alcançá-la:

- **Ligação automática** com mensagem de voz no horário da dose (custo por minuto, entra no plano pago)
- **SMS simples** para quem tem celular básico
- **Modo idoso** opcional: interface separada, fonte grande, alto contraste, um único botão "tomei"
- **Dispositivo físico** (fase futura): botão dedicado que registra a dose com um toque

O caminho padrão do v1 é o cuidador registrando. Os canais acima são reforço, não dependência.

### 3.5 Segurança — dado de saúde é dado sensível

Sob a LGPD, dado de saúde é **dado pessoal sensível** e exige base legal específica e proteção reforçada. Isso não é opcional e não pode ser adiado para depois do MVP.

**Proteção de dados**
- Criptografia em repouso para tudo que identifica condição, medicamento ou paciente
- Criptografia em trânsito (TLS) obrigatória, sem exceção
- **Consentimento explícito e específico** para tratamento de dado de saúde, registrado com versão dos termos
- Consentimento do titular quando o paciente é capaz; representação legal documentada quando não é
- Política de retenção definida; direito de exclusão implementado de verdade (não soft delete eterno)
- Exportação de dados do titular em formato legível
- Encarregado de dados (DPO) designado

**Controle de acesso**
- Multi-tenant com isolamento por família — **teste automatizado obrigatório contra vazamento entre contas**
- Autorização por recurso: todo acesso a paciente valida vínculo do cuidador
- Convite de cuidador por link expirável de uso único; nunca por código adivinhável
- Revogação imediata de acesso, com efeito em sessões ativas
- **Trilha de auditoria imutável** de todo acesso e alteração — quem viu, quem registrou, quando

**Aplicação**
- Rate limiting, validação de schema em toda entrada, autenticação com refresh token revogável
- Segredos apenas em variáveis de ambiente
- **Logs jamais contêm nome de medicamento, condição ou identificador de paciente**
- Backup criptografado com teste de restauração periódico

**Segurança do conteúdo sensível**
- Foto de receita armazenada com acesso por URL assinada e expirável
- Nenhum dado de saúde em parâmetro de URL ou query string
- Notificação na tela de bloqueio configurável — por padrão **não exibe o nome do medicamento** (é dado sensível visível a qualquer um que olhe o celular)

---

## 4. UI/UX & Fluxo do Usuário

### 4.1 Princípios de design

1. **A tela inicial responde uma pergunta: "está tudo em dia?"** Verde e o cuidador respira. Sem gráfico, sem métrica, sem dashboard. Alívio em meio segundo.
2. **Registrar custa um toque.** Se registrar uma dose dá trabalho, o dado apodrece e o produto morre. Um toque direto da notificação, sem abrir o app.
3. **Nunca culpar.** Dose perdida se mostra em âmbar, não em vermelho de alarme. O cuidador já se sente culpado o bastante — o produto reduz culpa, não a amplifica. **Esta é a decisão de tom mais importante do produto.**
4. **Presença da família é visível.** Ver que o irmão registrou a dose da manhã é o que gera pertencimento e reduz o ressentimento que quebra famílias cuidadoras.
5. **Acessibilidade real.** Fonte grande por padrão, contraste alto, alvos de toque generosos. O usuário pode ter 65 anos e presbiopia.

### 4.2 Fluxo — Cuidador principal (onboarding)

```
1. Cadastro (e-mail ou telefone)
2. "Quem você cuida?" → nome, idade, foto opcional
3. "Quais remédios ele toma?"
   └─ FOTO DA CAIXA OU DA RECEITA → extração automática de nome, dose e posologia
   └─ Confirmação e ajuste manual (nunca confiar cegamente na extração)
   └─ Horários gerados automaticamente a partir da posologia
4. "Quantos comprimidos tem na cartela?" → base do controle de estoque
5. "Quem mais ajuda a cuidar?" → convite por WhatsApp
6. → TELA INICIAL pronta e útil
```

> **Meta de onboarding: menos de 3 minutos até a primeira dose agendada.** A foto da receita é o que torna isso possível — digitar posologia manualmente é onde todo concorrente perde o usuário.

### 4.3 Tela inicial (o produto inteiro em uma tela)

```
┌─────────────────────────────────┐
│  Dona Maria            [trocar] │
│                                 │
│  ✓  Tudo em dia hoje            │
│                                 │
│  AGORA                          │
│  ┌───────────────────────────┐  │
│  │ Losartana 50mg     14:00  │  │
│  │ [    ✓ Registrar    ]     │  │
│  └───────────────────────────┘  │
│                                 │
│  MAIS TARDE                     │
│  · Metformina 850mg     20:00   │
│  · Sinvastatina 20mg    22:00   │
│                                 │
│  JÁ FOI                         │
│  ✓ Losartana 50mg  08:00  Ana   │
│  ✓ AAS 100mg       08:00  Ana   │
│                                 │
│  ⚠ Metformina acaba em 4 dias   │
│  📅 Cardiologista — quinta, 15h │
└─────────────────────────────────┘
```

Elementos deliberados:
- Nome de quem registrou ("Ana") — presença da família, o diferencial competitivo
- Alerta de estoque como aviso calmo, não alarme
- Próxima consulta sempre visível — segunda maior fonte de ansiedade
- Troca de paciente no topo — famílias frequentemente cuidam de dois

### 4.4 Telas prioritárias do MVP

| # | Tela | Prioridade |
|---|---|---|
| 1 | Inicial — doses de hoje | P0 |
| 2 | Cadastro de medicamento por foto | P0 |
| 3 | Registro de dose (in-app e via notificação) | P0 |
| 4 | Convite e gestão de cuidadores | P0 |
| 5 | Histórico e calendário de adesão | P0 |
| 6 | Estoque e alerta de reposição | P1 |
| 7 | Consultas e exames | P1 |
| 8 | Relatório de adesão para o médico (PDF) | P1 |
| 9 | Perfil do paciente | P1 |
| 10 | Assinatura e planos | P1 |

> **Tela 8 é subestimada e merece atenção.** O relatório de adesão levado à consulta é o momento em que o cuidador percebe o valor acumulado do app — e é o gatilho de conversão mais forte depois do segundo cuidador. É também a porta de entrada para o B2B com operadoras.

---

## 5. Backlog & User Stories

> [!warning] Este backlog é registro de origem, não fonte de execução
> Em 16/08/2026 estas 21 stories foram refinadas em **42 histórias no Plane** (projeto `ZELO`), agrupadas em **10 fases** descritas em `planning/ROADMAP.md`. A granularidade menor existe para caber em uma sessão do Replit Agent cada, e cada história ganhou critérios de aceite verificáveis e um bloco **"NÃO faça nesta story"**.
>
> Uma fase nova apareceu e não está aqui: **Fase 01 — Fundação e Guardrails**, com constituição do projeto, schema completo do domínio de uma vez e relógio injetável com time-travel. Ela não entrega funcionalidade nenhuma e é a de maior retorno em crédito do projeto.
>
> Para executar, use o Plane e o `ROADMAP.md`. Esta seção continua útil como o raciocínio original de escopo.

> Formato pronto para alimentar o Replit Agent. Cada épico é uma sessão; cada story é um prompt.

### ÉPICO 1 — Fundação `P0`

**ZELO-001 — Setup do projeto**
> Como desenvolvedor, quero a estrutura base para construir os módulos.
- Backend Node/TypeScript + PostgreSQL com migrations versionadas
- Cliente React + Vite + TypeScript, configurado como PWA instalável `v1.1`
- Estrutura modular conforme §3.2
- Segredos via Replit Secrets; healthcheck e logging estruturado **sem PII**

**ZELO-002 — Conta, família e autenticação**
> Como cuidador, quero criar minha conta com segurança.
- Cadastro por e-mail/telefone com verificação
- JWT com refresh token revogável; rate limiting
- Conceito de Família como tenant raiz
- **Teste automatizado de isolamento entre famílias**

**ZELO-003 — Consentimento e LGPD**
> Como plataforma, quero tratar dado de saúde com base legal adequada.
- Tela de consentimento explícito e específico para dado sensível
- Registro de aceite com versão dos termos e timestamp
- Exportação e exclusão de dados do titular
- Trilha de auditoria imutável de acesso e alteração

---

### ÉPICO 2 — Paciente e Cuidadores `P0`

**ZELO-004 — Cadastro de paciente**
- Nome, data de nascimento, foto opcional, observações
- Múltiplos pacientes por família
- Seletor de paciente ativo

**ZELO-005 — Convite e papéis de cuidador**
> Como cuidador principal, quero trazer minha família para dentro.
- Convite por link expirável de uso único (compartilhável no WhatsApp)
- Papéis conforme matriz de §2.2
- Autorização validada por recurso em toda requisição
- Revogação com efeito imediato em sessões ativas

---

### ÉPICO 3 — Tratamento e Agenda `P0`

**ZELO-006 — Cadastro de medicamento por foto** ⭐
> Como cuidador, quero cadastrar o remédio sem digitar nada.
- Foto da caixa ou receita → extração de nome, concentração e posologia
- **Tela de confirmação obrigatória** — o usuário valida antes de salvar
- Fallback manual sempre disponível
- Nenhuma sugestão de dose gerada pelo sistema

**ZELO-007 — Motor de posologia e agendamento**
> Como plataforma, quero gerar as doses futuras de forma confiável.
- Padrões: X vezes ao dia, a cada N horas, dias específicos, ciclos com pausa
- Geração antecipada e persistida no banco (nunca só em memória)
- Suporte a data de início e fim de tratamento
- **Fuso horário do paciente e horário de verão testados explicitamente**

**ZELO-008 — Tratamento contínuo vs. temporário**
- Antibiótico com fim definido vs. crônico indefinido
- Encerramento automático com aviso ao cuidador

---

### ÉPICO 4 — Registro e Escalonamento `P0` ⭐ *coração do produto*

**ZELO-009 — Registro de dose**
- Estados: tomada / pulada / adiada / perdida
- **Idempotente por dose** — dois cuidadores simultâneos não duplicam
- Registro retroativo com janela configurável
- Autor e horário sempre gravados
- Sincronização em tempo real entre cuidadores

**ZELO-010 — Notificação confiável** ⭐
> Como cuidador, quero receber o lembrete sem falha.
- Push via **Web Push (VAPID)** com **ação de registro direto da notificação**, sem abrir o app `v1.1`
- Job idempotente; reprocessamento não duplica
- Rastreamento de entrega, não apenas de envio
- Fallback para SMS quando push não confirma
- **Notificação não exibe nome do medicamento por padrão** (dado sensível)

**ZELO-011 — Escalonamento**
- Cascata T+15 / T+30 / T+60 conforme §2.2
- Escalonamento para todos os cuidadores após limiar
- Marcação automática como perdida
- Configurável por tratamento (nem toda dose merece escalonar)

**ZELO-012 — Monitoramento de entrega**
- Dashboard interno de taxa de entrega de push
- Alerta operacional se cair abaixo do limiar
- *Story de infraestrutura, mas é P0 — sem isso a falha é silenciosa*

---

### ÉPICO 5 — Histórico e Estoque `P0/P1`

**ZELO-013 — Histórico de adesão** `P0`
- Calendário com visão diária, semanal e mensal
- Percentual de adesão por medicamento e por período
- **Tom não punitivo** — âmbar para perdida, nunca vermelho de alarme

**ZELO-014 — Controle de estoque** `P1`
- Quantidade inicial, decremento por dose registrada
- Alerta em ≤ 5 dias de tratamento restante
- Ajuste manual de estoque
- Aviso considerando validade da receita

**ZELO-015 — Relatório para o médico (PDF)** `P1`
- Período selecionável, adesão por medicamento, doses perdidas
- Exportação e compartilhamento
- *Gatilho de conversão e porta de entrada do B2B*

---

### ÉPICO 6 — Consultas e Rotina `P1`

**ZELO-016 — Agenda de consultas e exames**
- Cadastro com especialidade, local, data e observações
- Lembretes escalonados (1 semana, 1 dia, 2 horas antes)
- Espaço para anotar o que perguntar ao médico

**ZELO-017 — Rotina além do remédio**
- Aferição de pressão, glicemia, peso — **apenas registro, sem interpretação**
- Atividades: fisioterapia, banho, alimentação
- Nenhum alerta clínico gerado a partir desses valores

---

### ÉPICO 7 — Monetização `P1`

**ZELO-018 — Planos e limites**
- Aplicação dos limites do plano gratuito conforme §2.1
- Paywall no ponto certo: convite do segundo cuidador

**ZELO-019 — Assinatura**
- Integração com PSP **na web**. Checkout hospedado — o ZELO nunca toca em dado de cartão `v1.1`
- Gestão de plano, upgrade e cancelamento em dois toques, sem retenção agressiva
- Falha de pagamento tem 7 dias de tolerância e **não interrompe lembrete de remédio**
- **Resolvido na v1.1:** sendo PWA, não há in-app purchase e a comissão de 15–30% das lojas não se aplica

---

### ÉPICO 8 — Alcance ao Paciente `P2`

**ZELO-020 — Modo idoso**
- Interface simplificada, fonte grande, alto contraste, botão único

**ZELO-021 — Lembrete por ligação e SMS**
- Chamada automática com mensagem de voz no horário da dose
- SMS para aparelho básico
- Custo por uso — restrito ao plano pago

---

## 6. Métricas de Sucesso

| Métrica | Por que importa | Alvo v1 |
|---|---|---|
| **Taxa de entrega de notificação** | Métrica mestre — é a promessa do produto | > 99% |
| Doses registradas / doses agendadas | Engajamento real | > 80% |
| Cuidadores por conta | Prova a tese do cuidado compartilhado | > 1,8 |
| Retenção D30 / D90 | Prova a tese de alta frequência | > 65% / > 50% |
| Tempo até a primeira dose agendada | Qualidade do onboarding | < 3 min |
| Conversão para pago | Viabilidade | > 8% |
| Churn mensal | — | < 3% |

---

## 7. Riscos e Decisões em Aberto

| Risco | Severidade | Mitigação |
|---|---|---|
| Notificação falha e dose é perdida | **Crítica** | Cascata multicanal, confirmação de entrega, monitoramento ativo |
| Vazamento de dado de saúde | **Crítica** | Criptografia, isolamento testado, auditoria, logs sem PII |
| Enquadramento como dispositivo médico | Alta | Disciplina de escopo de §2.3 — não prescrever, não interpretar, não sugerir |
| Extração errada da receita | Alta | Confirmação humana obrigatória antes de salvar |
| ~~Comissão de 15–30% das lojas na assinatura~~ | ~~Média~~ | **Neutralizado na v1.1** — sendo PWA, a cobrança é web e a comissão não existe. Reavaliar quando o app nativo entrar |
| Web Push no iOS exige o PWA na Tela de Início | Média | Tela de orientação dedicada detectando iOS/Safari; taxa de entrega por plataforma monitorada; app nativo com gatilho medido em < 95% |
| Recompra de medicamento controlado | Alta | Excluído da automação; sempre exige receita e canal formal |

**Decisões resolvidas na v1.1 — 16/08/2026:**

3. ~~**Extração de receita:** OCR próprio ou serviço de visão de terceiro?~~ → **Claude Vision API.** Uma chamada entrega OCR e posologia em JSON estruturado; não é preciso construir parser de posologia em português, que é onde mora o custo real. Confirmação humana obrigatória continua valendo, e a foto é descartada por padrão após a extração.
4. ~~**Mobile-first ou web-first?**~~ → **PWA-first, que é mobile-first sem ser nativo.** O produto continua sendo mobile e push continua sendo o produto — muda o canal de entrega, não a prioridade. Nativo tem fase própria e gatilho medido.

**Decisões que ainda preciso da sua definição:**
1. **Persona de entrada:** cuidador de idoso, pai de criança em tratamento, ou uso solo? Muda onboarding, tom e canal de aquisição — recomendo começar por cuidador de idoso, é onde a dor é mais aguda e a disposição a pagar é maior
2. **Preço da assinatura familiar** — precisa de teste, mas sugiro ancorar acima de streaming e abaixo de plano de saúde
5. **Nome definitivo confirmado?** Verificar INPI e domínio antes de investir em identidade visual
6. **Encarregado de dados (DPO)** — a §3.5 exige designação, e isso é decisão sua, não técnica
7. **Provedor de SMS e de ligação** — entra nas fases 06 e 10, e tem custo variável por uso

---

*Fim da especificação ZELO v1.1*
