# ZELO — Decisões de Plataforma

Cada decisão abaixo foi tomada deliberadamente. A alternativa descartada e o
motivo estão registrados para que qualquer pessoa que queira reabrir a discussão
entenda o raciocínio original.

---

## 1. PWA em vez de app nativo (iOS/Android)

**Decisão:** O ZELO é uma Progressive Web App React — instalável no homescreen
do celular via browser, sem precisar de App Store ou Google Play.

**Alternativa descartada:** React Native / Expo com publicação nas lojas.

**Motivo:**
- O público (cuidadores de 30–60 anos) instala o app principalmente quando o
  médico ou a família indica. Um link é mais fácil de compartilhar do que pedir
  para baixar na loja.
- Publicação nas lojas adiciona ciclo de review (7–14 dias na Apple) para cada
  atualização de feature — inviável na fase inicial de product-market fit.
- React Native/Expo cria duas bases de código (ou uma base com abstrações
  caras) para uma equipe pequena. PWA cobre 95% dos casos de uso do ZELO.
- A decisão é revisável: se as lojas se tornarem necessárias (notificações push
  mais confiáveis no iOS, distribuição corporativa), um wrapper Capacitor pode
  empacotar a PWA sem reescrever o frontend.

---

## 2. Fila de jobs no próprio banco em vez de serviço externo

**Decisão:** Agendamento de doses, escalonamento de alertas e envio de notificações
push são processados por um worker que lê tabelas do próprio PostgreSQL
(`scheduled_doses`, `alert_escalations`).

**Alternativa descartada:** Serviço de fila externo (BullMQ + Redis, SQS, ou similar).

**Motivo:**
- Para o volume inicial do ZELO (dezenas de famílias), o PostgreSQL com polling
  a cada 30 segundos é mais que suficiente. Redis adiciona um serviço gerenciado
  a ser pago, configurado e monitorado sem necessidade ainda.
- Transações ACID do banco garantem que uma dose nunca é processada duas vezes
  (SELECT FOR UPDATE SKIP LOCKED). O mesmo nível de garantia em filas externas
  exige configuração cuidadosa de idempotência.
- A tabela `alert_escalations` já serve como "estado da fila" — qualquer falha
  do worker é diagnosticável via SQL padrão, sem precisar de UI do Redis/SQS.
- Revisável quando: volume exigir sub-segundo ou jobs precisarem de distribuição
  multi-região. Nesse ponto, BullMQ é o caminho natural.

---

## 3. IA de visão para ler receita médica em vez de OCR genérico

**Decisão:** A funcionalidade de "fotografar receita" usará um modelo de visão
(GPT-4o ou similar) que entende o contexto de uma receita médica — posologia,
nome do medicamento, frequência — em vez de OCR puro que retorna texto bruto.

**Alternativa descartada:** Tesseract ou Google Cloud Vision OCR genérico.

**Motivo:**
- Receitas médicas têm caligrafia, abreviações clínicas e formatação não-padrão.
  OCR genérico extrai texto; o produto precisa extrair *estrutura* (medicamento,
  dose, frequência, duração).
- Um modelo de visão entende "1cp 2x/d c/refeição" como "1 comprimido 2 vezes
  ao dia com refeição" sem pipeline adicional de NLP.
- O custo por extração (~$0,01–0,03) é aceitável dado o valor de não digitar a
  receita manualmente.
- **Invariante preservado:** o modelo extrai dados para *pré-preencher* o
  formulário — o cuidador confirma antes de salvar. O ZELO nunca aceita a
  interpretação da IA como definitiva sem revisão humana.

---

## 4. Cobrança pela web em vez de compra dentro do app

**Decisão:** Assinaturas e pagamentos são processados via web (Stripe ou similar),
não via compra in-app do iOS (Apple IAP) ou Google Play Billing.

**Alternativa descartada:** In-app purchase nativo nas lojas.

**Motivo:**
- Apple e Google cobram 15–30% de comissão em compras in-app. Para um serviço
  de saúde com margem estreita, essa comissão é proibitiva na fase inicial.
- Compras in-app exigem revisão da Apple para cada mudança de preço ou plano.
- A decisão de ser PWA (decisão 1) já remove a obrigatoriedade de usar IAP.
- PWA + Stripe permite oferecer planos familiares, cobranças mensais/anuais e
  cupons sem restrições da loja.
- **Risco:** a Apple pode rejeitar um wrapper nativo futuro (Capacitor) que
  direciona para pagamento web. Nesse cenário, a solução é manter dois fluxos
  (web para PWA, IAP para wrapper nativo) — decisão a ser tomada quando o
  wrapper nativo for necessário.
