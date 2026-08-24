# ROADMAP — ZELO

> Artefato GSD. 10 fases. Cada fase percorre o loop **Discuss → Plan → Execute → Verify → Ship**.
> Cada fase corresponde 1:1 a um módulo no Plane e a uma pasta em `phases/`.
> **Atualizado:** 16/08/2026

---

## Marco de MVP

**Fases 01 a 06.** Ao fim da fase 06 o produto cumpre a promessa: um cuidador cadastra um paciente fotografando a receita, convida um irmão, e ambos recebem e registram doses de forma confiável, com escalonamento funcionando.

A fase 07 fecha o conjunto P0 (histórico é P0 na spec). As fases 08 a 10 são pós-MVP.

---

## Fase 01 — Fundação e Guardrails

**Objetivo:** tudo que existe para o Replit Agent não precisar redescobrir contexto a cada sessão. Nenhuma funcionalidade de usuário é entregue. É o épico de maior retorno em crédito do projeto inteiro.

**Requisitos:** REQ-F01 · REQ-F02 · REQ-F03 · REQ-F04 · REQ-F05
**Plane:** ZELO-1 a ZELO-5

**Critérios de sucesso**
- `replit.md` existe, tem menos de 200 linhas, e um leitor novo sabe onde colocar um módulo só com ele.
- `npm run dev` sobe cliente e servidor; `/health` responde 200 com banco conectado.
- Teste prova que o logger redige nome de medicamento e identificador de paciente.
- Migration do domínio inteiro roda do zero e reverte sem erro; `audit_log` rejeita UPDATE e DELETE no nível do banco.
- Build falha se algum arquivo de domínio chamar `Date.now()` diretamente.
- Adiantar o relógio em 61 minutos faz um job agendado executar.
- `/dev/design` mostra todos os componentes e nenhum estado de dose usa vermelho.

---

## Fase 02 — Identidade, Família e LGPD

**Objetivo:** conta, autenticação e a Família como tenant raiz, com a proteção de dado sensível instalada desde já — não adiada para depois do MVP.

**Requisitos:** REQ-001 a REQ-006
**Plane:** ZELO-6 a ZELO-11

**Critérios de sucesso**
- Token revogado é rejeitado na requisição seguinte, sem esperar expirar.
- Consulta de domínio sem `familyId` não compila.
- Recurso de outra família devolve 404.
- **Adicionar rota autenticada nova sem caso de isolamento quebra a suíte de testes.**
- Não é possível cadastrar paciente sem consentimento de dado de saúde registrado com versão.
- Exclusão do titular não deixa nenhuma linha, nenhum arquivo no storage e nenhum job clina fila.

---

## Fase 03 — Paciente e Cuidadores

**Objetivo:** o paciente existe, a família entra, e cada pessoa vê exatamente o que seu papel permite.

**Requisitos:** REQ-007 a REQ-010
**Plane:** ZELO-12 a ZELO-15

**Critérios de sucesso**
- Cadastrar paciente com foto leva menos de 30 segundos em celular; URL da foto expira.
- Teste parametrizado cobre as 20 células da matriz (4 papéis × 5 capacidades).
- Observador recebe 403 ao registrar dose via API direta.
- Link de convite usado duas vezes falha na segunda; página de convite não autenticada não expõe nenhum dado de saúde.
- Revogar acesso derruba a sessão ativa na requisição seguinte e encerra o push daquele usuário.

---

## Fase 04 — Tratamento e Agenda

**Objetivo:** do medicamento até a dose agendada e persistida no banco, com a extração por foto fechando o onboarding em menos de 3 minutos.

**Requisitos:** REQ-011 a REQ-016
**Plane:** ZELO-16 a ZELO-21

**Critérios de sucesso**
- Os 5 padrões de posologia são cadastráveis e a pré-visualização das próximas 5 doses confere.
- Motor de recorrência tem cobertura acima de 95% e nenhum import de banco, HTTP ou fila.
- Matar o processo no meio da geração e reiniciar deixa a agenda íntegra, sem duplicar nem faltar dose.
- Os 4 cenários de fuso e horário de verão passam com resultado explicitamente definido.
- **É impossível salvar tratamento vindo de foto sem passar pela tela de confirmação.**
- Nenhuma tela sugere, calcula ou valida quantidade de dose.

---

## Fase 05 — Tela Inicial e Registro de Dose

**Objetivo:** a tela que responde "está tudo em dia?", e o registro em um toque com o nome de quem registrou visível para a família.

**Requisitos:** REQ-017 a REQ-020
**Plane:** ZELO-22 a ZELO-25

**Critérios de sucesso**
- Um cuidador entende o estado do dia em menos de 2 segundos; nenhum elemento vermelho em nenhum estado.
- **20 requisições simultâneas na mesma dose produzem exatamente 1 registro.**
- Registrar leva 1 toque, com resposta otimista em menos de 100ms.
- Registro fora da janela sem justificativa é rejeitado pelo servidor; dose futura sempre rejeitada.
- Duas sessões abertas: registrar em uma reflete na outra em menos de 2 segundos.

---

## Fase 06 — Notificação e Escalonamento ⭐

**Objetivo:** o coração do produto e o ativo técnico defensável. É onde vai a maior parte do rigor de engenharia.

