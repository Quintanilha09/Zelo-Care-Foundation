# Refinamento — Momentos: fotos, vídeos e recados

> Pedido do fundador em 24/08/2026. Refinamento completo antes de qualquer código,
> como manda o [`PADRAO-GSD.md`](../PADRAO-GSD.md).

## O pedido, nas palavras dele

> *"Uma opção de upload de fotos e vídeos, para que os familiares vejam que o paciente está sendo
> tratado e bem cuidado. Não servirá somente para comprovação, mas para que a família veja que os
> pacientes estão bem, felizes ou tristes, para que os pacientes mandem um recado."*

---

## O que este recurso é, e o que ele não é

**É o primeiro recurso do ZELO que não é sobre remédio.** Todo o resto do produto responde
*"a dose foi tomada?"*. Este responde outra pergunta, que ninguém tinha feito: **"como ela está?"**

Um filho em outra cidade não quer só saber que o comprimido das 8h foi registrado. Ele quer ver
a mãe. Essa distância é o problema real do produto, e o registro de dose só resolve metade dela.

**Três propósitos, nesta ordem:**

| # | Propósito | Para quem |
|---|---|---|
| 1 | **Tranquilizar** — ver que a pessoa está bem | família distante |
| 2 | **Conectar** — o paciente manda um recado, a família responde | os dois lados |
| 3 | **Comprovar** — registro de que o cuidado aconteceu | quem contrata cuidador |

A ordem importa. Se o recurso nascer como *comprovação*, vira vigilância do cuidador e planilha de
prova. Se nascer como *conexão*, a comprovação vem junto de graça — e é o que sustenta a venda
institucional depois.

### O que ele NÃO é, e isso é regra

**Não é rede social.** Sem curtidas contadas, sem feed infinito, sem "5 momentos esta semana!".
Vale a CON-012: nada de gamificação. Um mural tranquilo, não um placar.

**Não interpreta ninguém.** O fundador escreveu *"felizes ou tristes"* — isso é a **família olhando
e concluindo**, nunca o app afirmando. Qualquer análise automática de humor, expressão ou estado
emocional está **proibida**: seria interpretar a condição de uma pessoa, e cruza a mesma fronteira
clínica das CON-004 e CON-005. O app mostra a foto. Quem lê a foto é quem ama a pessoa.

**Não cobra do cuidador.** Nenhum texto do tipo "faz 3 dias sem foto". Vale a CON-011.

---

## Como se encaixa no que já existe

**Uma seção própria do paciente**, ao lado de Rotina, Consultas e Histórico. Não cabe dentro de
nenhuma delas: não é sobre um remédio nem sobre uma consulta, é sobre a pessoa.

E um aviso na tela inicial quando há algo novo — *"Dona Maria mandou um recado"* — usando o push
que já existe (REQ-021).

### O paciente publicando: reusa algo que já foi construído

A ZELO-58 deu ao paciente um **token de dispositivo com escopo mínimo**, com duas rotas e nada mais.
"Mandar um recado" é a terceira rota natural desse mesmo mundo — o aparelho dele, a sessão dele,
sem virar conta de cuidador.

Isso também justifica retroativamente aquele desenho: o modo idoso deixa de ser só uma tela grande
de "Tomei" e passa a ter uma razão afetiva para a pessoa abrir o aplicativo.

### O que isso destrava no backlog institucional

A **ZELO-52** ("Evidência por foto: opcional, consentida, com descarte real") vira quase de graça:
com a fundação de mídia pronta, ela deixa de ser uma história inteira e vira *"marcar um momento
como evidência de administração"*.

**Construir isto agora reduz o épico institucional sem construir o épico institucional** — que
continua atrás dos portões ZELO-43/44, onde deve ficar.

---

## Decisões de arquitetura

### 1. Object Storage, nunca no banco

`DECISÃO FIRME.`

Hoje o app guarda imagem como **base64 dentro do Postgres** (`photo_extractions.photo_data`,
`appointments.attachment_data`). Funciona para uma foto ocasional; para um mural é insustentável:

- base64 infla o tamanho em **~33%**
- todo backup do banco carrega as mídias junto
- vídeo é impraticável — 30 segundos de celular são 30 a 60 MB
- o custo de banco no Replit cresce com isso

**O Replit já tem Object Storage provisionado neste app** — os Secrets
`DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR` e `PUBLIC_OBJECT_SEARCH_PATHS` existem
desde sempre, e **o código nunca os usou**. A infraestrutura está paga e ociosa.

`NÃO VERIFICADO`: não consegui o preço por GB do Object Storage do Replit nas páginas públicas.
Precisa ser conferido antes de estimar a conta, mas **não muda a decisão** — banco é o lugar errado
em qualquer preço.

### 2. Comprimir no aparelho, antes de subir

**É a maior economia do projeto inteiro, e é de graça.**

| | Sem compressão | Com compressão |
|---|---|---|
| Foto de celular | 3–8 MB | ~300 KB (1600px, JPEG 0.8) |
| Vídeo de 30s | 30–60 MB | ~5 MB (720p) |

