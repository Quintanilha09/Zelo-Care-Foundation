# Refinamento — Ajustes no padrão GitHub e perfil do cuidador

> Pedido do fundador em **08/09/2026**, com quatro capturas de tela: a página de
> Settings do GitHub, a tela `Ajustes › Sua conta` do ZELO (com o campo "Senha
> atual" preenchido pelo gerenciador do navegador), a continuação dos Ajustes, e o
> menu que abre ao clicar no avatar do GitHub.
>
> Refinamento antes de qualquer código, como manda o [`PADRAO-GSD.md`](../PADRAO-GSD.md).
> **Quatro Issues no GitHub: #113 a #116.** A #99 é absorvida pela #115.

## O pedido, em quatro partes

1. **Tirar a engrenagem.** As configurações passam a viver atrás do avatar, e o
   menu do avatar imita o do GitHub (opções ao clicar na foto).
2. **Perfil do cuidador.** Poder ter uma foto de perfil; e ver o perfil de cada
   pessoa que cuida na mesma família — foto, telefone, e-mail, parentesco ou tipo
   de cuidador.
3. **Ajustes no padrão GitHub.** Lista de seções à esquerda, conteúdo à direita.
   Enfatizado duas vezes: **as seções listadas à esquerda.**
4. **Troca de senha e e-mail por revelação.** Hoje os campos ficam abertos e a
   senha atual vem pré-preenchida — quem está com o aparelho destravado troca a
   senha sem saber a atual. Cada área de troca ganha um botão; os campos só
   aparecem no clique.

---

## O que o refinamento acrescentou ao pedido

Três coisas saíram da leitura do código e **não** estavam no pedido.

### 1. O servidor de senha já está certo — o buraco é de tela (#115)

`POST /api/account/password` (em `account.ts:633`) **exige a senha atual correta**
via `verifyPassword`, e usa o mesmo limitador de tentativas do
`/account/verify-password`. Um atacante com a sessão aberta **não** consegue
trocar a senha por `curl` sem a senha atual.

O que o fundador viu na captura é o **cliente**: o campo "Senha atual" tem
`autoComplete="current-password"`, então o gerenciador do navegador o preenche
sozinho (o realce amarelo). Com ele preenchido e os três campos abertos, quem
pega o aparelho destravado só digita a nova senha duas vezes — e o servidor
aceita, porque a senha atual que o navegador preencheu **está certa**.

Consequência para o rótulo da Issue: é `melhoria` + `seguranca`, **não**
`VULNERABILIDADE CONFIRMADA`. O corpo da #115 diz isso explicitamente, para
ninguém tratar como incidente de backend.

### 2. A foto do cuidador não pode usar o `/api/media` (#116)

A infraestrutura de mídia que já existe (`media-storage.ts`, `POST /api/media`,
compressão no aparelho) é toda amarrada a **paciente + consentimento de imagem +
expiração de 90 dias**. A foto de perfil de um cuidador não tem nenhuma das três:
não há consentimento a pedir, ela não expira, e não é do mural de ninguém.

Ela reaproveita a **camada de armazenamento** (`obterArmazenamento()`), mas
precisa de rota própria (`POST /api/account/avatar`) e de coluna própria. Tratar
avatar como um `media_asset` traria junto o gate de consentimento e o job de
expiração — e os dois estariam errados aqui.

### 3. "Parentesco" é dado novo, e é separado do papel (#116)

A tabela `caregivers` hoje tem `name`, `email`, `role`, `userId`,
`selectedPatientId` — **nada de foto, telefone ou parentesco**. E `role`
(`primary_caregiver` / `caregiver` / `hired_caregiver` / `observer`) é **papel de
acesso**, não vínculo humano: decide o que a pessoa pode fazer.

"Parentesco ou tipo de cuidador" que o fundador pediu é outra coisa — "filha",
"neto", "contratado" como **rótulo humano na ficha**, sem efeito nenhum sobre
permissão. Fica numa coluna nova (`relationship`). Isto **não** toca o buraco
conhecido "papel por paciente" (fase 11.6, adiável): aquele é sobre capacidade
por paciente, este é sobre como a pessoa se apresenta.

---

## As seis decisões, resolvidas

Todas seguiram a recomendação (fundador, 08/09/2026).

| # | Pergunta | Decisão |
|---|---|---|
| D1 | Onde vive a foto do cuidador? | **Na pessoa** (`users.avatar_object_key`): a mesma foto em toda família onde a pessoa cuida. Um upload, uma coluna. |
| D2 | Telefone e parentesco: quem vê? | **A família toda.** É o pedido literal. Implica: o telefone de cada cuidador fica visível para os outros da família. Entra no `docs/lgpd.md` e na exportação de dados (`SettingsDataPage` / `routes/export.ts`). |
| D3 | Parentesco: lista fixa ou texto livre? | **Lista fixa**: `filho_filha`, `conjuge`, `neto_neta`, `irmao_irma`, `contratado`, `amigo`, `outro`. Separada do `role`. |
| D4 | #99 junto ou separada da #115? | **Junto.** As duas remodelam o mesmo painel de senha; o link "não lembro minha senha atual" da #99 nasce dentro do painel revelado. O PR da #115 fecha as duas. |
| D5 | Menu do avatar / barra | **Menu:** Meu perfil · Ajustes · Trocar de família · Sair. **Barra:** Pacientes · Cuidadores + o avatar. Sai a engrenagem e o "Sair" solto; o `FamilySwitcher` deixa a barra e entra no menu. |
| D6 | Ordem | **#113 → #114 → #115 → #116.** Estrutura primeiro (menu e casca não dependem de nada), segurança da senha no meio, perfil por último (é o único com banco, upload e LGPD). |

---

## #113 — [Melhoria] Menu na foto de perfil, no lugar da engrenagem

**Como é hoje.** `app-header.tsx` tem, à direita: `FamilySwitcher`, Pacientes,
Cuidadores, um ícone de engrenagem que leva a `/ajustes`, e um botão "Sair" solto.

**Como deve ser.** No lugar da engrenagem e do "Sair", um botão de **avatar** que
abre um menu suspenso (`DropdownMenu` + `Avatar`, já são dependências em
`components/ui/`). Itens, nesta ordem:

- **Meu perfil** → a seção de perfil dos Ajustes (existe depois da #116; até lá,
  aponta para `/ajustes` e a #116 corrige o destino)
- **Ajustes** → `/ajustes`
- **Trocar de família** → o conteúdo do `FamilySwitcher`, movido para cá
- **Sair**

Pacientes e Cuidadores continuam na barra. O avatar mostra a **inicial do nome**
enquanto não houver foto (a foto chega na #116).

**Toca:** `app-header.tsx`, `family-switcher.tsx` (o gatilho passa a ser um item
de menu). **Servidor:** nenhum. **Depende de:** nada.

**Aceite:**
- Não existe mais ícone de engrenagem no cabeçalho.
- Clicar no avatar abre um menu com os quatro itens; cada um vai para o lugar certo.
- Sem foto, o avatar mostra a inicial; o menu funciona igual.
- Teclado: o menu abre e navega por `Tab`/setas, e fecha no `Esc`.

**NÃO faça:** foto de verdade (é a #116); mexer no conteúdo das telas de Ajustes
(é a #114); tirar Pacientes ou Cuidadores da barra.

---

## #114 — [Melhoria] Ajustes com a lista de seções à esquerda

**Como é hoje.** `/ajustes` é uma página de cartões empilhados
(`SettingsPage.tsx`), e cada categoria é uma rota separada
(`/ajustes/conta`, `/ajustes/notificacoes`, `/ajustes/registro-retroativo`,
`/ajustes/seus-dados`) mais `/planos`.

**Como deve ser.** Uma **casca de duas colunas**: lista de seções fixa à
esquerda, conteúdo da seção à direita — padrão do GitHub. No celular, a lista é o
índice; tocar numa seção abre o conteúdo em tela cheia, com voltar para o índice.

As seções, agrupadas por **de quem é a coisa** (mantém o racional da QUI-19):

| Grupo | Seções |
|---|---|
| Sua conta | Sua conta (nome, senha, e-mail) · **Seu perfil** (chega na #116) · Plano |
| Família | Cuidadores · Notificações · Registro retroativo |
| Seus dados | Baixar ou excluir |
| Ajuda | Notificações no iPhone |

As telas de conteúdo que já existem entram **como estão**, só trocando o embrulho
(o `AppHeader` + `<main>` viram o slot da direita).

**Toca:** `SettingsPage.tsx` (reescreve), `App.tsx` (as rotas `/ajustes/*` passam
a renderizar dentro da casca), um layout novo (`ajustes-shell` ou equivalente).
**Servidor:** nenhum. **Depende de:** nada; melhor depois da #113.

**Aceite:**
- Em tela larga, a lista de seções fica visível à esquerda o tempo todo, e trocar
  de seção não recarrega a página.
- No celular, a lista é o primeiro que se vê; a seção aberta tem como voltar.
- Todas as seções que existiam continuam alcançáveis, com a mesma URL de antes
  (`/ajustes/conta` etc. continuam funcionando).
- A seção da seção atual fica destacada na lista.

**NÃO faça:** criar a seção "Seu perfil" com conteúdo (é a #116 — aqui ela pode
nem aparecer ainda); mudar o que cada tela de conteúdo faz; migrar `/planos` para
fora de `/planos` (só espelhar como seção).

---

## #115 — [Melhoria] Trocar senha e e-mail por revelação, sem pré-preencher a senha atual

**Absorve a #99.** O PR desta Issue fecha as duas.

**Como é hoje.** Em `SettingsAccountPage.tsx`, os cartões "Sua senha" e "Trocar o
e-mail" mostram todos os campos abertos. O campo "Senha atual" tem
`autoComplete="current-password"` e o navegador o preenche. O servidor
(`account.ts:633`) **já exige a senha atual correta** e limita tentativas — o
problema é só de tela.

**Como deve ser.**
- Cada área de troca (senha, e-mail) fica **fechada atrás de um botão**:
  "Trocar a senha" / "Trocar o e-mail de acesso". Os campos só renderizam depois
  do clique. "Cancelar" fecha e limpa.
- O campo "Senha atual" **nasce vazio**, com `autoComplete="off"`, e só existe no
  DOM enquanto o painel está aberto — o gerenciador não tem o que preencher antes.
- Dentro do painel de senha aberto, um link discreto **"Não lembro minha senha
  atual"** (a #99): dispara `POST /api/account/password/reset-link` (rota nova,
  autenticada, e-mail vindo da sessão e **nunca** do corpo, teto de 3/hora por
  conta), e a tela responde com o e-mail mascarado e o aviso de que o link
  desconecta todos os aparelhos. A sessão atual continua viva.

**Toca:** `SettingsAccountPage.tsx` (e o que a casca da #114 fizer com ela);
`routes/account.ts` + testes para a rota nova da #99. **Depende de:** melhor
depois da #114; funciona sozinho.

**Aceite:**
- Ao abrir a tela, nenhum campo de senha ou de e-mail está visível — só os botões.
- O campo "Senha atual" nunca aparece pré-preenchido, em nenhum navegador com
  senha salva.
- "Não lembro minha senha atual" manda o link para o e-mail da própria sessão; o
  corpo da requisição não consegue escolher o destinatário (teste prova isso).
- Pedir o link **não** desloga a sessão atual.
- Roteiro de teste para o fundador.

**NÃO faça:** mudar o comportamento de `password-reset/confirm` (revogar todas as
sessões continua); qualquer caminho que dispense o e-mail (isso é a #87, já
entregue); mexer no fluxo de e-mail além de fechá-lo atrás do botão.

---

## #116 — [Nova função] Perfil do cuidador: foto, telefone, parentesco

**Objetivo.** Cada cuidador tem uma foto e dados de contato; e qualquer pessoa da
família abre a ficha das outras para saber quem é quem e como falar com elas.

**Escopo.**
- **Banco.**
  - `users.avatar_object_key` (texto, nulo) — a foto vive na pessoa (D1).
  - `caregivers.phone` (texto, nulo) e `caregivers.relationship` (enum: os sete
    valores da D3, nulo) — família-específicos.
- **API.**
  - `POST /api/account/avatar` — recebe a imagem já comprimida no aparelho (mesmo
    caminho do Momentos), grava pela `obterArmazenamento()`, guarda a chave em
    `users.avatar_object_key`. Limitador de taxa, teto de tamanho, allow-list de
    MIME (JPEG/PNG/WebP) — igual ao `/api/media`.
  - `DELETE /api/account/avatar` — apaga o objeto e limpa a coluna.
  - `PATCH /api/account/me` passa a aceitar `phone` e `relationship` além de
    `name` (grava em `caregivers` da família ativa).
  - `GET /api/caregivers` passa a devolver, por cuidador: `photoUrl` (ou nulo),
    `phone` (ou nulo), `relationship` (ou nulo).
  - `GET /api/caregivers/:id` já existe — completa com os mesmos campos.
- **Tela.**
  - Seção **"Seu perfil"** nos Ajustes (dentro da casca da #114): trocar/remover
    foto, editar telefone, escolher parentesco.
  - Em `/cuidadores`, cada cartão vira **tocável** → ficha da pessoa: foto grande,
    nome, papel (badge que já existe), parentesco, telefone (com link `tel:`),
    e-mail (com link `mailto:`).
  - O avatar do cabeçalho (#113) passa a mostrar a foto de verdade.
- **Segurança e LGPD.** Telefone e parentesco são dado pessoal de terceiro,
  visíveis para a família (D2): entram no `docs/lgpd.md` (nova categoria de dado)
  e na exportação (`routes/export.ts` — que a #48 já corrigiu para incluir
  cuidadores). O upload é uma superfície nova: `make-apps-resilient` (limite,
  timeout) e `validate-and-encode-input` (MIME, tamanho) valem.

**Critérios de aceite:**
- Foto de 5 MB escolhida no aparelho chega ao servidor com menos de 500 KB (mesmo
  critério da QUI-7; medido no console).
- A foto trocada aparece no cabeçalho, na ficha e na lista de cuidadores sem
  recarregar a página.
- Remover a foto volta para a inicial em todos os três lugares.
- Um cuidador `observer` **consegue** ver a ficha dos outros (é visibilidade da
  família), mas só edita a **própria** foto e os próprios dados — o servidor
  recusa `PATCH` em conta alheia (invariante 2).
- Telefone e parentesco aparecem no arquivo de exportação de dados.
- `GET /api/caregivers` de outra família responde 404 (invariante 2).
- Roteiro de teste para o fundador, com a parte da compressão marcada como a que
  exige navegador de verdade.

**NÃO faça nesta story:**
- Foto por família (D1 decidiu: por pessoa).
- Parentesco como texto livre (D3 decidiu: lista).
- Deixar o parentesco afetar permissão — é rótulo, não papel.
- Recorte/edição de imagem no cliente além da compressão que o Momentos já faz.
- Campos de perfil que ninguém pediu (endereço, aniversário, bio).
- Transcodificação ou variações de tamanho da foto no servidor — nunca; a
  compressão é no aparelho, como todo o resto da mídia do ZELO.

**Depende de:** #114 (a seção "Seu perfil" mora na casca). A ficha em
`/cuidadores` é independente e pode vir antes.

---

## Relação com o que já estava aberto

- **#99** (trocar senha sem lembrar a atual) — **absorvida pela #115.** Continua
  aberta como rastro até o PR da #115 fechar as duas.
- **Fase 11.6** (papel por paciente, adiável) — **não é tocada.** "Parentesco" é
  rótulo humano, não capacidade.
- **#48** (exportação LGPD completa) — já incluiu cuidadores no pacote; a #116 só
  acrescenta dois campos a uma categoria que a #48 criou.
