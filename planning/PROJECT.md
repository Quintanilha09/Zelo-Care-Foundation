# PROJECT — ZELO

> Artefato GSD. Contexto de projeto. Lido no início de toda fase.
> **Atualizado:** 16/08/2026

---

## O produto em uma frase

Um lugar só para acompanhar o remédio, a consulta e a rotina de quem você cuida — e para que a família inteira veja que foi feito, sem precisar perguntar.

## O problema

Três dores empilhadas, e a terceira é a que ninguém endereça:

1. **Carga cognitiva.** Um idoso com duas ou três condições crônicas toma facilmente 5 a 8 medicamentos em horários diferentes. Guardar isso na cabeça, indefinidamente, é exaustivo — e o erro é frequente.
2. **Adesão ao tratamento.** A adesão a tratamentos crônicos em países em desenvolvimento fica em torno de 50%. Metade do tratamento não acontece, e isso vira internação e custo.
3. **Conflito familiar.** Um cuidador principal acumula tudo e desenvolve ressentimento; os demais sentem culpa mas não têm visibilidade. **Nenhum produto no mercado trata o cuidado como algo compartilhado.** É aí que está o espaço.

## Quem usa

- **Cuidador principal** (30–60 anos) — instala, configura, paga. É o comprador. Pouco tempo, culpa constante.
- **Cuidadores periféricos** (irmãos, cônjuge, cuidador contratado) — consomem visibilidade, assumem turnos.
- **Pessoa cuidada** (idoso) — **não precisa usar o app.** Decisão de design, não limitação.

## Os três invariantes

Estes não são requisitos negociáveis. São as condições de existência do produto.

### 1. A notificação SEMPRE chega
Um lembrete que não chega não é bug de UX — é a promessa do produto quebrando, com consequência clínica real. Doses persistidas no banco, jobs idempotentes, cascata multicanal, rastreio de **entrega** (não de envio), fuso do paciente testado, monitoramento ativo.

### 2. Dado de saúde é dado pessoal sensível
Sob a LGPD exige base legal específica e proteção reforçada, desde o dia 1. Isolamento multi-tenant testado automaticamente, autorização por recurso, auditoria imutável, logs sem PII, notificação sem nome de medicamento, consentimento versionado.

### 3. O produto NÃO faz medicina
Não prescreve, não calcula, não sugere e não altera dose. Não checa interação medicamentosa. Não dá orientação de saúde. Não interpreta aferição. Não é prontuário. Não automatiza recompra de controlado. Esta disciplina é o que mantém o ZELO fora do enquadramento como dispositivo médico na Anvisa.

## Tom do produto

- **Nunca culpar.** Dose perdida é **âmbar**, jamais vermelho. O cuidador já vive com culpa crônica. Esta é a decisão de tom mais importante do produto.
- **A tela inicial responde uma pergunta:** "está tudo em dia?" Verde e a pessoa respira. Sem dashboard, sem gráfico.
- **Registrar custa um toque**, direto da notificação, sem abrir o app.
- **Presença da família é visível** — mostrar quem registrou cada dose é o diferencial competitivo, não um detalhe.
- **Acessibilidade real.** Base tipográfica 18px, contraste alto, alvo de toque 48px. O usuário pode ter 65 anos e presbiopia.

---

## Stack — decidida em 16/08/2026

| Camada     | Escolha                                                  |
| ---------- | -------------------------------------------------------- |
| Cliente    | React + Vite + TypeScript + Tailwind, **PWA instalável** |
| Servidor   | Node.js + TypeScript (Express), monolito modular         |
| Banco      | PostgreSQL + Drizzle, migrations versionadas             |
| Fila       | **pg-boss** sobre o mesmo Postgres                       |
| Push       | **Web Push (VAPID)**                                     |
| Tempo real | **SSE** por paciente                                     |
| Visão      | **Claude Vision API** para extração de receita           |
| Cobrança   | PSP **na web**, fora das lojas                           |
| Hospedagem | Replit                                                   |

> **A §3.1 da especificação está superada por esta tabela.** As quatro decisões e o raciocínio completo estão em `phases/01-fundacao-e-guardrails/01-CONTEXT.md`. O restante da spec — regras de negócio, LGPD, fronteira clínica, UX e tom — continua valendo integralmente.

### Módulos do servidor

```
/server/modules
  identity      patient       caregiving    treatment
  scheduling    adherence     inventory     appointments
  notifications reports       billing
/server/shared
  db  events  audit  logger  clock
```

Eventos de domínio: `DoseScheduled`, `DoseTaken`, `DoseMissed`, `EscalationTriggered`, `StockLow`, `CaregiverJoined`.

---

## Restrição operacional dominante

**A restrição deste projeto é crédito do Replit, não tempo.** O fundador trabalha sozinho, com Replit Core, e o Replit Agent escreve o código. Toda decisão de planejamento é avaliada por quanto retrabalho evita:

- Schema do domínio inteiro definido de uma vez — migration que ricocheteia por módulos prontos é a classe mais cara de erro.
- Relógio injetável com time-travel antes de qualquer lógica temporal — testar escalonamento T+60 esperando uma hora real é inviável.
- Design system antes da primeira tela — senão cada tela vira negociação de estilo.
- Toda história carrega um bloco **"NÃO faça nesta story"** — escopo aberto é onde o crédito evapora.

## Documentos irmãos

| Arquivo | O que é |
|---|---|
| `../ZELO - Especificacao Completa.md` | Especificação de produto v1.0. Fonte da verdade de regra de negócio, UX e limites. |
| `../ZELO - Prompt de Handoff.md` | Enquadramento original para o agente de desenvolvimento. |
| `REQUIREMENTS.md` | Requisitos com REQ-ID, rastreáveis até fase e história. |
| `ROADMAP.md` | As 10 fases, com objetivo e critérios de sucesso. |
| `STATE.md` | Memória de sessão. Onde o projeto está agora. |

## Backlog executável

Vive no **Plane**, projeto `ZELO` (`864270aa-59b4-4775-9bda-50fbc3bb8565`). 42 histórias, `ZELO-1` a `ZELO-42`, agrupadas em 10 módulos que correspondem 1:1 às fases deste roadmap.
