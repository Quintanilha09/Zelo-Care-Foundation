# Momentos — histórias prontas para o Linear

> Saída do refinamento em [momentos-fotos-e-videos.md](momentos-fotos-e-videos.md).
> Escritas em 24/08/2026, no template que o projeto usa desde o início:
> **Objetivo / Escopo / Critérios de aceite / NÃO faça / Depende de**.
>
> O bloco "NÃO faça" não é enfeite — é o que trava scope creep, e foi o que manteve as 41 histórias
> anteriores dentro do escopo.

**Ordem obrigatória.** As três primeiras têm dependência real entre si. Da quarta em diante, a
ordem é de valor, não técnica.

---

## 1 — Fundação de mídia: guardar arquivo fora do banco

**Objetivo:** poder receber, guardar e devolver um arquivo com segurança, sem que ele entre no
Postgres. Nenhuma tela nova — é fundação, e sozinha não entrega nada ao usuário.

**Escopo**
- Cliente do Object Storage do Replit. Os Secrets `DEFAULT_OBJECT_STORAGE_BUCKET_ID`,
  `PRIVATE_OBJECT_DIR` e `PUBLIC_OBJECT_SEARCH_PATHS` **já existem no app e nunca foram usados**.
- Tabela `media_assets`: id, `familyId`, `patientId`, quem enviou, tipo (`image`/`video`/`audio`),
  tamanho, chave no bucket, `createdAt`. **Nunca o binário.**
- Upload autenticado, com limite de tamanho por tipo e allowlist de MIME.
- Leitura por **link assinado de curta duração**, gerado sob autenticação — mesmo padrão do
  relatório em PDF (REQ-030). Nunca URL pública adivinhável.
- Exclusão que apaga **o objeto no bucket**, não só a linha.
- Isolamento por família, como toda rota: mídia de outra família responde 404, nunca 403 (CON-014).

**Critérios de aceite**
- Um arquivo sobe, é recuperado por link assinado, e o link **expira**.
- Link assinado de uma família não abre mídia de outra — teste dedicado.
- Apagar remove o objeto do bucket; um teste confirma que a chave deixou de existir.
- O nome do objeto é **aleatório**, sem nome de paciente nem de medicamento (CON-008).
- Nenhum byte de mídia em coluna do banco.

**NÃO faça nesta story**
- Nenhuma tela.
- Nenhuma transcodificação no servidor. A compressão é no aparelho (história 3).
- Não migrar `photo_extractions.photo_data` nem `appointments.attachment_data` agora. São dado
  legado, funcionam, e migrar junto misturaria dois riscos. Vira história própria depois.

**Depende de:** nada.

---

## 2 — Consentimento de imagem, separado e revogável

**Objetivo:** ninguém é fotografado sem consentimento registrado. E consentimento que não pode ser
desfeito não é consentimento.

**Escopo**
- Consentimento **próprio para imagem**, separado do de dados de saúde. Quem aceitou compartilhar
  dado de medicação **não** aceitou ser fotografado.
- Reusa `consent_records`: versionado, imutável, com `representativeType` (o próprio paciente ou o
  representante legal).
- Só o cuidador principal registra, e a tela diz **quem** está consentindo.
- **Revogar apaga as mídias existentes**, não só bloqueia novas.
- Sem consentimento, a seção de Momentos **não existe** na tela — não aparece cinza com cadeado.

**Critérios de aceite**
- Sem consentimento, a rota de upload responde 403 com motivo claro, e a seção não é renderizada.
- Revogar apaga os objetos do bucket — teste conferindo que as chaves sumiram.
- A trilha de auditoria registra quem consentiu, em que papel, e quando revogou.
- Consentir com dado de saúde **não** libera imagem. Teste explícito dos dois caminhos.

**NÃO faça nesta story**
- Não reaproveitar o consentimento de saúde existente "para simplificar". São coisas diferentes, e
  juntá-las é o tipo de atalho que uma auditoria de LGPD encontra.
- Nada de consentimento implícito por uso ("ao enviar, você declara que...").

**Depende de:** história 1.

---

## 3 — Momentos do paciente: o cuidador publica, a família vê

**Objetivo:** o recurso mínimo que já entrega valor. Um filho em outra cidade abre o app e **vê a mãe**.

**Escopo**
- Seção **Momentos** na ficha do paciente, ao lado de Rotina, Consultas e Histórico.
- Cuidador publica **foto com legenda opcional**. Só foto nesta história.
- **Compressão no aparelho antes de subir**: redimensionar para no máximo 1600px e JPEG ~0.8.
  Uma foto de 3–8 MB vira ~300 KB. É a maior economia do projeto inteiro, e é de graça.
- Mural em ordem cronológica inversa, com quem publicou e quando.
- Quem publicou pode apagar. O cuidador principal pode apagar qualquer um.

**Critérios de aceite**
- Foto de 5 MB chega ao servidor com menos de 500 KB — medido, não estimado.
- O mural mostra autor e horário no fuso do paciente.
- Cuidador de outra família não vê nada — coberto pela suíte de isolamento.
- Apagar remove o objeto do bucket.
- Nenhum vermelho, nenhuma contagem, nenhum "faz X dias sem foto" (CON-011, CON-012).

**NÃO faça nesta story**
- Sem vídeo, sem áudio, sem reação, sem comentário. Cada um é história própria.
- Sem filtro, sem edição, sem álbum, sem marcação de pessoas.
- **Sem qualquer análise automática da imagem.** Nada de detectar humor, expressão ou estado.
  Seria interpretar a condição de uma pessoa e cruza a fronteira das CON-004 e CON-005.

