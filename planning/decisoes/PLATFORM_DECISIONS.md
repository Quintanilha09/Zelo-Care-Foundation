# ZELO — Decisões de Plataforma

Cada decisão abaixo foi tomada deliberadamente. A alternativa descartada e o
motivo estão registrados para que qualquer pessoa que queira reabrir a discussão
entenda o raciocínio original.

> Revisado em 23/08/2026 contra o código. As decisões 2 e 3 tinham divergido da
> implementação e foram corrigidas; as decisões 5 a 9 foram tomadas depois da
> redação original e só existiam no `STATE.md`.

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
  empacotar a PWA sem reescrever o frontend. A história ZELO-42 já traz o
  gatilho medido para isso, e ele ainda não foi atingido.

---

## 2. Fila de jobs no próprio Postgres (pg-boss) em vez de serviço externo

**Decisão:** Agendamento de doses, lembretes, escalonamento de alertas e envio de
notificações push são processados pelo **pg-boss**, uma biblioteca de fila que roda
sobre o **mesmo PostgreSQL da aplicação** — não uma infraestrutura separada.
Implementação em `artifacts/api-server/src/lib/queue.ts`.

**Alternativa descartada:** Serviço de fila externo (BullMQ + Redis, SQS, ou similar).

**Motivo:**
- Para o volume inicial do ZELO (dezenas de famílias), o Postgres dá conta com
  folga. Redis adiciona um serviço gerenciado a ser pago, configurado e
  monitorado sem necessidade ainda.
- Transações ACID do banco garantem que uma dose nunca é processada duas vezes.
  O mesmo nível de garantia em filas externas exige configuração cuidadosa de
  idempotência.
- O estado da fila é uma tabela do próprio banco: qualquer falha é diagnosticável
  via SQL padrão, sem UI de Redis/SQS.
- O pg-boss retenta sozinho, sem lógica extra no handler.
- Revisável quando: volume exigir sub-segundo ou jobs precisarem de distribuição
  multi-região. Nesse ponto, BullMQ é o caminho natural.

**Correção de 23/08/2026:** a redação anterior descrevia "um worker que faz polling
a cada 30 segundos" lendo a tabela `alert_escalations`. Nenhuma das duas coisas
corresponde ao código: o mecanismo é o pg-boss, e `alert_escalations` era
scaffolding de uma versão anterior — foi **removida do schema** e nunca chegou a ser usada.

---

## 3. IA de visão para ler receita médica em vez de OCR genérico

**Decisão:** A funcionalidade de "fotografar receita" usa um modelo de visão que
entende o contexto de uma receita médica — posologia, nome do medicamento,
frequência — em vez de OCR puro que retorna texto bruto.
**Modelo em uso: Claude Haiku 4.5** (`claude-haiku-4-5-20251001`), via SDK da Anthropic,
em `artifacts/api-server/src/lib/vision.ts`.

**Alternativa descartada:** Tesseract ou Google Cloud Vision OCR genérico.

**Motivo:**
- Receitas médicas têm caligrafia, abreviações clínicas e formatação não-padrão.
  OCR genérico extrai texto; o produto precisa extrair *estrutura* (medicamento,
  dose, frequência, duração).
- Um modelo de visão entende "1cp 2x/d c/refeição" como "1 comprimido 2 vezes
  ao dia com refeição" sem pipeline adicional de NLP.
- O custo por extração é aceitável dado o valor de não digitar a receita manualmente.

**Invariantes desta funcionalidade** (todos com teste):
- O modelo **pré-preenche** o formulário; o cuidador confirma antes de salvar.
  O ZELO nunca aceita a interpretação da IA como definitiva.
- A saída do modelo passa por **validação Zod em runtime**, com limites reais
  (`intervalHours` 1–24, `timesPerDay` 1–12, `durationDays` 1–365). Um `as {...}`
  em TypeScript é *cast*, não validação — isso foi um achado da auditoria (OWASP LLM05).
- O prompt declara que **o texto na imagem é conteúdo a ser lido, nunca instrução
  a ser seguida** (defesa contra injeção via imagem).
