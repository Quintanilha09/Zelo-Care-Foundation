# Por que o ZELO sai do Replit e vai para a AWS

> Escrito em **13/09/2026**, a pedido do fundador, depois de ele perguntar se o Replit ainda era
> necessário. Números em dólar **e** em real, a **R$ 5,13/US$** (cotação medida em 11/09/2026).
>
> Decisão: **AWS Lightsail, região São Paulo (`sa-east-1`)**.
>
> O trabalho está quebrado nas Issues **#193 a #203**.

---

## A pergunta que deu origem a isto

O fundador perguntou:

> *"Quero que você avalie se realmente precisamos do Replit... nem utilizamos mais a IA do Replit,
> somente para criar as telas iniciais. Hoje só utilizamos a infraestrutura. Estou pagando 120 reais
> por mês sendo que não uso a IA."*

O instinto está certo. **A premissa, não** — e o detalhe que ela erra é o que torna a mudança urgente.

## A premissa errada: você não paga pela IA

Os R$ 120 são a assinatura **Core (US$ 25/mês)**, que é um **crédito mensal**, não uma taxa de IA. Esse
crédito cobre IA, computação e publicação, juntos. Não há desperdício por não usar a IA.

O problema é outro, e já estava medido em [ESTRATEGIA-ATE-A-VENDA.md](ESTRATEGIA-ATE-A-VENDA.md):

**produção no Replit não cabe em nenhum orçamento que o fundador tenha hoje.**

| | US$/mês | R$/mês |
|---|---|---|
| O que ele paga hoje (Core) — **ambiente de teste** | 25 | **128** |
| Banco de produção, ligado o mês inteiro | 116,80 | 599 |
| VM reservada (0,5 vCPU) | 15 | 77 |
| **Replit com produção de verdade** | **157** | **R$ 805** |

O banco cobra **por hora ativa**, e ele nunca dorme: o pg-boss consulta a fila a cada 2 segundos. Não é
desperdício — é estrutural, e a alternativa (aumentar o intervalo da fila) atrasaria o lembrete de dose,
que é a única coisa que este produto não pode errar.

**Então sair do Replit não é economizar R$ 120. É a única forma de existir produção.**

---

## Quatro defeitos que a migração conserta, e que já estavam no código

Os três primeiros foram encontrados ao planejar a migração, em 13/09/2026. **O quarto apareceu
depois, trabalhando na #197** — e é o mais grave dos quatro.

Nenhum deles mordeu, e o motivo é o mesmo para todos: produção nunca foi ligada. Todos morderiam
no primeiro usuário real.

### 1. O lembrete de dose não sairia de madrugada

O `.replit` diz `deploymentTarget = "autoscale"`. Autoscale **dorme quando não há tráfego**. E o
`index.ts` sobe o pg-boss **dentro do processo web**, com tarefas a cada 2 e 15 minutos.

Às 3h da manhã, sem ninguém usando o app, o contêiner dorme e **o lembrete não dispara** — justamente
a hora em que ele mais importa.

### 2. O app nem abriria fora do Replit

O servidor **não serve o front**. Medido: não existe `express.static` em lugar nenhum de
`artifacts/api-server/src`. Quem roteia é a plataforma — o `.replit` tem `router = "application"`, e o
Replit manda `/api` para o backend e o resto para o estático.

Fora de lá, `GET /` devolve 404. → **#194**

### 3. O comando de banco de produção oferece apagar o histórico de dose

Rodando `drizzle-kit push` em 12/09/2026, ele perguntou se queria **truncar `scheduled_doses`** — a
tabela do histórico de dose. Um "sim" distraído apaga o registro de todo remédio que toda família já
tomou. → **#198**

### 4. Todo limitador por IP podia ser desligado com um cabeçalho — `VULNERABILIDADE CONFIRMADA`

Encontrado em 14/09/2026, lendo `rate-limit.ts` para escrever a #197. Os limitadores montavam a
chave lendo o `X-Forwarded-For` **cru** e pegando o **primeiro** valor da lista — que é o que o
cliente escreve, não o que o proxy apura.

Medido, com `NODE_ENV=production`, contra o `adminLoginLimiter` (limite 5 por 15 min):

| Cenário | 7 requisições seguidas |
|---|---|
| Mesmo `X-Forwarded-For` forjado | `200 200 200 200 200` **`429 429`** |
| Forjado **diferente a cada vez** | `200 200 200 200 200 200 200` |

A segunda linha é a proteção inteira desligada. Atingia login, cadastro, recuperação de senha,
renovação de sessão e — o pior caso — o **painel operacional**, cujo acesso é uma senha única e
compartilhada e cuja única barreira era esse limite.

