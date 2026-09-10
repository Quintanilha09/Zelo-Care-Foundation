# Refinamento — foto de perfil, dose antecipada e modo noturno

> Pedido do fundador em 10/09/2026, com duas capturas de tela: dois problemas e duas melhorias.
> Tudo abaixo foi **medido no código nesta sessão**. Onde não deu para medir, está rotulado.

## O que ele pediu, nas palavras dele

**Problemas**

1. *"Eu inseri uma imagem minha mas ela não é salva. Ela permanece no ícone da minha conta mas não
   é mostrada em /ajustes/conta."*
2. *"Hoje é possível marcar 'tomou' para uma dose com muito tempo de antecedência… O cuidador pode
   clicar sem querer no botão e perde então a dose. Não há como editar a dose tomada ou reverter
   isso."*

**Melhorias**

3. *"Poder cortar [a imagem] para o tamanho que eu quero… para que ela não fique muito puxada ou
   pequena."*
4. *"Implemente o modo noturno, pois minha visão dói nesse modo claro. Isso tem que ser
   implementado com cuidado, as cores definidas têm que seguir o padrão do app."*

---

## 1. A foto — o diagnóstico contraria o relato, e vale explicar por quê

**A foto está salva.** O `POST /account/avatar` grava, o `/account/me` devolve `fotoUrl`
(`routes/account.ts:106`), e o cabeçalho a exibe — o próprio fundador diz que ela *"permanece no
ícone da minha conta"*. Se não estivesse salva, o cabeçalho também mostraria as iniciais.

O que existe são **três defeitos separados**, e juntos eles produzem exatamente a impressão de
"não salvou".

### 1a. Ele olhou a tela onde a foto não mora

`/ajustes/conta` é o `SettingsAccountPage` — nome, senha, e-mail, aparelhos, códigos. **Não há
foto nenhuma nessa tela**, e a captura que ele mandou confirma. O envio de foto vive em
`/ajustes/perfil` (`SettingsProfilePage`), que é outro item da lista.

Isso veio da #114, que copiou a divisão do GitHub entre *Account* e *Public profile*. A divisão
está certa; o que está errado é a **ordem**. No GitHub, *Public profile* é o **primeiro** item da
lista e é onde está a foto. No Zelo, "Sua conta" vem primeiro — e "conta" é a palavra que uma
pessoa procura quando quer trocar o próprio retrato.

