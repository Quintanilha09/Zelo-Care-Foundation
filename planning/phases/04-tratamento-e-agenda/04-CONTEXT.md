# CONTEXT — Fase 04: Tratamento e Agenda

> Artefato GSD. Saída da etapa Discuss. Execução direta (Claude Code local), commit por história.
> **Data:** 17/08/2026

---

## Ponto de partida

- `medications` (catálogo) já tem CRUD completo (`routes/medications.ts`) — reaproveitar, não recriar
- `treatments` schema já existe, com os 5 tipos de posologia da spec (`times_per_day`, `every_n_hours`, `specific_weekdays`, `alternate_days`, `cycle_with_pause`) em `scheduleConfig` JSONB
- `scheduled_doses` schema já existe, com `UNIQUE(treatment_id, scheduled_at)` — idempotência de agendamento já garantida no banco desde a Fase 01
- Nenhuma rota de `treatments`, nenhum motor de recorrência, nenhuma fila (pg-boss) ainda existe

## Escopo — REQ-011 a REQ-016 / ZELO-16 a 21

1. **ZELO-16** — rota de tratamento com posologia estruturada + pré-visualização das próximas 5 doses
2. **ZELO-17** — motor de recorrência: função pura `expand(scheduleConfig, inicio, fim, timezone): Date[]`, sem banco, sem rede, testada exaustivamente
3. **ZELO-18** — geração e persistência de doses em janela rolante de 14 dias, com pg-boss
4. **ZELO-19** — fuso do paciente e horário de verão testados explicitamente (4 cenários obrigatórios)
5. **ZELO-20** — tratamento contínuo vs. temporário, encerramento avisado sem opinar
6. **ZELO-21** — cadastro por foto via Claude Vision, confirmação humana obrigatória

## Ordem de implementação

```
17 (motor puro, sem dependência)
  └─ 16 (rota de tratamento, usa o motor para a pré-visualização)
       └─ 19 (fuso/DST — testa o motor com casos difíceis, então vem logo depois dele)
            └─ 18 (persistência + pg-boss, usa o motor já testado)
                 └─ 20 (contínuo/temporário — regra sobre tratamento já persistido)
                      └─ 21 (foto — preenche o mesmo formulário do 16, por último)
```

## Decisões desta fase

- **pg-boss**: instalar agora (ZELO-18). Continua rodando sobre o mesmo Postgres — sem infra nova.
- **Claude Vision (ZELO-21)**: precisa de `ANTHROPIC_API_KEY` como segredo. Vou pedir ao fundador quando chegar nessa história.
- Cada história vira um commit próprio, testado, antes de começar a próxima — regra fixa desde a conversa de 16/08.