São **10 a 20 vezes menos** armazenamento e banda, sem que ninguém perceba a diferença numa tela de
celular. O navegador faz isso sozinho, com `canvas` para foto e `MediaRecorder` para vídeo — sem
biblioteca nova.

### 3. Retenção de 90 dias, com "guardar"

Momentos somem sozinhos depois de 90 dias. A família pode marcar um como **guardado**, e esse fica.

Isto não é economia disfarçada de recurso — **é minimização de dado, que a LGPD exige**. Guardar
foto de uma pessoa vulnerável para sempre, sem motivo, é o oposto do que a lei pede. O custo cai
junto, mas o motivo é outro.

### 4. Áudio, não só foto e vídeo

**Proposta minha, e acho que é a melhor parte.**

Para um idoso, gravar 15 segundos de áudio é **muito mais fácil** que digitar, e muito mais fácil
que se filmar. Um botão grande, segurar e falar.

E custa quase nada: 15 segundos de áudio comprimido são ~50 KB — **cem vezes menos que vídeo**.

Para quem tem dificuldade motora, visual ou de leitura — que é boa parte do público deste app — o
áudio pode ser o único canal que funciona de verdade.

### 5. Privacidade técnica

- **Objetos privados.** Nada de URL pública adivinhável. O acesso é por **link assinado de curta
  duração**, gerado sob autenticação, como já se faz no relatório em PDF (REQ-030).
- **O nome do arquivo não diz nada.** Identificador aleatório, nunca nome do paciente — vale a
  CON-008 (nenhum dado de saúde em URL).
- **Exclusão de verdade.** Apagar o momento apaga o objeto, não só a linha. A REQ-006 (exclusão do
  titular) passa a incluir as mídias, e isso precisa de teste.

---

## Consentimento: a parte mais delicada

`RISCO ALTO — precisa estar certo antes da primeira foto.`

Fotografar uma pessoa exige o consentimento dela. Quando essa pessoa é idosa, dependente e às vezes
sem capacidade civil plena, o cuidado precisa ser maior, não menor.

O app já tem o padrão: `consent_records` com `representativeType` (titular ou representante legal),
versionado e imutável.

**O que este recurso exige:**

1. **Consentimento próprio para imagem**, separado do de dados de saúde. Quem aceitou compartilhar
   dado de medicação **não** aceitou automaticamente ser fotografado.
2. **Revogável a qualquer momento** — e revogar **apaga as mídias existentes**, não só impede novas.
   Consentimento que não pode ser desfeito não é consentimento.
3. **Quem consente é registrado**: o próprio paciente, ou o representante legal, com qual dos dois
   ficando explícito na trilha de auditoria.
4. **Sem consentimento, a seção não existe.** Não aparece cinza com cadeado — simplesmente não está lá.

**Uma tensão que precisa ser dita:** este recurso pode proteger o paciente (prova de bom cuidado) ou
expô-lo (vigilância de alguém que não pode consentir de verdade). O que separa os dois é
exatamente o rigor do consentimento. **Se houver dúvida, o padrão é não ter o recurso.**

---

## Divisão em histórias

Ordenadas por dependência. As três primeiras entregam o essencial; as demais são incremento.

| # | História | Por que nesta ordem |
|---|---|---|
| 1 | **Fundação de mídia**: Object Storage, upload autenticado, link assinado, exclusão real | Nada existe sem isto. Sozinha não entrega tela nenhuma |
| 2 | **Consentimento de imagem**: registro versionado, revogação que apaga | Precisa vir **antes** da primeira foto existir |
| 3 | **Momentos do paciente**: cuidador publica foto com legenda, família vê | O recurso mínimo que já entrega valor |
| 4 | **Recado do paciente**: áudio e foto pelo aparelho dele, reusando o token da ZELO-58 | O lado que ninguém mais faz |
| 5 | **Vídeo curto**: até 30s, comprimido no aparelho | Caro; só depois de o resto provar valor |
| 6 | **Aviso e reação**: push de "há um momento novo", e um coração da família | Fecha o ciclo emocional |
| 7 | **Retenção e guardados**: expurgo automático em 90 dias, marcar para guardar | Pode vir depois, mas **não muito** — cada dia sem isso acumula custo e dado |

**O que fica de fora do v1, deliberadamente:** edição de imagem, filtros, álbuns, comentários em
linha, marcação de pessoas, e qualquer coisa que empurre o recurso na direção de rede social.

---

## Onde isto entra no plano

Não é fase nova: é continuação natural do produto para família, e deve entrar **depois** de a
fase 12 fechar.

Depende de decisão do fundador se vira recurso de plano pago. **Recomendação: não.** O
[FOUNDATION.md](../decisoes/FOUNDATION.md) diz que nada que proteja a segurança do paciente entra
em paywall — e ainda que "ver a mãe" não seja segurança clínica, é exatamente o tipo de coisa que
faz alguém ficar no produto. Cobrar por isso no gratuito seria cobrar pelo que dá vontade de ficar.
