---
name: ZELO — Decisões críticas de produto
description: Regras absolutas de produto para o ZELO que nunca podem ser violadas em nenhuma fase futura
---

# ZELO — Decisões Críticas de Produto

## Regras absolutas

**Por que:** Definidas pelo dono do produto como parte da identidade do ZELO.

**Âmbar, nunca vermelho para doses sem registro**
- Dose pendente/atrasada → âmbar (#E9AD51), nunca vermelho
- Vermelho é proibido em QUALQUER contexto de dose perdida
- Verde (#659A76) apenas para doses confirmadas como tomadas

**Sem interpretação médica**
- Aferições (pressão, glicemia, peso) são registradas como string bruta — sem faixa de referência, sem alerta colorido, sem sugestão clínica
- O médico interpreta; o ZELO registra e exibe o número
- Esta restrição vale para SEMPRE, em todas as fases futuras

**Dado fictício deve ser óbvio**
- Qualquer seed/demo usa: "Família Fictícia Teste", "Dona Maria Teste", medicamentos com "(fictício)" no nome
- Nunca usar nomes de medicamentos reais no seed

**How to apply:** Antes de adicionar qualquer cor de estado ou lógica de alerta, verificar estas regras.
