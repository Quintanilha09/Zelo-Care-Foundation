# Fase 12 — Feedback de uso real (24/08/2026)

> Lote de melhorias e problemas levantados pelo fundador testando o app ao vivo no Replit.
> Nasce sob o padrão de [`../README.md`](../README.md): fecha com `12-VERIFICATION.md`.

## O achado que reenquadra dois "bugs"

`CAUSA CONFIRMADA por leitura de código, 24/08/2026.`

Os dois problemas relatados como bloqueantes — *"Não deu pra agendar agora"* e *"Erro ao registrar
medicamento"* — **não são falhas de gravação. São paywalls do plano gratuito que a tela não mostra.**

A família de teste está no plano `free`, que permite 1 paciente, 3 medicamentos, e tem
`appointments: false` — a agenda de consultas é **bloqueada por inteiro**.

| Sintoma | Origem real |
|---|---|
| "Não deu pra agendar agora. Tente de novo." | `403 PLAN_LIMIT` em `appointments.ts:126`. Tentar de novo **nunca** funciona |
| "Erro ao registrar medicamento" | `403 PLAN_LIMIT` (4º medicamento, `medications.ts:41`) ou `403 PLAN_READ_ONLY` (paciente além do 1º, `treatments.ts:176`) |

**O defeito não é o paywall — é a tela engolir a mensagem.** `AppointmentsPage.tsx:116` tem um
`catch {}` **vazio**, que descarta a resposta do servidor sem ler. O servidor devolve texto claro e
um `code`; o usuário vê "tente de novo".

É a terceira vez que este padrão aparece no projeto. A lição já está no `FOUNDATION.md`:
*"para quem olha a tela, silêncio e falha são a mesma coisa: parece quebrado"*. O componente
`PlanPaywall` já existe e já é usado em Pacientes e Cuidadores — Consultas e Tratamento ficaram de fora.

---

## Backlog desta fase

### 🔴 Bloqueante — o app parece quebrado

| # | Item |
|---|---|
| 12-01 | **Consultas e Tratamento passam a mostrar o paywall**, como Pacientes e Cuidadores já fazem. Nenhum `catch` vazio: erro de plano vira convite, erro real vira mensagem do servidor |
| 12-02 | ✅ **Conta de teste com acesso completo.** Resolvido em 24/08/2026 pelo DADO, não por código: `lib/db/scripts/definir-plano.mjs` dá a uma família uma assinatura ativa, igual à de uma família pagante. Dar superpoder a uma conta seria uma fronteira de autorização nova, escrita às pressas, num app de saúde — e faria você testar um desvio em vez do caminho real |

### 🟠 Correção funcional

| # | Item |
|---|---|
| 12-03 | **Data no passado não pode ser aceita** em Nova consulta. Hoje o formulário permite, e o servidor também. Precisa de `min` no campo **e** validação no servidor — o cliente não é fronteira |
| 12-04 | **O popup de Novo tratamento continua cortado**, e agora nem rola para o lado. O diálogo não pode ser menor que o formulário |

### 🟡 Texto e tom

| # | Item |
|---|---|
| 12-05 | "O que o médico prescreveu — o app registra, não opina." → **"O que o médico prescreveu"** |
| 12-06 | **Remover o travessão (`—`) das mensagens do app**, mantendo só onde for realmente necessário |
| 12-07 | Em Rotina: remover "Só o que foi registrado — sem interpretação nenhuma." |
| 12-08 | **Trocar a palavra "Aferições"** por algo que qualquer pessoa entenda |

### 🔵 Melhorias de formulário

| # | Item |
|---|---|
| 12-09 | **Asterisco (`*`) nos campos obrigatórios — em todo o app**, não só em Nova consulta |
| 12-10 | **Especialidade vira lista filtrável** (combobox): lista completa, filtra enquanto digita, seleciona da lista. Não aceita texto livre |
| 12-11 | **Cores diferentes entre Atividades e Aferições**, para distinguir visualmente o que foi feito |

### ⏸️ Precisa de decisão antes de executar

| # | Item | Por quê |
|---|---|---|
| 12-12 | **Campo Local com endereços reais e mapa (Google Maps)** | Exige conta no Google Cloud, chave de API e **cartão de crédito** — a Places API é cobrada por requisição. É decisão de fornecedor, da mesma natureza do SMS e do PSP já adiados. Ver [`../../BACKLOG.md`](../../BACKLOG.md) |

---

## Restrições desta fase

- **Nenhum `catch` vazio.** Toda falha mostra ou a mensagem do servidor, ou um convite de plano —
  nunca "tente de novo" para algo que não vai funcionar tentando de novo.
- **O paywall não pode virar bloqueio de segurança do paciente.** Registrar dose, lembrete,
  escalonamento e modo idoso valem em todos os planos (invariante 6 do `FOUNDATION.md`).
- **Validação de data no servidor também**, não só no `min` do campo. Frontend não é fronteira.
- **`NÃO VERIFICADO` visualmente** enquanto o frontend não subir nesta máquina (ver fase 11).
  Tudo desta fase precisa de conferência no Replit.