**Requisitos:** REQ-021 a REQ-027
**Plane:** ZELO-26 a ZELO-32

**Critérios de sucesso**
- Push de teste chega em Chrome desktop, Chrome Android e Safari iOS instalado na tela de início.
- **Processar o mesmo job 10 vezes gera exatamente 1 push.** Matar o worker no meio e reiniciar não duplica.
- Registrar pela notificação funciona com o app fechado.
- **Nenhum push contém nome de medicamento na configuração padrão** — verificado por teste que inspeciona o payload.
- Push enviado com dispositivo desligado fica sem `delivered_at` e aciona a cascata em 3 minutos.
- Time-travel percorre os 4 níveis da cascata; registrar no minuto 12 cancela os três seguintes.
- Simular queda de entrega dispara o alerta operacional em menos de 5 minutos.

---

## Fase 07 — Histórico, Estoque e Relatório

**Objetivo:** o valor acumulado ficando visível. Fecha o conjunto P0.

**Requisitos:** REQ-028 a REQ-030
**Plane:** ZELO-33 a ZELO-35

**Critérios de sucesso**
- Nenhum vermelho, nenhuma linguagem de culpa e nenhuma gamificação no histórico.
- Histórico de 90 dias carrega em menos de 1 segundo; percentual bate com o dado bruto.
- 10 doses registradas decrementam exatamente 10 unidades de estoque.
- Alerta de reposição dispara em 5 dias de tratamento restante, e antecipa se a receita vence antes.
- **Nenhuma frase do relatório em PDF interpreta, sugere ou conclui algo clínico**; link compartilhado expira.

---

## Fase 08 — Consultas e Rotina

**Objetivo:** a segunda maior fonte de ansiedade do cuidador, e o registro de aferições sem cruzar a linha clínica.

**Requisitos:** REQ-031 · REQ-032
**Plane:** ZELO-36 · ZELO-37

**Critérios de sucesso**
- Os três lembretes de consulta disparam nos tempos corretos, no fuso do paciente; remarcar reagenda e cancela os antigos.
- A lista "o que perguntar ao médico" aparece no lembrete de 2 horas antes.
- **Nenhuma tela, texto ou notificação reage ao valor de uma aferição** — provado por teste com valores extremos.
- Gráfico de aferição não tem faixa de referência, zona colorida nem seta de tendência.

---

## Fase 09 — Monetização

**Objetivo:** cobrar no ponto exato onde a dor aparece — o convite do segundo cuidador — sem entregar comissão às lojas.

**Requisitos:** REQ-033 · REQ-034
**Plane:** ZELO-38 · ZELO-39

**Critérios de sucesso**
- Cada limite de plano é testado por API direta, ignorando a interface.
- Downgrade preserva 100% do dado, em modo leitura. **Nunca se perde histórico de saúde por questão de cobrança.**
- Webhook duplicado não altera o estado duas vezes; webhook com assinatura inválida é rejeitado.
- Falha de pagamento não interrompe lembretes durante os 7 dias de tolerância.
- Nenhum dado de cartão passa pelo servidor do ZELO.

---

## Fase 10 — Alcance ao Paciente e App Nativo

**Objetivo:** chegar em quem não usa o app, e sair do PWA **quando o dado justificar**.

**Requisitos:** REQ-035 a REQ-037
**Plane:** ZELO-40 a ZELO-42

**Gatilho de execução do app nativo (REQ-037)** — só iniciar se pelo menos um for verdade:
- Taxa de entrega no iOS, medida no painel da fase 06, consistentemente abaixo de 95%.
- Instalação do PWA em iOS se prova barreira real de aquisição, com dado de funil.
- Presença nas lojas vira requisito de distribuição.

**Critérios de sucesso**
- Modo idoso tem no máximo 3 elementos interativos e sobrevive à fonte do sistema no máximo.
- Confirmação por tecla na ligação registra a dose e cancela o escalonamento.
- Nenhum SMS ou script de voz menciona nome de medicamento.
- App nativo: **nenhuma regra de negócio duplicada** entre web e nativo; assinatura continua na web.

---

## Mapa fase ↔ Plane

| Fase | Módulo no Plane | Histórias | Prioridade |
|---|---|---|---|
| 01 | 01 — Fundação e Guardrails | ZELO-1 a 5 | P0 |
| 02 | 02 — Identidade, Família e LGPD | ZELO-6 a 11 | P0 |
| 03 | 03 — Paciente e Cuidadores | ZELO-12 a 15 | P0 |
| 04 | 04 — Tratamento e Agenda | ZELO-16 a 21 | P0 |
| 05 | 05 — Tela Inicial e Registro de Dose | ZELO-22 a 25 | P0 |
| 06 | 06 — Notificação e Escalonamento | ZELO-26 a 32 | P0 ⭐ |
| 07 | 07 — Histórico, Estoque e Relatório | ZELO-33 a 35 | P0/P1 |
| 08 | 08 — Consultas e Rotina | ZELO-36 a 37 | P1 |
| 09 | 09 — Monetização | ZELO-38 a 39 | P1 |
| 10 | 10 — Alcance ao Paciente e App Nativo | ZELO-40 a 42 | P2 |
