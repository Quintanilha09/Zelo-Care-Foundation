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
