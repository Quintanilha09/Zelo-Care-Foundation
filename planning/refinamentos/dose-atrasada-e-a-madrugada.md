# Refinamento — a dose atrasada que se chama "Pendente", e a madrugada invisível

> Relato do fundador em 11/09/2026, com captura da tela inicial às 09:58 e uma
> dose das 09:00 ainda marcada "Pendente". Tudo abaixo foi **medido no código**
> nesta sessão.

## Os quatro pedidos, e o que cada um merece

| # | Pedido | Veredito |
|---|---|---|
| 1 | Dose atrasada deve dizer "Atrasado", com mais urgência | **Sim** — e é o mais importante |
| 2 | "Agendado para **hoje** às 09:00" | **Em parte** — o dia entra quando não for hoje |
| 3 | Listar todos os horários pendentes de hoje | **Já existe** — não refazer |
| 4 | E a dose de madrugada? | **Sim** — e é o achado mais valioso do relato |

---

## 1. "Pendente" e "Atrasado" são estados diferentes, e o app chama os dois igual

### O que foi medido

`components/dose-card.tsx:94` tem **três rótulos**, e nenhum é "Atrasado":

```
{tomada ? "Tomado" : pulada ? "Pulado" : "Pendente"}
```

E `PatientDetailPage.tsx:674` **colapsa `late` em `pending` de propósito** — o
comentário da #26 explica: *"dose atrasada AINDA PODE ser registrada"*. A
intenção era certa (não tirar o botão); o efeito colateral foi apagar a
diferença entre "ainda vai acontecer" e "já devia ter acontecido".

Na tela inicial há uma seção "Perdidas" para `late`, então lá a diferença
existe — mas o cartão dentro dela continua escrito "Pendente".

### Por que isso importa neste produto

São estados **clinicamente diferentes**. Uma dose pendente não pede nada de
ninguém; uma atrasada pede ação agora. Chamar as duas de "Pendente" é o app
apagando a única distinção que ele existe para mostrar.

### A colisão com o invariante 5, e como resolver sem violá-lo

O fundador pediu *"mais senso de urgência no status e na cor"*. O invariante 5
do produto diz:

> Âmbar (`#E9AD51`), **nunca vermelho**, para dose pendente ou atrasada.
> Vermelho é proibido em qualquer contexto de dose.

Então **vermelho está fora**, e isso não é negociável — é a regra que impede o
app de tratar quem cuida como culpado. Urgência sem vermelho:

- **O rótulo muda**: "Atrasado" em vez de "Pendente".
- **O tempo decorrido aparece**: "há 58 minutos". Concreto, verificável, e não
  alarmante — é informação, não repreensão.
- **O peso visual sobe dentro do âmbar**: o selo passa do âmbar diluído
  (`bg-zelo-amber/20`) para o âmbar sólido, e a borda do cartão acompanha.
  Mesma cor, mais presença.
- **A ordem muda**: atrasadas primeiro na lista.

### E o atraso passa a ser calculado na TELA

Este é o ponto técnico que o relato do fundador expõe sem querer.

Hoje `late` é decidido por um **job periódico**: `LATE_GRACE_MINUTES = 30` mais
um cron `*/15`. Somando, **uma dose atrasada pode parecer "Pendente" por até 45
minutos** — e foi provavelmente isso que ele fotografou às 09:58.

A tela já recebe `scheduledAt`. Ela não precisa esperar job nenhum para saber
que 09:00 já passou.

**O status `late` do banco continua existindo e continua servindo ao que
serve**: a cascata de lembretes, o relatório de adesão, o histórico. O que muda
é só a **exibição**, que passa a ser imediata.

---

## 2. O dia no rótulo: sim, mas não em tudo

Dentro de uma tela cuja seção se chama "Agora", escrever "Agendado para **hoje**
às 09:00" é repetir o que a seção já disse. Em cinco cartões seguidos vira
ruído — e ruído faz a pessoa parar de ler, que é o oposto do pedido.