**Depende de:** histórias 1 e 2.

---

## 4 — Recado do paciente, em áudio

**Objetivo:** o lado que nenhum concorrente faz. O idoso **manda um recado** para a família, do
aparelho dele, sem digitar nada.

**Escopo**
- Reusa o **token de dispositivo do paciente** (ZELO-58): mesmo escopo mínimo, header próprio,
  sem virar sessão de cuidador. É a terceira rota daquele mundo.
- **Áudio primeiro, não vídeo.** Para um idoso, segurar um botão e falar é muito mais fácil que se
  filmar ou digitar. E 15 segundos de áudio comprimido são ~50 KB — **cem vezes menos que vídeo**.
- Botão grande, segurar para gravar, limite de 60 segundos, no padrão visual do modo idoso.
- A família recebe aviso e ouve pelo mural.
- Foto pelo aparelho do paciente entra junto, mesmo fluxo.

**Critérios de aceite**
- O token do paciente publica **só no próprio mural** — não alcança outro paciente nem rota de
  cuidador. Teste no mesmo rigor dos 17 casos da ZELO-58.
- Gravação funciona com um toque prolongado, e o que aparece na tela é grande e legível.
- Sem consentimento de imagem, o áudio **continua permitido**: voz não é imagem, e o consentimento
  para uma coisa não vale pela outra. Se o produto decidir exigir os dois, tem que ser explícito.
- Áudio de 60s chega com menos de 300 KB.

**NÃO faça nesta story**
- Sem transcrição automática. Seria processar a fala de uma pessoa vulnerável, e não é o recurso.
- Sem vídeo — é a história 5.
- Não pedir senha ao paciente. O aparelho dele já é o fator.

**Depende de:** histórias 1, 2, 3 e a ZELO-58 (já entregue).

---

## 5 — Vídeo curto

**Objetivo:** um vídeo de poucos segundos diz o que dez fotos não dizem. É o mais caro do conjunto,
então vem depois de o resto provar valor.

**Escopo**
- Limite de **30 segundos** e resolução máxima de 720p.
- **Compressão no aparelho** via `MediaRecorder`, antes de subir. Um vídeo de 30–60 MB vira ~5 MB.
- Reprodução no mural, sem download automático — carrega só quando a pessoa toca.

**Critérios de aceite**
- Vídeo acima de 30s é recusado **no aparelho**, com mensagem clara, antes de gastar banda.
- Vídeo de 30s chega com menos de 8 MB.
- O mural não baixa vídeo sozinho ao abrir — medido.

**NÃO faça nesta story**
- Sem transcodificação no servidor. Custa CPU e complexidade; o aparelho já resolve.
- Sem streaming adaptativo, sem miniatura gerada no servidor.

**Depende de:** histórias 1, 2 e 3.

---

## 6 — Aviso de momento novo, e um coração

**Objetivo:** fechar o ciclo. Sem aviso, a família só vê se lembrar de abrir. Sem resposta, o
paciente fala sozinho.

**Escopo**
- Push quando há momento novo, usando o canal que já existe (REQ-021).
  Texto sem dado de saúde: *"Dona Maria mandou um recado"* — nunca o conteúdo (CON-008, CON-009).
- **Uma** reação, um coração, de quem viu. Aparece quem reagiu.
- Respeita o silêncio noturno já configurado (ZELO-30).

**Critérios de aceite**
- A notificação não carrega conteúdo do momento nem nome de medicamento.
- A reação **não é contada nem comparada**. Mostra quem reagiu, não quantos (CON-012).
- Silêncio noturno é respeitado — teste com o relógio congelado.

**NÃO faça nesta story**
- Sem comentários. Comentário vira conversa, conversa vira moderação, e o produto não é isso.
- Sem contador de visualizações, sem "visto por".
- Sem variedade de reações. Uma só, e é um coração.

**Depende de:** história 3.

---

## 7 — Retenção de 90 dias, e o que a família quer guardar

**Objetivo:** não acumular foto de uma pessoa vulnerável para sempre. **Isto é minimização de dado,
que a LGPD exige** — o custo cair junto é consequência, não motivo.

**Escopo**
- Momento expira em **90 dias** e é apagado do bucket por job.
- A família pode marcar um momento como **guardado**, e esse não expira.
- A tela avisa, sem drama, que momentos somem depois de 90 dias.
- O expurgo entra no `pg-boss`, como os outros jobs.

**Critérios de aceite**
- Momento com 91 dias é apagado, **e o objeto some do bucket** — não só a linha.
- Momento guardado sobrevive, testado com o relógio congelado.
- O job é idempotente: rodar duas vezes não quebra nada.
- A exclusão de dados do titular (REQ-006) passa a incluir mídia, com teste.

**NÃO faça nesta story**
- Não apagar sem avisar antes na interface.
- Sem limite de quantos podem ser guardados — inventar cota aqui seria criar atrito onde não há
  problema ainda.

**Depende de:** história 3. **Não deixar para muito depois** — cada dia sem isso acumula custo e
dado que a lei pede para não acumular.

---

## Como isso encolhe o backlog institucional

A **ZELO-52** ("Evidência por foto: opcional, consentida, com descarte real") deixa de ser história
inteira. Com esta fundação pronta, ela vira *"marcar um momento como evidência de administração"* —
um campo e uma tela.

É o melhor tipo de trabalho: entregar valor para família hoje **e** reduzir o custo do B2B amanhã,
sem construir o B2B agora.