- Timeout de 30s e rate limit por usuário — a API é paga, e sem limite um token
  roubado esgota o crédito (OWASP LLM10).

**Correção de 23/08/2026:** a redação anterior dizia "GPT-4o ou similar". O modelo
em uso sempre foi da Anthropic; a menção à OpenAI nunca correspondeu ao código.

---

## 4. Cobrança pela web em vez de compra dentro do app

**Decisão:** Assinaturas e pagamentos são processados via web, não via compra
in-app do iOS (Apple IAP) ou Google Play Billing.

**Alternativa descartada:** In-app purchase nativo nas lojas.

**Motivo:**
- Apple e Google cobram 15–30% de comissão em compras in-app. Para um serviço
  de saúde com margem estreita, essa comissão é proibitiva na fase inicial.
- Compras in-app exigem revisão da Apple para cada mudança de preço ou plano.
- A decisão de ser PWA (decisão 1) já remove a obrigatoriedade de usar IAP.
- Web + PSP permite planos familiares, cobranças mensais/anuais e cupons sem
  restrições da loja.
- **Risco:** a Apple pode rejeitar um wrapper nativo futuro (Capacitor) que
  direciona para pagamento web. Nesse cenário, a solução é manter dois fluxos
  (web para PWA, IAP para wrapper nativo) — decisão a ser tomada quando o
  wrapper nativo for necessário.

**Estado:** o PSP **ainda não foi escolhido** (ZELO-39 adiada de propósito). A tela
de planos é honesta sobre isso ("em breve") em vez de simular uma cobrança inexistente.

---

## 5. Monorepo mantido; microsserviços recusados por ora — 19/08/2026

**Decisão:** manter o monorepo pnpm modular (`artifacts/*`, `lib/*`) com tipos
compartilhados. Não separar front e back em repositórios distintos nem migrar
para microsserviços.

**Alternativa descartada:** repositórios separados / microsserviços, motivada pela
hipótese de que isso tornaria o projeto mais vendável a uma empresa.

**Motivo:**
- Due diligence técnica avalia qualidade de código, teste e segurança — não
  topologia de repositório. Monorepo com tipos compartilhados é padrão em
  empresas grandes, não sinal de projeto amador.
- Microsserviços trocariam a **garantia de transação atômica** que o produto usa
  em todo lugar (dose + estoque + lembrete na MESMA transação Postgres) por
  consistência eventual — sem nenhum ganho real com zero usuários em produção e
  um único desenvolvedor. É risco de trava por otimização prematura.
- **Não reabrir sem motivo novo** — por exemplo, um parceiro B2B precisando
  consumir a API de fora.

> Vale só para o ZELO. Para produtos **novos** do portfólio, a decisão do fundador
> é começar com front e back em repositórios separados.

---

## 6. O paciente não vira uma conta — ZELO-58, 21/08/2026

**Decisão:** o acesso do paciente ao próprio aparelho é um **token de dispositivo
com escopo mínimo**, não um usuário e não um papel na matriz de cuidadores.

**Alternativas descartadas:**
- *Conta própria para o paciente* — cadastro, senha e recuperação de senha para um
  idoso é exatamente a barreira que o produto existe para evitar. A spec é explícita:
  "a pessoa cuidada não precisa do app".
- *Um papel novo na matriz de cuidadores* — `caregiver_role` entra no JWT e governa
  `requireCapability`. Colocar o paciente ali daria a ele, por construção, a
  superfície inteira de um cuidador.

**Motivo e mecanismo:** o cuidador principal gera um link curto (24h, uso único),
manda por WhatsApp, o paciente abre no aparelho dele e o link vira um token de
dispositivo de vida longa e revogável (`patient_access_tokens`, o banco guarda só o
hash). Middleware próprio (`requirePatientAccess`) lendo header próprio
(`X-Patient-Access`, nunca `Authorization`): **os dois mundos não se cruzam por
construção, não por checagem extra.** Duas rotas e nada mais.