**A regra: o dia aparece quando NÃO é hoje.** Hoje continua "Agendado para
09:00"; a madrugada seguinte vira "Amanhã, 03:00".

Isso só passa a importar de verdade **depois** do item 4, que é quando a tela
deixa de ter um dia só. Os dois andam juntos.

---

## 3. Isto já existe

*"Quero que sejam listados todos os horários de tratamentos pendentes para
hoje."*

A tela inicial já faz: `HomePage.tsx:314-315` separa as pendentes em **"Agora"**
(horário já chegou) e **"Mais tarde"**, e lista todas. A própria captura do
fundador mostra as duas doses do dia — 09:00 em "Agora" e 19:00 em "Mais
tarde".

**Não há trabalho aqui.** Vale dizer isso em vez de construir de novo.

---

## 4. A madrugada — o achado real

### O que foi medido

`GET /patients/:id/today-doses` recorta pelo **dia civil do paciente**
(`localDayBoundsUtc`). As doses existem no banco com 14 dias de antecedência,
mas a tela só mostra as de hoje.

Consequência: **às 22:00, a dose das 03:00 de amanhã não aparece em lugar
nenhum.** Quem vai dormir não sabe que precisa acordar. De manhã ela aparece
como "Perdida" — descoberta **depois** do fato, que é exatamente o que este
produto existe para evitar.

### Mas a gravidade é menor do que parece, e isso muda o desenho

Medido em `lib/dose-reminders.ts`: o lembrete de nível 0 (T+0) **dispara
normalmente de madrugada**. O silêncio noturno (`estaEmSilencioNoturno`, linha
292) só cala o **broadcast** de nível 2 — o aviso para a família inteira. O
primeiro aviso, para quem é responsável, sempre sai.

Então não é verdade que o cuidador "nunca saberia". Ele é acordado pelo push.

**O que falta não é o aviso — é poder se PLANEJAR.** Saber às 22:00 que há uma
dose às 03:00 permite ajustar o despertador, combinar quem acorda, deixar o
remédio separado. E o push depende de permissão concedida, aparelho ligado e
notificação não silenciada; a tela não deveria esconder aquilo de que a pessoa
precisa para se organizar.

Essa diferença importa porque muda o que se constrói: não é um alarme novo, é
**visibilidade antecipada**.

### O desenho proposto

Uma seção **"Madrugada"** na tela inicial, que:

- mostra as doses do **dia seguinte até as 06:00**;
- **só aparece a partir das 18:00** do dia corrente — durante o dia a tela
  continua sendo "hoje", sem mudar de metáfora;
- traz o dia no rótulo ("Amanhã, 03:00"), que é o item 2;
- **não oferece botão de registrar**: é aviso, não ação. Registrar dose que
  ainda não chegou é a #134, e ela continua valendo.

Por que 06:00 e 18:00: são as bordas do que uma pessoa chama de "madrugada" e
de "fim do dia". Nenhum dos dois é configurável nesta entrega — o precedente
das #123 e #134 é fixar primeiro e só tornar ajustável se aparecer necessidade
real.

### O que NÃO fazer

- **Não** transformar a tela inicial num calendário. Ela responde *"está tudo
  em dia hoje?"*, e a madrugada seguinte entra porque é a única parte do
  amanhã que **não dá para ver amanhã de manhã a tempo**.
- **Não** mostrar o dia inteiro de amanhã. A dose das 14:00 de amanhã aparece
  amanhã, e não há risco nenhum nisso.

---

## As issues

| Issue | Tipo | O quê |
|---|---|---|
| A | Correção | "Atrasado" é um estado próprio: rótulo, tempo decorrido, peso, e cálculo na tela |
| B | Melhoria | A madrugada seguinte fica visível à noite, com o dia no rótulo |

**A primeiro** — é correção de algo que já engana quem olha. B é melhoria, e
depende do rótulo de dia que A não precisa mas B exige.