O `app.ts` já configurava `trust proxy` desde sempre, e **todo o resto do código já usava
`req.ip`**. O `rate-limit.ts` era o único fora do padrão. → **#207**

**Este é o defeito que mais justifica a preparação ter vindo antes da infraestrutura.** Ele não
tem nada a ver com Replit ou AWS: estava valendo em qualquer lugar onde o produto rodasse, desde
sempre, e não havia como descobri-lo pela tela.

---

## O que o ZELO exige de qualquer casa, medido no código

| Exigência | De onde vem | Quem isso elimina |
|---|---|---|
| Processo **sempre ligado** | pg-boss dentro do app | Vercel, Netlify, Cloudflare Workers |
| Postgres que **nunca dorme** | fila consultada a cada 2 s | o "dormir para economizar" do Neon |
| Backup com **restauração a ponto no tempo** | é histórico de dose | qualquer backup semanal |
| Storage compatível com S3 | `media-storage.ts` | — |
| Conexão longa (SSE) | `realtime.ts`, batimento de 20 s | — |

O batimento de 20 segundos foi conferido: fica abaixo dos 60 s de ociosidade que um balanceador corta.
Passa em qualquer plataforma.

---

## O mercado inteiro, avaliado contra essa lista

| Opção | No Brasil | Banco gerenciado com restauração a ponto | R$/mês |
|---|---|---|---|
| **AWS Lightsail — São Paulo** | ✅ `sa-east-1` | ✅ **7 dias, de 5 em 5 minutos** | **118–133** |
| Render | ❌ EUA/EU/Ásia | ✅ 3 dias | 72 |
| Fly.io São Paulo + banco gerenciado | ✅ | ✅ | 224 |
| Fly.io São Paulo + banco próprio | ✅ | ❌ só cópia diária | 66 |
| Google Cloud São Paulo | ✅ | ✅ | conta imprevisível¹ |
| Supabase São Paulo | ✅ | restauração a ponto custa **US$ 100** | 641 |
| Railway | ❌ | parcial | 77–128 |
| VPS brasileiro | ✅ | ❌ backup semanal | 28 |
| Replit com produção | ❌ | — | **805** |

¹ O Cloud SQL cobra por vCPU e por GB **por hora**, mais **US$ 9,57/mês só pelo IP público ocioso**.
Para quem tem teto de orçamento, conta que não dá para prever é risco por si só.

### Por que o Render, que é mais barato, perdeu

Ele foi a primeira recomendação. Caiu quando o fundador informou um fato que muda o peso de tudo:

> *"Nos primeiros meses e até anos os clientes em sua totalidade estarão no Brasil."*

Com 100% dos usuários no Brasil, cada conexão paga ~3 idas e voltas até Oregon antes do primeiro byte
— ~450 ms de abertura, contra ~60 ms para São Paulo. Num quarto com uma barra de sinal às 3h da manhã,
isso aparece.

E **todo** registro de saúde vira transferência internacional, que sob a LGPD exige base legal
declarada. Não é impossível; é papel que ele teria de fazer, sem DPO, para um dado que a lei trata
como **sensível**.

### Por que o Fly.io, que eu havia recomendado, caiu

Foi recomendado por ter região em São Paulo. Caiu por duas razões:

1. **O banco gerenciado deles custa US$ 38/mês** — só o banco já estoura o teto. A alternativa era
   rodar Postgres em máquina própria, sem redundância e sem restauração a ponto no tempo.
2. O fundador respondeu: *"eu nunca ouvi falar do Fly."* Para um produto que vai ser **vendido**,
   apostar num fornecedor que o comprador também não conhece é risco sem contrapartida.

---

## Por que a AWS é a melhor opção

### O preço, detalhado

| Item | US$/mês | R$/mês |
|---|---|---|
| Lightsail Container Service — Micro (1 GB, 1 nó, sempre ligado) | 10 | 51 |
| Lightsail Managed Database — Postgres Standard (1 GB, 40 GB SSD) | 15 | 77 |
| Bucket S3 — mídia e backup | ~1 | ~5 |
| **Total** | **~26** | **~R$ 133** |

Com o contêiner Nano (512 MB), cai para **US$ 23 · R$ 118**. Recomendo começar no Micro: a geração do
PDF do relatório come memória em picos, e não foi medida. Se couber no Nano, são R$ 15 de volta.

**Comparação honesta:**

