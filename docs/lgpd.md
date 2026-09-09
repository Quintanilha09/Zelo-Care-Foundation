# LGPD — Zelo

Este documento cobre o tratamento de dados pessoais sensíveis introduzido por
funcionalidades específicas. Não substitui o inventário completo de dados do
produto — cobre o que precisa de explicação própria, começando pela foto de
medicamento (ZELO-21).

## Cadastro de medicamento por foto (ZELO-21)

**O que é coletado:** uma foto da caixa do medicamento ou da receita médica,
enviada pelo cuidador para preencher automaticamente o formulário de
cadastro de tratamento.

**Para quê:** só para leitura de texto (nome do medicamento, concentração,
forma farmacêutica, posologia como está escrita). Nunca para diagnóstico,
validação clínica ou qualquer decisão automatizada sobre o tratamento — a
extração é sempre revisada por um humano antes de qualquer coisa ser salva
(ver `POST /patients/:id/treatments`, inalterado por esta história).

**Onde fica armazenada:** o binário da foto (`photo_extractions.photo_data`,
base64) vive só no Postgres da aplicação — o mesmo banco onde já ficam
todos os outros dados de saúde do produto (prontuário, consentimentos,
registros de dose), com as mesmas garantias de acesso (isolamento por
família, autenticação obrigatória, sem rota pública). Não há upload para
nenhum serviço de armazenamento de objetos de terceiros.

> Nota de implementação: a especificação original desta história previa
> "object storage com URL assinada". Optamos por manter o binário no mesmo
> Postgres já usado por todo o resto do produto, em vez de introduzir um
> provedor de armazenamento externo novo (com sua própria conta, chave e
> superfície de risco) só para este uso, que é deliberadamente efêmero — a
> maioria das fotos existe por segundos, entre o upload e a confirmação do
> formulário. Se o produto crescer a ponto de justificar armazenamento de
> objeto dedicado, revisar esta decisão.

**Retenção — padrão é descartar:** assim que o cuidador confirma o
formulário (ou desiste e remove a foto manualmente), o binário é apagado de
verdade — a coluna `photo_data` é zerada, não soft-deleted. O cuidador pode
optar explicitamente por "guardar esta foto" no momento da confirmação; se
não marcar essa opção, o descarte acontece automaticamente. O padrão nunca
é reter.

O que sobrevive ao descarte é só metadado não-sensível de calibração: quais
campos o modelo tentou extrair, com qual confiança, e o que o cuidador de
fato manteve ou corrigiu (`extracted_fields`/`confidence`/`confirmed_fields`)
— usado só para medir a taxa de acerto por campo ao longo do tempo. Nenhuma
imagem, nenhum texto livre da receita além dos campos estruturados.

**O que vai para a Anthropic (Claude Vision):** a foto e um prompt de
extração, numa chamada de API síncrona. A Anthropic processa a chamada para
gerar a resposta e não usa o conteúdo enviado via API para treinar modelos
(política padrão da API da Anthropic, distinta do consumidor Claude.ai). O
Zelo não persiste a foto na Anthropic além da chamada em si — não há
upload prévio para um endpoint de arquivos, o binário vai direto no corpo
da requisição de extração.

**Disciplina do prompt:** o modelo é instruído a extrair, nunca inferir —
qualquer campo não claramente legível volta vazio com confiança zero. É
proibido ao modelo sugerir dose, completar posologia incompleta ou opinar
sobre o medicamento (ver `artifacts/api-server/src/lib/vision.ts`).

**Confirmação humana obrigatória:** o router de extração
(`artifacts/api-server/src/routes/medication-photos.ts`) não tem nenhum
caminho que crie um `treatment` ou `medication` — é estruturalmente
impossível salvar algo vindo de foto sem passar pelo formulário de
confirmação e pelo endpoint de cadastro manual já existente (ZELO-16),
provado por teste em `medication-photos.test.ts`.

## Outras tabelas com dado sensível de saúde

Ver `consent_records` (consentimento por paciente), `export_tokens` e
`deletion_requests` (exportação/exclusão de dados sob pedido do titular) —
já documentados nos respectivos routers e no `FOUNDATION.md`.

## Perfil do cuidador — foto, telefone e parentesco (Issue #116)

Desde 09/09/2026 o cuidador pode guardar **foto de perfil**, **telefone** e
**parentesco**. Os três são **opcionais** e existem para uma finalidade só,
declarada aqui: **a família saber quem cuida e como falar com essa pessoa.**

| Dado | Onde fica | Quem vê |
|---|---|---|
| Foto | `users.avatar_object_key` — a chave; os bytes ficam no mesmo bucket privado da mídia | quem tem o link assinado, emitido só para a família |
| Telefone | `caregivers.phone` | os cuidadores da mesma família |
| Parentesco | `caregivers.relationship` | os cuidadores da mesma família |

### Por que telefone e parentesco ficam no cuidador, e não na pessoa

Porque mudam de círculo para círculo: a mesma pessoa é "filha" numa família e
"contratada" noutra, e pode dar um telefone de trabalho numa e o pessoal na
outra. A foto fica na pessoa — o rosto é um só.

### O que a família vê, e o que ela não vê

Telefone e parentesco são **visíveis para a família toda** (decisão do fundador
em 08/09/2026). É dado pessoal de terceiro, e por isso está aqui.

**O que nunca sai:** em que **outras famílias** aquele cuidador atua. Um
cuidador pode servir a várias; contar isso a uma delas expõe uma relação que
ela não tem direito de conhecer. Há teste de servidor que falha se um campo
com esse nome aparecer no payload.

### A foto não é `media_asset`

Ela **não** passa pelo consentimento de imagem (QUI-6) nem pelo expurgo de 90
dias (QUI-11), e é de propósito: não há consentimento a pedir de quem publica o
próprio rosto, e a foto não expira. O que ela compartilha com a mídia do mural é
só o bucket e o desenho do link assinado.

### Link assinado, e por quê

`<img src>` não manda header de sessão. A foto é servida por
`GET /api/caregivers/foto/:token`, com um token que carrega o id e a validade,
vale **10 minutos** e é assinado com uma chave derivada **própria** — um token
de mídia não abre foto de perfil. Quem autoriza é a rota que emite o link, e ela
só emite para quem é da família.

### Titular e exclusão

O cuidador troca ou **remove** a própria foto quando quiser
(`DELETE /api/account/avatar`), e limpa o telefone salvando o campo em branco.
Remover apaga a coluna **e** o objeto no armazenamento. Os três campos entram na
exportação de dados e são apagados junto com a família na exclusão.

### O que NÃO se guarda, e é decisão registrada

**CPF, endereço e data de nascimento não entram** — Issue #124, bloqueada. Sem
finalidade declarada, sem base legal escrita aqui, sem encarregado de dados
definido e com o repositório público, guardar documento de identificação seria
assumir obrigação sem contrapartida. CPF não conferido contra a Receita não
prova identidade nenhuma; dá a sensação de rigor sem o rigor.