`RISCO POTENCIAL` — não é hipótese sobre o código, é sobre a leitura dele. Mas é a única
explicação que cobre as duas metades da frase ao mesmo tempo ("não é salva" **e** "permanece no
ícone").

### 1b. O link da foto vence em 10 minutos, e a rota manda guardar por 24 horas

**`VULNERABILIDADE CONFIRMADA` de disponibilidade, não de sigilo.** Medido:

| Onde | Valor |
|---|---|
| `media-links.ts:55` — `VALIDADE_DO_LINK_SEGUNDOS` | **600 s** (10 min) |
| `routes/perfil.ts:276` — `Cache-Control` | `private, max-age=86400` (**24 h**) |

Os dois números discordam por **144×**. A mesma rota diz ao navegador "guarde por um dia" e assina
um token que morre em dez minutos. Enquanto o cache do navegador tem a URL, ninguém percebe. Quando
não tem — janela anônima, cache limpo, DevTools com *Disable cache*, outro aparelho, ou a foto
sendo a primeira coisa pedida depois de dez minutos de app aberto — o `<img>` recebe **410** e o
Radix cai no `AvatarFallback`, isto é, **volta para as iniciais sem erro nenhum na tela**.

A validade de 10 minutos foi desenhada para mídia do mural: muitas fotos, de paciente, sensíveis,
vistas uma vez. A foto de perfil é o oposto — uma só, da própria pessoa, em toda tela, remontada o
tempo todo pela navegação do SPA.

Há ainda uma **divergência entre comentário e código**: `routes/perfil.ts:273-275` diz *"O `v` da
URL é quem invalida quando a foto troca"*. Esse `v` **não existe** — `urlDaFoto` devolve
`/api/caregivers/foto/${token}` e nada mais. Pelo GSD, o código ganha e o comentário é corrigido —
mas aqui o comentário descreve o desenho **certo**, e é o código que deve alcançá-lo.

### 1c. A foto aparece esticada

`components/ui/avatar.tsx:28` — o `AvatarImage` tem `aspect-square h-full w-full` e **nenhum
`object-cover`**. Uma foto que não seja quadrada é espremida dentro de um quadrado. É literalmente
o *"muito puxada"* da melhoria 3, e a correção é uma classe.

O `comprimirFoto` (`lib/comprimir-imagem.ts:120`) reduz o maior lado para 1600 px **preservando a
proporção** — ou seja, nada no caminho torna a imagem quadrada. Quem manda uma foto 16:9 recebe um
rosto achatado.

---

## 2. A dose — três defeitos, e o mais grave é que o remédio já existe e não está ao alcance

### 2a. O servidor não olha o horário agendado

`POST /patients/:id/dose-records` faz **duas** checagens de tempo, e nenhuma delas compara
`takenAt` com `scheduledAt`:

| Checagem | Regra | Onde |
|---|---|---|
| Futuro | `takenAt` > agora + 5 min → 400 | `dose-records.ts:200` |
| Passado | `takenAt` < agora − janela da família (24 h) → exige justificativa | `dose-records.ts:213` |

Registrar às 00:49 a dose agendada para 23:00 passa pelas duas: `takenAt` é *agora*, o futuro é
zero, e o passado é zero. **A distância de ~22 h para o horário agendado não é olhada por
ninguém.** O eixo retroativo tem janela, justificativa e até configuração por família
(`retroactiveWindowHours`); o eixo da antecipação **não tem nada**.

### 2b. As duas telas discordam, e a mais segura já existe

- `HomePage.tsx:286-287` separa as doses pendentes em **`agora`** (`scheduledAt <= now`) e
  **`maisTarde`**. As de "Mais tarde" (`HomePage.tsx:475-486`) aparecem como uma linha simples com
  nome e horário — **sem botão nenhum**.
- `PatientDetailPage.tsx:586` renderiza "✓ Tomou" e "Pular" para **toda** dose `pending`, sem
  olhar o relógio.

Foi na ficha do paciente que ele tropeçou — é a tela da captura. **O comportamento correto já foi
escrito uma vez e não foi levado para a outra tela.**

### 2c. O "Desfazer" existe, e ele não tinha como alcançá-lo

`POST /patients/:id/dose-records/:recordId/undo` existe desde sempre, com
`UNDO_WINDOW_MS = 60_000`. Ele apaga o registro, devolve a dose para `pending` e grava no
`audit_log`. Está correto.

Só que:

1. **Tem um único chamador: `HomePage.tsx:277`.** A ficha do paciente não oferece desfazer.
2. O botão depende de `undoableRecordId`, que é **estado do React** com um `setTimeout` de 60 s
   (`HomePage.tsx:260-261`). Recarregar a página, trocar de tela ou fechar o app **perde a
   possibilidade de desfazer** mesmo dentro dos 60 segundos.
3. Só aparece para quem **venceu a corrida** (`if (winBody.wonRace)`). Outro cuidador que veja o
   engano não tem como desfazer.

Então a frase *"não há como editar a dose tomada ou reverter isso"* está **certa do ponto de vista
dele**, e errada sobre o servidor. O defeito é de alcance, não de ausência.

### 2d. O desenho proposto

**Espelhar o que já existe para o passado.** O produto já sabe tratar "fora da janela" no eixo
retroativo: dentro dela registra sem perguntar, fora dela pede uma justificativa curta e neutra.
Falta o mesmo no eixo da frente.

| Distância até o horário agendado | O que acontece |
|---|---|
| Dentro da janela de antecipação | registra sem perguntar — é o caso comum ("dei 20 min antes de sair") |
| Fora dela | a tela **não oferece o botão**; o card diz a que horas ele aparece |
| Fora dela, com intenção explícita | caminho de registro retroativo/adiantado, com o horário real |

**Recomendação de valor: 1 hora, fixa em constante, não configurável.** Uma família que possa
esticar isso para 24 h recria o defeito, e a #123 já estabeleceu o precedente de não tornar prazo
configurável na primeira entrega.

**O que NÃO fazer, e por quê:**

- **Não bloquear o registro no servidor além do necessário.** Registrar dose é o dado vital do
  produto e já sobrevive a paywall e a pagamento atrasado. Uma pessoa que realmente deu o remédio
  adiantado precisa conseguir registrar — o caminho existe, só não pode ser um toque acidental.
- **Não usar vermelho** em nada disso (invariante 5). Dose adiantada é pendência, é âmbar.
- **Não julgar.** O app não diz "você não devia ter dado agora". Ele diz "esta dose é das 23:00" e
  pergunta se é isso mesmo. Invariante 4.

### 2e. Desfazer versus corrigir

São coisas diferentes, e confundi-las é o que trava a decisão:

- **Desfazer** (≤ 60 s) apaga o registro. Faz sentido enquanto o toque errado ainda é o "agora" da
  pessoa. Deve sobreviver a recarregar a página e valer para qualquer cuidador da família.
- **Corrigir** (depois disso) **não apaga**. Um registro de dose é registro clínico; apagar meia
  hora depois destrói informação. O que se faz com registro clínico errado é **emendar, com
  rastro** — e o `audit_log` deste produto já é *append-only* justamente para isso.

Corrigir é o que responde de verdade ao *"não há como editar"*, e é a parte maior. Vai numa issue
própria, depois das duas correções.

---

## 3. Recortar a foto

Duas coisas, e só a segunda é feature:

1. **`object-cover`** resolve o esticamento hoje (ver 1c). Entra junto com as correções da foto.
2. **Recorte de verdade**: quadro 1:1, com arrastar e ampliar, antes do envio. O avatar é sempre
   um círculo (`h-9` no cabeçalho, `h-20` no perfil), então o recorte é **sempre quadrado** — não
   há escolha de proporção a oferecer, e oferecer seria complicar à toa.

**Onde entra no fluxo:** escolher arquivo → **recortar** → `comprimirFoto` → enviar. O recorte vem
antes da compressão para o `LADO_MAXIMO` de 1600 px valer sobre a imagem já quadrada.

**Só no avatar.** Momentos é memória de família e a proporção é a que a vida deu — recortar lá
seria tirar da foto o que ela tem.

**Decisão a tomar: biblioteca ou na mão.** `NÃO VERIFICADO` — não medi o custo real no bundle.

| | A favor | Contra |
|---|---|---|
| `react-easy-crop` | pinça e arrasto no celular funcionando de primeira; ~15 KB gzip | mais uma dependência |
| Na mão, sobre o `comprimir-imagem.ts` | zero dependência; o canvas e o `createImageBitmap` já estão lá | gesto de pinça correto em toque é bastante código, e o público está no celular |

**Decidido pelo fundador em 10/09/2026: a biblioteca.** O bundle já tem 380 KB gzip e um aviso de
tamanho; 15 KB não muda o quadro, e gesto de toque mal feito muda. O custo real entra medido no
PR, e a instalação passa pelo `vet-dependencies` antes — se a auditoria reprovar, o plano B é o
recorte à mão, e não outra biblioteca sem repetir a auditoria.

---

## 4. Modo noturno

### O achado que mudou o tamanho da tarefa

**O `.dark` já existe e nunca é ligado.** `index.css:103` define 21 tokens para o tema escuro, e
**nada em todo o front adiciona a classe `.dark`** — o `grep` não encontra um único ativador. É
CSS morto desde a fundação.

Então "implementar o modo noturno" **não é escrever o tema**: metade dele está escrita. É ligar o
que existe — e consertar o buraco que aparece quando ele acende.

### O buraco, medido

Os **8 tokens `zelo-*`** (`index.css:51-62`) são as cores que **significam alguma coisa** neste
produto — verde é dose tomada, âmbar é dose pendente ou atrasada, azul é medição. **Nenhum deles é
redefinido no `.dark`.**

| Token | Valor único | O que vira no escuro |
|---|---|---|
| `--color-zelo-amber-bg` | `hsl(38 82% 95%)` | **quase branco** — o cartão de dose pendente vira um retângulo branco no fundo escuro |
| `--color-zelo-green-bg` | `hsl(140 21% 95%)` | idem, para dose tomada |
| `--color-zelo-measure-bg` | `hsl(205 40% 96%)` | idem, para aferição |
| `--color-zelo-amber-fg` | `hsl(38 82% 35%)` | texto escuro sobre fundo escuro |
| `--color-zelo-green-fg` | `hsl(140 21% 30%)` | idem |

São **131 usos em 27 arquivos**. Ligar a classe sem tratar isso não deixa o app feio — **destrói a
linguagem de cor da dose**, que é o invariante 5. É exatamente o *"tem que ser implementado com
cuidado"* que ele pediu, e agora está medido.

### O plano

1. **Derivar os 8 tokens para o escuro preservando o SIGNIFICADO.** No claro, `-bg` é um tom
   pálido e `-fg` é escuro. No escuro, inverte: `-bg` vira um tom **baixo** da mesma matiz e `-fg`
   vira **claro**. A matiz não muda — âmbar continua âmbar, verde continua verde. Vermelho continua
   proibido em dose.
2. **Medir contraste, e escrever o número no PR.** O público é idoso e a tipografia base é 18 px.
   Piso: WCAG AA (4.5:1) para texto. Nenhum par entra sem o número medido.
3. **Três estados, não dois:** Claro · Escuro · **Igual ao aparelho** (`prefers-color-scheme`), e
   este é o padrão. O motivo dele é *"minha visão dói"* — se o celular já está no modo noturno, o
   app deve nascer certo, sem ele descobrir nenhum botão.
4. **Aplicar antes da primeira pintura.** Um script inline curto no `index.html` lendo o
   `localStorage`. Sem isso há um lampejo branco a cada abertura — que, para quem tem dor de vista,
   é o problema inteiro acontecendo toda vez.
5. **Onde fica:** uma seção **Aparência** em Ajustes, no grupo Conta. É onde o GitHub põe, e a
   lista da esquerda acabou de ser feita para isto.
6. **`theme-color`** do PWA acompanha, senão a barra de status do celular fica clara com o app
   escuro.
7. **Revisar tela a tela**: o **modo idoso** (`ElderModePage`) tem desenho travado de alto
   contraste e precisa ser conferido à parte — ele não pode herdar o tema por acidente.

---

## As issues que saem daqui

Ordem estrita, e as correções antes das funções novas.

Criadas em 10/09/2026.

| Issue | Tipo | O quê |
|---|---|---|
| [#134](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/134) | Correção · **segurança** | Dose registrável com horas de antecedência — janela de antecipação, servidor e tela |
| [#135](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/135) | Correção | Desfazer só existe na tela inicial, e some ao recarregar |
| [#132](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/132) | Correção | Foto: o link vence em 10 min contra um cache de 24 h, e a imagem aparece esticada |
| [#133](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/133) | Melhoria | Achar a própria foto: "Seu perfil" primeiro, e o avatar no topo dos Ajustes |
| [#136](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/136) | Nova função · **segurança** | Corrigir um registro de dose depois do prazo, com rastro |
| [#137](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/137) | Nova função | Recortar a foto antes de enviar |
| [#138](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/138) | Nova função | Modo noturno |

**Ordem recomendada: #134 → #135 → #132 → #133 → #136 → #137 → #138.**

As duas primeiras tocam **registro de dose**, que é o dado vital do produto, e o defeito da #134 é
silencioso — a dose sai da lista de pendentes e ninguém é lembrado dela. Nada disso espera por
tela bonita.

### Por que o modo noturno é o último, e não o primeiro

Não é por ser menos importante — é porque ele **atravessa todas as outras**. A #133 mexe na lista
de Ajustes, a #134 e a #135 mexem nos cartões de dose, a #136 acrescenta tela de correção e a #137
acrescenta o diálogo de recorte. Cada uma dessas telas precisa de cor no escuro e de contraste
medido. Feito por último, cada tela é conferida **uma vez**; feito antes, é conferida de novo a
cada issue que entrar depois.

### Nenhuma decisão pendente

A única que restava — dependência do recorte na #137 — foi decidida pelo fundador em 10/09/2026
(ver acima). A fila pode ser executada inteira sem parar para perguntar.