| | R$/mês | Produção incluída? |
|---|---|---|
| Hoje (Replit Core) | 128 | **não** |
| **AWS Lightsail São Paulo** | **118–133** | **sim** |
| Replit com produção | 805 | sim |

**Praticamente o mesmo que ele já paga — com produção de verdade incluída.**

### Os sete motivos, um a um

**1. Robustez.** É AWS. Não é aposta em ninguém, não é fornecedor que pode ser comprado ou fechar.

**2. Backup, que é o que mais importa para dado de saúde.** O banco gerenciado faz cópia automática com
**7 dias de retenção e restauração a qualquer ponto de 5 em 5 minutos**. É a melhor garantia de toda a
tabela acima — melhor que os 3 dias do Render e incomparável com backup semanal de VPS.

**3. Segurança operacional.** Banco gerenciado significa que ninguém aplica correção de sistema, renova
certificado ou configura firewall à mão. O tempo do fundador é o recurso mais escasso do projeto, e
sysadmin não é onde ele deve gastá-lo.

**4. Latência.** São Paulo. ~60 ms em vez de ~450 ms de abertura de conexão.

**5. LGPD.** Dado de saúde de brasileiro fica no Brasil. Some a necessidade de declarar transferência
internacional, e some a pergunta constrangedora quando um comprador hospitalar perguntar onde os dados
moram.

**6. Custo previsível.** Preço fixo por mês, confirmado na página oficial como **igual na região de São
Paulo**. Sem medição por hora, sem susto na fatura — que foi exatamente o que tornou o Replit inviável.

**7. Na hora da venda.** O comprador herda uma conta AWS. Isso é um não-assunto numa diligência. E se
o produto crescer, Lightsail é AWS por baixo: migrar para ECS e RDS é caminho nativo, não mudança de
casa.

---

## O que a migração exige — Issues #193 a #209

> Situação medida em **24/09/2026**. Duas Issues nasceram durante o trabalho e não estavam no
> plano original: a **#207** (a vulnerabilidade acima) e a **#209** (um teste instável meu).

### Preparar o código (não depende da AWS existir)

