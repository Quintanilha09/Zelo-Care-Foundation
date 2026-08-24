# REQUIREMENTS — ZELO v1

> Artefato GSD. Cada REQ-ID é rastreável até uma fase do `ROADMAP.md` e uma história no Plane.
> **Atualizado:** 16/08/2026

---

## Capacidades

| REQ-ID | Capacidade | Fase | Plane |
|---|---|---|---|
| REQ-001 | Cadastro, login e sessão revogável individualmente | 02 | ZELO-6 |
| REQ-002 | Família como tenant raiz, com escopo obrigatório em toda consulta | 02 | ZELO-7 |
| REQ-003 | Suíte automatizada de isolamento entre famílias, que cresce sozinha | 02 | ZELO-8 |
| REQ-004 | Consentimento LGPD explícito, específico e versionado | 02 | ZELO-9 |
| REQ-005 | Trilha de auditoria imutável de acesso e alteração | 02 | ZELO-10 |
| REQ-006 | Exportação e exclusão real de dados do titular | 02 | ZELO-11 |
| REQ-007 | Cadastro de paciente, múltiplos pacientes, fuso obrigatório | 03 | ZELO-12 |
| REQ-008 | Matriz de 4 papéis com autorização por recurso e por paciente | 03 | ZELO-13 |
| REQ-009 | Convite de cuidador por link expirável de uso único | 03 | ZELO-14 |
| REQ-010 | Revogação de acesso com efeito imediato em sessão ativa | 03 | ZELO-15 |
| REQ-011 | Cadastro de medicamento com posologia estruturada (5 padrões) | 04 | ZELO-16 |
| REQ-012 | Motor de recorrência puro, determinístico e testado | 04 | ZELO-17 |
| REQ-013 | Doses geradas e persistidas em janela rolante de 14 dias | 04 | ZELO-18 |
| REQ-014 | Fuso do paciente e horário de verão testados explicitamente | 04 | ZELO-19 |
| REQ-015 | Tratamento contínuo vs. temporário, com encerramento avisado | 04 | ZELO-20 |
| REQ-016 | Cadastro de medicamento por foto, com confirmação humana obrigatória | 04 | ZELO-21 |
| REQ-017 | Tela inicial que responde "está tudo em dia?" | 05 | ZELO-22 |
| REQ-018 | Registro de dose idempotente, com autor e horário | 05 | ZELO-23 |
| REQ-019 | Registro retroativo com janela configurável | 05 | ZELO-24 |
| REQ-020 | Sincronização em tempo real entre cuidadores | 05 | ZELO-25 |
| REQ-021 | Canal de Web Push funcional em Android, iOS e desktop | 06 | ZELO-26 |
| REQ-022 | Job de lembrete idempotente na fila | 06 | ZELO-27 |
| REQ-023 | Registro em um toque pela notificação, sem abrir o app | 06 | ZELO-28 |
| REQ-024 | Rastreamento de entrega distinto de envio | 06 | ZELO-29 |
| REQ-025 | Cascata de escalonamento T+15 / T+30 / T+60 | 06 | ZELO-30 |
| REQ-026 | Fallback por SMS quando o push não confirma | 06 | ZELO-31 |
| REQ-027 | Painel interno de taxa de entrega com alerta operacional | 06 | ZELO-32 |
| REQ-028 | Histórico e calendário de adesão em tom não punitivo | 07 | ZELO-33 |
| REQ-029 | Controle de estoque com alerta de reposição em ≤ 5 dias | 07 | ZELO-34 |
| REQ-030 | Relatório de adesão para o médico em PDF | 07 | ZELO-35 |
| REQ-031 | Agenda de consultas e exames com lembretes escalonados | 08 | ZELO-36 |
| REQ-032 | Registro de rotina e aferições, sem interpretação | 08 | ZELO-37 |
| REQ-033 | Planos e limites aplicados no servidor, paywall no 2º cuidador | 09 | ZELO-38 |
| REQ-034 | Assinatura pela web, fora da comissão das lojas | 09 | ZELO-39 |
| REQ-035 | Modo idoso | 10 | ZELO-40 |
| REQ-036 | Lembrete ao paciente por SMS e ligação automática | 10 | ZELO-41 |
| REQ-037 | App nativo com push FCM/APNs sobre o mesmo backend | 10 | ZELO-42 |

## Fundação (habilitadores, sem capacidade de usuário)

| REQ-ID | Item | Fase | Plane |
|---|---|---|---|
| REQ-F01 | Constituição do projeto: `replit.md` e regras permanentes do Agent | 01 | ZELO-1 |
| REQ-F02 | Scaffold do monolito modular com logger redator | 01 | ZELO-2 |
| REQ-F03 | Design system com tokens semânticos e tipografia base 18px | 01 | ZELO-3 |
| REQ-F04 | Schema completo do domínio, com constraints de idempotência | 01 | ZELO-4 |
| REQ-F05 | Relógio injetável, time-travel de dev e seed fictício | 01 | ZELO-5 |

---

## Restrições — o que o produto NÃO faz

Estas são regra de negócio, não disclaimer. Violação de qualquer uma é **devolução automática** na verificação de fase.

| CON-ID | Restrição |
|---|---|
| CON-001 | Não prescreve, não sugere, não calcula e não altera dose |
| CON-002 | Não faz checagem de interação medicamentosa no v1 |
| CON-003 | Não dá orientação de saúde — sempre encaminha ao médico ou farmacêutico |
| CON-004 | Não interpreta aferição: sem faixa de referência, zona colorida, tendência ou alerta por valor |
| CON-005 | Não é prontuário: sem diagnóstico, sem resultado de exame interpretado |
| CON-006 | Não automatiza recompra de medicamento controlado, em nenhuma hipótese |
| CON-007 | Logs jamais contêm nome de medicamento, condição ou identificador de paciente |
| CON-008 | Nenhum dado de saúde em URL, query string, SMS, e-mail ou analytics |
| CON-009 | Notificação não exibe nome de medicamento por padrão |
| CON-010 | Nenhum vermelho em estado de dose — âmbar sempre; vermelho é exclusivo de ação destrutiva |
| CON-011 | Nenhum texto responsabiliza o cuidador |
| CON-012 | Sem gamificação: nada de streak, troféu, meta de adesão ou comparação entre famílias |
| CON-013 | Segredos apenas em Replit Secrets, jamais no código |
| CON-014 | Recurso de outra família devolve 404, nunca 403 |
| CON-015 | Nenhum `familyId` ou `patientId` vindo do cliente é usado sem validação de vínculo no servidor |

---

## Métricas de sucesso v1

| Métrica | Alvo | Onde é medida |
|---|---|---|
| **Taxa de entrega de notificação** | > 99% | Painel interno (REQ-027) |
| Doses registradas / agendadas | > 80% | Histórico |
| Cuidadores por conta | > 1,8 | — |
| Retenção D30 / D90 | > 65% / > 50% | — |
| Tempo até a primeira dose agendada | < 3 min | Onboarding |
| Conversão para pago | > 8% | — |
| Churn mensal | < 3% | — |

## Fora de escopo no v1

Integração com farmácia e comissão de recompra; marketplace de cuidado; licenciamento B2B para operadoras; dispositivo físico de registro; base de medicamentos com autocomplete; leitura de código de barras; integração com aparelho de medição ou wearable; telemedicina; sincronização com calendário externo.
