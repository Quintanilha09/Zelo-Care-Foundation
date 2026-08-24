# CONTEXT — Fase 01: Fundação e Guardrails

> Artefato GSD. Saída da etapa **Discuss**. Decisões de implementação capturadas antes de planejar.
> **Data:** 16/08/2026

---

## Decisões de plataforma (herdadas — raciocínio completo)

Estas quatro decisões foram tomadas em conversa com o fundador em 16/08/2026, cada uma com alternativa explicitamente descartada.

### 1. PWA + Web Push, no lugar de React Native + Expo
**Alternativa descartada:** Expo/React Native puro.
**Por quê:** Expo exige EAS build, device físico e certificados APNs/FCM — grande parte do ciclo de teste acontece **fora do Replit**, e cada volta consome crédito sem produzir produto verificável dentro da sessão. Uma PWA com Web Push cobre Android e desktop nativamente, e iOS a partir da versão 16.4 com o app na Tela de Início. Todo o ciclo de build, teste e deploy fica dentro do Replit.
**Consequência aceita:** iOS exige onboarding específico (adicionar à Tela de Início) e a taxa de entrega pode ser inferior à do Android no início. Mitigado com tela de orientação dedicada (ZELO-26) e painel de monitoramento por plataforma (ZELO-32). Gatilho objetivo definido para migrar a nativo (ZELO-42): entrega no iOS consistentemente abaixo de 95%.

### 2. pg-boss sobre o Postgres, no lugar de Redis + BullMQ
**Alternativa descartada:** Redis externo (Upstash) + BullMQ.
**Por quê:** Redis gerenciado não existe no Replit — exigiria serviço externo, mais um segredo, mais latência de rede entre serviços, e principalmente **consistência eventual entre banco e fila**: a dose podia ser gravada e o job de agendamento falhar de forma independente. Com pg-boss no mesmo Postgres, a inserção da dose e o agendamento do job entram na **mesma transação SQL** — impossível existir dose sem job ou job sem dose. Isso resolve por construção o requisito central da spec (§3.3): "doses persistidas no banco, nunca dependendo apenas de timer em memória."
**Consequência aceita:** pg-boss tem throughput menor que Redis puro em volumes muito altos. Irrelevante na escala do MVP (uma família gera dezenas de doses por dia, não milhares por segundo).

### 3. Claude Vision API para extração de receita
**Alternativa descartada:** OCR (Google Cloud Vision ou Tesseract) + parser de posologia próprio.
**Por quê:** Uma chamada de visão devolve OCR **e** interpretação estruturada da posologia no mesmo passo. Construir um parser de posologia em português (frequências, intervalos, dias alternados, ciclos com pausa) é o trabalho realmente caro nessa story, e a Vision API o absorve. Custo por foto é baixo e o dado não fica retido em serviço de OCR de terceiro com política de retenção obscura.
**Consequência aceita:** dependência de disponibilidade da API Anthropic para essa feature específica. Fallback manual (ZELO-16) sempre visível cobre a indisponibilidade.

### 4. Cobrança pela web, fora das lojas
**Consequência direta da decisão 1.** Sendo PWA, não existe in-app purchase e a comissão de 15–30% das lojas não se aplica. Precisa ser preservada quando o app nativo (ZELO-42) chegar: a assinatura continua na web mesmo depois de existir wrapper nativo.

---

## Decisões técnicas desta fase

### Testes — Vitest
**Alternativa descartada:** Jest.
**Por quê:** nativo ESM, mais rápido em TypeScript sem configuração de transform adicional, watch mode eficiente. Jest exige mais configuração para o mesmo resultado em projeto ESM/TS.

### Logger — Pino
**Alternativa descartada:** Winston.
**Por quê:** JSON estruturado nativo, alta performance, e principalmente **redação de campos como opção nativa** (`redact`), o que resolve o invariante "logs sem PII" com configuração declarativa — uma allowlist expressa como caminho de campos a redigir — em vez de um wrapper de log customizado que alguém pode esquecer de chamar.
**Abordagem de redação:** allowlist, não denylist. Um campo novo e desconhecido é redigido por padrão. Denylist falha para o lado perigoso — campo novo esquecido vaza até alguém lembrar de proibir.

### Regra de lint contra relógio direto
`eslint.config` com `no-restricted-syntax` proibindo `new Date()` e `Date.now()` fora de `shared/clock.ts`, `shared/clock.test.ts` e arquivos de configuração de teste. Quebra o build, não é apenas aviso.

### PWA — vite-plugin-pwa para o boilerplate, service worker de push escrito à mão
`vite-plugin-pwa` resolve manifest, ícones e registro do service worker. A lógica de `push` e `notificationclick` (ZELO-26 em diante) é escrita manualmente dentro do service worker gerado, porque o plugin não cobre isso e a lógica de registro de dose em um toque é específica do produto.

---

## Ordem de execução dentro da fase

```
ZELO-1 (constituição, sem código)
  └─ ZELO-2 (scaffold)
       ├─ ZELO-3 (design system)   ─┐  independentes entre si,
       └─ ZELO-4 (schema)          ─┘  mas mesma sessão de Replit — sequencial na prática
            └─ ZELO-5 (relógio + seed)
```

Embora ZELO-3 e ZELO-4 não dependam uma da outra, a execução acontece em uma única sessão manual do Replit Agent, não em subagentes paralelos do GSD — a ordem sequencial evita dois fluxos de edição concorrentes no mesmo Repl.

## Riscos identificados nesta fase

- **Conexão Drizzle ↔ Postgres do Replit**: confirmar que a `DATABASE_URL` do Replit funciona sem SSL customizado antes de escrever a primeira migration.
- **`vite-plugin-pwa` em modo dev**: o service worker frequentemente não ativa em `npm run dev` por padrão — validar que `/dev/design` (ZELO-3) e os testes não dependem de push estar ativo nesta fase (não deveriam; push só entra na fase 06).