| # | O quê | Por quê | Situação |
|---|---|---|---|
| [#193](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/193) | Armazenamento de mídia no S3 | é o **único** acoplamento real ao Replit | ✅ PR #204 |
| [#194](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/194) | O servidor passa a servir o front | sem isso o app não abre fora do Replit | ✅ PR #205 |
| [#195](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/195) | Dockerfile e imagem de produção | o Lightsail recebe uma imagem | ✅ PR #208 |
| [#196](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/196) | O `healthz` não pode reiniciar o app quando o banco pisca | defeito encontrado ao planejar | ✅ PR #206 |
| [#197](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/197) | Um nó só, e dito por quê | **três** consequências, não uma — ver abaixo | ✅ PR #211 |
| [#207](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/207) | O limitador por IP aceitava o `X-Forwarded-For` do cliente | `VULNERABILIDADE CONFIRMADA` | ✅ PR #210 |
| [#209](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/209) | Teste instável: corrida entre o pino e o resultado | reprovava **qualquer** PR no CI | ✅ nos PRs #208 e #210 |
| [#198](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/198) | Migrações de verdade | o `push` ofereceu truncar o histórico de dose | ⏳ pendente |
| [#199](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/199) | `pg_dump` de hora em hora para o S3 | backup **fora** do fornecedor | ⏳ pendente |

#### A #197 cresceu, e o plano dela estava errado

A Issue conhecia **uma** consequência de subir a escala (o limitador dobra). Verificando o código
para escrever o runbook, apareceram mais duas:

2. **`realtime.ts` guarda o pub/sub num `EventEmitter` em memória.** Com dois nós, uma cuidadora
   ligada ao nó A não recebe a dose registrada pela irmã pelo nó B — a tela dela segue mostrando
   pendente. Num produto em que duas pessoas cuidam do mesmo idoso, é caminho para dose repetida.
3. **`closeConnectionsForUser` só enxerga o mapa do próprio processo.** Revogar o acesso de um
   cuidador pelo nó A não fecha a conexão SSE que ele tem aberta no nó B: ele continua recebendo
   nome de medicamento e situação de dose até a conexão cair sozinha. **Encosta no invariante 2.**

Isso corrige a alternativa futura que a própria Issue propunha: **não** é "mover o contador para o
Postgres". São três mudanças (contador no Postgres, `LISTEN`/`NOTIFY` no lugar do `EventEmitter`, e
a mesma `NOTIFY` para a revogação). Fazer só a primeira é pior que hoje, porque parece resolvido.
Sessão fixa não substitui nenhuma. Ver [runbooks/escala-do-servico.md](../runbooks/escala-do-servico.md).

### A infraestrutura

| # | O quê | Situação |
|---|---|---|
| [#200](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/200) | Provisionar a AWS em São Paulo: contêiner, banco, bucket, IAM, MFA, alarme de custo | 🔨 em andamento |
| [#201](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/201) | Esteira de deploy pelo GitHub Actions | ⏳ pendente |

Da #200, em 24/09/2026: conta criada, **MFA na raiz e no usuário administrativo**, alarme de custo
em US$ 40, região `sa-east-1` fixada, e o serviço de contêiner `zelo` (Micro, **1 nó**) criado.
Faltam o banco, o bucket, a credencial do app e o checkpoint do modo privado.

### O corte

| # | O quê | Situação |
|---|---|---|
| [#202](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/202) | Domínio, TLS, as 19 variáveis de ambiente e a ordem do corte | ⏳ pendente |
| [#203](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/203) | Tirar o Replit do código | ⏳ pendente, e **agora sem espera** |

### O que já estava preparado

O acoplamento ao Replit é **muito menor do que parece**. O `media-storage.ts` foi escrito prevendo este
dia, e o comentário no topo dele diz:

> *"O comprador pode não usar Replit. Trocar por S3 ou GCS deve ser escrever uma classe, não caçar
> chamadas espalhadas pelas rotas."*

Fora essa classe e três plugins de desenvolvimento do Vite, **nada mais no código conhece o Replit**.
Toda configuração já passa por `process.env`.

---

## Faça enquanto o banco está vazio

O banco de produção **não tem nenhum dado**. Migrar agora custa nada: cria-se o esquema no banco novo e
aponta-se o domínio.

Migrar depois, com o histórico de dose de famílias reais dentro, é uma madrugada de janela anunciada,
despejo, restauração e conferência tabela por tabela — em que cada minuto perdido é uma dose que alguém
registrou e sumiu.

**A janela barata é esta, e ela fecha no dia do primeiro usuário real.**

---

## O Replit foi cancelado em 24/09/2026, antes de a AWS servir

E isso contraria o que este documento e a #203 diziam — **"só depois de 7 dias servindo"**. A
mudança não foi de opinião: foi a correção de um erro de premissa meu.

### O que eu recomendei, e por que estava errado

Quando o fundador perguntou quando poderia cancelar, eu respondi com sete condições e uma espera de
sete dias: domínio apontado, backup restaurado, tráfego zerado, mídia migrada, e um alerta forte de
que **trocar as chaves VAPID invalidaria todas as inscrições de notificação**.

Ele empurrou de volta: não queria pagar os dois. Fui então verificar, e a resposta já estava escrita
no próprio repositório:

> `CONTEXT.md`: *"**Desenvolvimento apenas.** O banco de produção está **vazio e pausado** por
> limite de gasto"* · *"…não haver usuário real"*

**Aquela lista é o procedimento para desligar uma produção viva. O ZELO não tinha uma.** Cada razão
que eu dei dependia de usuários que não existiam:

| O que eu disse | Por que não valia |
|---|---|
| Trocar as chaves VAPID invalida as inscrições | não havia **nenhuma** inscrição |
| Trocar o `SESSION_SECRET` desloga todo mundo | não havia ninguém logado |
| Sete dias servindo antes de cortar | nada estava sendo servido a ninguém |
| Tráfego zerado por vários dias | o tráfego já era zero |

**A pergunta que faltava era mais simples que a checklist: *alguém está usando isto?*** Eu tinha
acesso ao `CONTEXT.md` antes de recomendar a espera, e não olhei.

### O que sobrou de verdade, e foi feito

1. **Os oito segredos que importam**, copiados para fora do Replit — `ADMIN_PANEL_SECRET`,
   `ANTHROPIC_API_KEY`, `GOOGLE_CLIENT_ID`/`SECRET`, `GOOGLE_MAPS_API_KEY`, `RESEND_API_KEY`,
   `SESSION_SECRET` e o trio `VAPID_*`. Os outros quatro (`APP_URL`,
   `DEFAULT_OBJECT_STORAGE_BUCKET_ID`, `PRIVATE_OBJECT_DIR`, `PUBLIC_OBJECT_SEARCH_PATHS`) são
   específicos do Replit e morrem com ele.
2. **Nenhum domínio próprio apontava para lá.** O acesso era por `*.replit.dev`, o endereço do
   workspace de desenvolvimento.
3. **16 fotos de teste** no Object Storage, em `.private/zelo-midia/image/`, ~1,7 MB. Descartadas:
   ficariam órfãs no instante em que o banco novo subisse vazio, e dado de teste é reproduzível
   pelo `seed`.

### O que isso custa

**Não há ambiente publicado até a #201.** Enquanto isso, o app roda localmente — foi provado em
14/09/2026, com a imagem de produção servindo o front, a API e gerando PDF dentro do contêiner.

`EMAIL_FROM` nunca existiu nos Secrets, e não precisava: `email.ts` tem o padrão
`"ZELO <contato@zelocuida.com.br>"`. O que falta para o e-mail sair é o domínio verificado no
Resend, que é item da #202.

---

## Riscos aceitos, e o que NÃO foi verificado

`RISCO POTENCIAL:` o banco **Standard** não tem réplica. Se a instância cair, há indisponibilidade até
ela voltar — os dados não se perdem, porque o backup contínuo segue. A versão com redundância custa o
dobro (US$ 30) e é um clique quando houver receita.

`NÃO VERIFICADO:`

1. **Se 512 MB bastam.** Por isso a recomendação é o Micro de 1 GB. A geração de PDF não foi medida.
2. **O preço do pacote de Object Storage** do Lightsail. Estimado entre US$ 1 e US$ 5 no volume atual.
3. **Se `trust proxy` com valor 1 é o certo** atrás do balanceador do Lightsail. Hoje o `app.ts`
   confia em exatamente um salto, e desde a **#207 isso importa mais**: o limitador de taxa passou
   a usar `req.ip`, que é calculado a partir desse número. Alto demais reabre a #207; baixo demais
   faz o Brasil inteiro dividir um balde de limite. **Precisa ser conferido no ambiente real antes
   do corte** — é item de aceite da #202, e está comentado no `app.ts`.
4. **Que o balanceador seja o único caminho até o contêiner.** A correção da #207 depende disso:
   uma requisição que chegue **sem** passar pelo balanceador tem seu único `X-Forwarded-For`
   tratado como legítimo, e a falha reabre. Não se resolve no código — é topologia de rede, e está
   anotado como item de aceite da **#200**.
5. **Se o serviço de contêiner alcança o banco gerenciado em modo privado.** A documentação da AWS
   é ambígua: a página do modo público diz "acessível apenas por *instâncias* Lightsail", e serviço
   de contêiner não é instância; já o tutorial oficial que conecta os dois não manda ligar o modo
   público. `NÃO VERIFICADO` — virou o primeiro checkpoint da #200, de propósito, porque a
   alternativa (ligar acesso público e proteger por senha e TLS) mudaria o desenho da #200 e da #202.
6. **Nenhum número de desempenho.** Nada foi medido em ambiente AWS ainda, porque ele não existe.

---

## O que fica de lição, independente de fornecedor

Duas coisas neste repositório previram esta migração e acertaram, e é por isso que ela é barata:

1. **A interface de armazenamento de mídia**, escrita em vez de chamadas diretas ao fornecedor.
2. **A regra de nunca escrever `process.env.NODE_ENV !== "production"`**, nascida de um defeito real no
   deploy do Replit — em que a ausência da variável deixou cinco proteções desligadas em produção.

Fornecedor muda. A lição fica. Por isso a #203 manda apagar o código do Replit e **manter os
comentários que explicam por quê**.

### E três que a execução acrescentou

3. **Tirar o produto de uma plataforma é auditá-lo.** Dos quatro defeitos consertados, só um era
   sobre o Replit. Os outros três — o `healthz` que derrubaria o app, a escala que quebra três
   coisas em silêncio, e o limitador que qualquer um desligava com um cabeçalho — estavam ali
   independentemente de fornecedor. A migração foi o motivo de alguém ler o código com atenção.

4. **Suposição escrita em comentário não protege ninguém.** O `realtime.ts` dizia
   *"este serviço roda como um único processo (sem múltiplas instâncias hoje)"* desde que foi
   escrito, e estava certo. Mas a escala do serviço é um seletor de número numa tela de console, e
   quem clica nele não abre o arquivo. Suposição que sustenta uma garantia precisa viver onde a
   decisão é tomada — daí o runbook.

5. **"Espere para ter certeza" soa prudente e às vezes é só caro.** A recomendação de manter o
   Replit por mais sete dias custava R$ 120 e protegia contra riscos que não existiam. A pergunta
   que teria evitado isso não era técnica: *alguém está usando isto?* — e a resposta já estava no
   `CONTEXT.md`, verificável em dez segundos, antes da recomendação.