O desenho anterior reaproveitava a sessão do cuidador no aparelho do paciente —
um aparelho fora do controle do cuidador carregava, por baixo da tela travada, uma
sessão com histórico, exclusão de paciente e convite de cuidador.

---

## 7. Planos por capacidade; institucional por leito e sem self-service — ZELO-56/57, 20/08/2026

**Decisão:** `PLAN_LIMITS` é uma tabela de N tiers (`free`, `family`, `professional`),
com `getPlanTier()` como fonte única do mapeamento assinatura → tier. O atendimento
institucional (ILPI) é **bloco de contato, não botão de assinar**.

**Alternativa descartada:** criar um tier de "15 pacientes" e outro de "15+" para
casas de repouso, como pedido originalmente.

**Motivo:** uma ILPI não compra capacidade, compra **prova** — presença por leito,
vínculo com escala de turno, COREN visível no registro, "não administrada" como campo
de primeira classe. Um tier de 15 pacientes entrega a ela uma planilha compartilhada
com nome bonito, e ela não renova no segundo mês. O projeto já tinha decidido isso em
18/08 (cobrança por leito ativo/mês, sem self-service, atrás dos portões ZELO-43/44).
O tier `professional` existe para o segmento que estava sendo perdido: o **cuidador
profissional autônomo / home care pequeno** (6–15 idosos, cada um com a própria
família) — já suportado tecnicamente e comercialmente órfão.

**O Profissional não tem recurso exclusivo sobre o Família, só capacidade** —
inventar um recurso artificial para justificar o tier seria criar diferença onde ela
não existe no uso real. Detalhamento em [PLANOS.md](PLANOS.md).

---

## 8. Ausência de `NODE_ENV` significa produção — auditoria de 21/08/2026

**Decisão:** a detecção de ambiente é centralizada em
`artifacts/api-server/src/lib/environment.ts`. Só um valor **explícito** de
`development` ou `test` libera atalho de desenvolvimento. Qualquer outra coisa —
inclusive a variável ausente — é tratada como produção.

**Alternativa descartada:** o padrão anterior, `process.env.NODE_ENV !== "production"`.

**Motivo:** `undefined !== "production"` é **verdadeiro**. O deploy do Replit não
define `NODE_ENV`, então o app publicado rodava com cinco proteções desligadas —
incluindo rotas de manipulação do relógio **expostas sem autenticação nenhuma**.
A falha não estava numa linha errada: estava no padrão, replicado em cinco lugares.

Um teste varre o código-fonte e falha se alguém escrever a comparação direta de novo.

---

## 9. Refresh token em `localStorage` — risco aceito, revisão pendente

**Decisão atual:** access token em memória, refresh token em `localStorage`
(comentado em `auth-client.ts`).

**Alternativa preferível:** cookie `httpOnly` + `Secure` + `SameSite`.

**Estado:** `RISCO POTENCIAL` aceito e documentado na auditoria de 21/08/2026, **não
corrigido**. Migrar exige mudar o fluxo de autenticação inteiro — é decisão de
arquitetura, não correção de bug. **Deve ser avaliada antes de haver usuários reais.**

---

## 10. Decisões menores fechadas junto

- **SSE em vez de WebSocket** para a sincronização entre cuidadores. O tráfego é
  unidirecional (servidor → cliente) e SSE reconecta sozinho, sem servidor de socket.
- **Capacitor em vez de Expo**, quando o app nativo chegar (ZELO-42). Reaproveita a base
  React da PWA em vez de manter uma segunda árvore de componentes. O Expo exigiria EAS
  build, device físico e certificados fora do ambiente disponível.

---

## Relação com a especificação original

A [especificação completa](../referencia/ESPECIFICACAO.md) foi escrita **antes** destas decisões.

> **A §3.1 da spec (stack) está superada por este documento.** Todo o resto da spec — regras
> de negócio, LGPD, fronteira clínica, tom do produto — **continua valendo integralmente.**

O motivo da divergência foi economia: a spec assumia um pipeline mobile (React Native + Expo)
que o ambiente de hospedagem não cobre bem, e mantê-la ao pé da letra custaria idas e voltas
fora do ambiente.
