# RUNBOOK — Publicar, e voltar atrás

> Issue #201. Escrito em 28/09/2026.
>
> **Quem abrir isto às três da manhã precisa de duas coisas:** saber em que estado o sistema
> está, e um comando que funcione. As duas primeiras seções respondem isso. O resto explica
> por quê, e pode esperar.

---

## Em uma tela: o que acontece a cada commit no `main`

```
commit no main
      │
      ▼
  Validate ── typecheck+lint+build ─┐
             testes de servidor ────┤  os três, verdes
             testes de tela ────────┘
      │
      ▼  (só se os três passaram)
  Publicar
      │
      ├─ 1. constrói a imagem
      ├─ 2. envia a imagem para o registro do serviço `zelo`
      ├─ 3. MIGRA o banco, de dentro da AWS      ← falhou aqui? nada muda. Fim.
      ├─ 4. PUBLICA a versão nova do app
      └─ 5. VERIFICA /api/healthz e /api/readyz  ← falhou aqui? avisa, e NÃO volta sozinho.
```

Duas garantias, e só duas:

1. **Migração que falha não publica nada.** A versão que está no ar continua servindo, com o
   esquema que ela conhece. Ninguém percebe.
2. **A esteira nunca volta atrás sozinha.** Se o passo 5 falhar, ela grita e para. Voltar é
   decisão de gente — a seção "Voltar para a versão anterior" explica por quê.

---

## Voltar para a versão anterior

### Antes de fazer, leia estas cinco linhas

**Voltar a versão do app NÃO desfaz a migração do banco.** As duas coisas andaram juntas, mas só
uma volta. O app antigo vai encontrar o esquema novo.

Isso funciona **enquanto as migrações forem aditivas** — coluna nova, tabela nova, valor de enum
novo. O app antigo ignora o que não conhece. Deixa de funcionar no dia em que uma migração
**remover** ou **renomear** algo que o app antigo lê. Ver "A regra que torna a volta segura", mais
abaixo.

### Pelo console — é o caminho mais curto

1. Console do Lightsail → **Containers** → serviço **`zelo`** → aba **Deployments**.
2. Anote o nome da imagem da versão que **estava boa** — é algo como `:zelo.app.11`. As versões
   aparecem em ordem, com data.
3. Clique em **Modify your deployment**.
4. No campo **Image**, troque o nome pelo da versão boa. **Não toque em mais nada** — variáveis de
   ambiente, porta e verificação de saúde ficam como estão.
5. **Save and deploy**.

O que esperar: o serviço entra em *Deploying*, e depois de alguns minutos a versão anterior volta
a aparecer como *Active*.

### Pela linha de comando

```bash
export AWS_PAGER=""

aws lightsail get-container-service-deployments \
  --service-name zelo --region sa-east-1 > deployments.json

# Que versões existem, e qual imagem cada uma usa
jq -r '.deployments[] | "\(.version)\t\(.state)\t\(.containers | to_entries[0].value.image)"' deployments.json
```

> ⚠ **`deployments.json` tem as variáveis de ambiente com os valores dentro** — senha do banco,
> chave do Resend, segredo de sessão. Não cole esse arquivo em lugar nenhum, e apague quando
> terminar. O comando acima imprime só versão, estado e imagem, de propósito.

Escolha a versão e reenvie a especificação dela, sem mudar nada:

```bash
VERSAO=11

jq --argjson v "$VERSAO" '.deployments[] | select(.version == $v) | .containers' \
  deployments.json > containers-volta.json
jq --argjson v "$VERSAO" '.deployments[] | select(.version == $v) | .publicEndpoint' \
  deployments.json > endpoint-volta.json

aws lightsail create-container-service-deployment \
  --service-name zelo --region sa-east-1 \
  --containers file://containers-volta.json \
  --public-endpoint file://endpoint-volta.json > /dev/null

rm -f deployments.json containers-volta.json endpoint-volta.json
```

Conferir que voltou:

```bash
aws lightsail get-container-services --service-name zelo --region sa-east-1 \
  | jq -r '.containerServices[0] | "\(.state)  versao \(.currentDeployment.version)  \(.url)"'
curl -sS -o /dev/null -w '%{http_code}\n' "$(aws lightsail get-container-services \
  --service-name zelo --region sa-east-1 | jq -r '.containerServices[0].url')api/readyz"
```

### Quanto tempo leva

`NÃO VERIFICADO` — **nenhuma volta atrás foi executada até hoje**, porque o serviço ainda não teve
uma primeira publicação.

O que dá para afirmar: a volta **não constrói imagem e não envia imagem**. Ela só pede ao Lightsail
que suba de novo uma imagem que já está no registro dele. O tempo é, inteiro, o tempo de o
Lightsail trocar o contêiner — o mesmo do passo 4 de um deploy normal, sem os passos 1 e 2, que
são os longos.

O teto que a esteira aceita para uma publicação ficar ativa é de **25 minutos**, e isso é um teto
escolhido, não uma medição.

> **Meça na primeira vez e escreva aqui.** Cronômetro do clique em *Save and deploy* até o
> `curl` do `/api/readyz` responder 200. Esse número é o que alguém vai precisar saber num dia
> ruim, e ninguém consegue deduzi-lo.

---

## Quando a migração falha

### Em que estado o sistema está

| | |
|---|---|
| O app | **na versão antiga, servindo normalmente.** Nada foi publicado |
| O banco | **exatamente como estava.** Ver abaixo: é tudo ou nada |
| A esteira | vermelha, parada no passo 3 |
| Quem usa o app | não percebeu nada |

**A migração é tudo ou nada, e isso foi lido no código** (`drizzle-orm@0.45.2`,
`pg-core/dialect.cjs`, linha 62): todas as migrações pendentes rodam dentro de **uma única
transação**. Se a última falhar, o Postgres desfaz as anteriores junto. Não existe "meia
migração".

> **A exceção que existe, e é preciso conhecer:** comando que o Postgres **recusa dentro de
> transação** — `CREATE INDEX CONCURRENTLY` é o caso clássico. Uma migração com um desses falha
> sempre, em qualquer ambiente, e a mensagem diz isso. Não escreva migração assim sem tratar o
> caso à parte.

### O que fazer

1. **Leia o log.** A esteira imprime o log inteiro do contêiner de migração no passo
   "Esperar a migração dizer se deu certo". A linha do erro está lá.
2. **Conserte para a frente.** Um commit novo no `main` refaz o ciclo inteiro. Não há nada para
   limpar antes: o banco não mudou.
3. **Não rode migração da sua máquina.** O `zelo-db` é privado e recusa conexão de fora — nem a
   máquina de quem desenvolve, nem o runner do GitHub Actions o alcançam. Medido na #198.
4. **Não ligue o modo público do banco.** É a saída tentadora e errada: banco de saúde exposto à
   internet, mesmo por minutos, é varrido por robô. E reabriria o risco da #207, que depende de o
   balanceador ser o único caminho de entrada.

## Quando a migração passou mas o app não subiu

É o estado mais incômodo que esta esteira consegue produzir: **esquema novo, app antigo**. Acontece
se o Lightsail recusar ou reprovar o deployment do app depois de a migração ter dado certo.

| | |
|---|---|
| O app | **na versão antiga**, servindo |
| O banco | **já migrado** |
| A esteira | vermelha, no passo "Publicar" ou "Esperar a versão nova ficar ativa" |

**Isso é seguro enquanto a migração for aditiva** — e a seção "A regra que torna a volta segura",
mais abaixo, é justamente o que garante isso. O app antigo ignora coluna que não conhece.

**O que fazer:** nada de urgente. Leia o log do contêiner no passo que falhou (a esteira imprime as
últimas 60 linhas), conserte, e mande outro commit. A migração seguinte verá que não há nada a
aplicar e seguirá direto para a publicação.

**O que NÃO fazer:** voltar o banco. Não há caminho de volta para migração neste projeto, por
decisão — ver a regra aditiva. Desfazer um esquema à mão em produção é como se perde dado de dose.

### Se precisar migrar à mão, sem passar pela esteira

Exemplo: consertar um dado, ou aplicar uma migração isolada. O caminho é o **mesmo** que a esteira
usa — um deployment descartável — e ele existe justamente para não haver um segundo caminho.

```bash
export AWS_PAGER=""

# 1. Pegar a especificação que está no ar, para herdar o ambiente
aws lightsail get-container-services --service-name zelo --region sa-east-1 > servico.json
jq '.containerServices[0].currentDeployment.containers.zelo.environment' servico.json > ambiente.json
IMAGEM=$(jq -r '.containerServices[0].currentDeployment.containers.zelo.image' servico.json)

# 2. Montar um contêiner que só migra
jq -n --arg img "$IMAGEM" --argjson amb "$(cat ambiente.json)" \
  '{ migracao: { image: $img, command: ["node","./dist/migrar.mjs"], environment: $amb } }' \
  > containers-migracao.json

# 3. Disparar (sem ponto público: não atende ninguém)
aws lightsail create-container-service-deployment \
  --service-name zelo --region sa-east-1 \
  --containers file://containers-migracao.json > /dev/null

# 4. Ler o resultado
aws lightsail get-container-log --service-name zelo --region sa-east-1 \
  --container-name migracao | jq -r '.logEvents[].message'

rm -f servico.json ambiente.json containers-migracao.json
```

Procure `ZELO-MIGRACAO-OK` no log. **Depois disso, publique o app de novo** — o deployment de
migração termina e o Lightsail volta a versão anterior, mas o certo é fechar o ciclo pela esteira
(um commit) ou pelo console.

---

## Por que a migração roda num deployment descartável

Duas restrições que, juntas, não deixam alternativa.

**1. A migração precisa rodar de dentro da AWS.** O `zelo-db` está com `Public mode: disabled`.
Só recurso Lightsail da mesma região o alcança — foi medido na #200, com um
`pg_isready` disparado de um deployment de teste:

```
[24/set./2026:04:11:03] ls-….sa-east-1.rds.amazonaws.com:5432 - accepting connections
```

**2. Mas não pode rodar no contêiner do app, no boot.** Hoje a escala é 1; se alguém a subir para
2, dois processos migram ao mesmo tempo. Proteção que depende de ninguém clicar num seletor não é
proteção. (Ver [escala-do-servico.md](escala-do-servico.md).)

Sobra uma forma: um deployment que só migra, disparado pela esteira antes do deployment do app.

### Por que ele "falha", e por que isso é o certo

O contêiner de migração roda, imprime o resultado e **morre**. Para o Lightsail, contêiner que
termina é deployment que falhou — e deployment que falha **não substitui o que está no ar**.

Isso é a garantia número 1 lá do topo, e ela sai de graça: o app antigo segue servindo o tempo
inteiro, sem ninguém ter de orquestrar nada.

> `HIPÓTESE` — e é a hipótese em que esta esteira se apoia. Que o deployment anterior continua
> servindo enquanto o descartável é tentado é o comportamento documentado do Lightsail, e **não
> foi medido por ninguém deste projeto**. A #200 mediu que um deployment de teste roda e escreve
> log, num serviço que ainda não tinha nada no ar — o caso de haver algo no ar nunca aconteceu.
> **A primeira publicação real é quem verifica isso**, e a forma de verificar está em "O que ainda
> não foi medido".

### O resultado é a linha no log, não o estado do deployment

Como o deployment sempre acaba em *Failed*, o estado dele não diz nada. A esteira procura no log
uma de duas marcas, impressas por `artifacts/api-server/src/migrar.ts`:

| Marca | Significa |
|---|---|
| `ZELO-MIGRACAO-OK` | terminou; o banco está no esquema desta imagem |
| `ZELO-MIGRACAO-FALHOU` | não terminou; **não publique app novo** |

**Silêncio é falha.** Se em 20 minutos nenhuma marca aparecer, a esteira para. Um contêiner que
morre antes de imprimir qualquer coisa nunca vira "deu certo".

Um teste trava esse contrato: `escala-do-servico.test.ts` falha se o texto das marcas deixar de
bater entre o script e o workflow.

---

## Nenhum segredo do app mora no GitHub

A esteira **não carrega** as variáveis de ambiente do app. Ela lê o deployment que está no ar,
**troca só o campo `image`**, e devolve.

As 19 variáveis (#202) foram postas uma vez no console e ficam lá. Três consequências:

1. Não há segredo do ZELO nos *Secrets* do repositório — só o ARN do papel da AWS.
2. O `DATABASE_URL` que a migração usa é, literalmente, o mesmo do app. Não existe um segundo
   caminho até o banco, que era o pedido explícito da Issue.
3. A esteira **não consegue** mudar configuração de produção por acidente, porque ela não escreve
   configuração nenhuma.

O preço: **a primeira implantação é manual**, no console, e é ela que define o ambiente. Sem ela,
a esteira para e diz isso com todas as letras. O passo a passo está em
[preparar-a-esteira-na-aws.md](preparar-a-esteira-na-aws.md).

### E o log, não vaza?

Três camadas, e a terceira existe porque as duas primeiras dependem de alguém lembrar:

1. **Nada é impresso de propósito.** O log mostra nomes de variável, números de versão e estados.
2. **Toda chamada à AWS que devolve o deployment é redirecionada para arquivo**, e nenhum desses
   arquivos é impresso. `get-container-services` e `create-container-service-deployment` devolvem
   as variáveis **com os valores dentro** — um `aws …` sem redirecionamento imprimiria a senha do
   banco num log público.
3. **Todo valor herdado com mais de 8 caracteres é marcado com `::add-mask::`.** O GitHub passa a
   substituí-lo por `***` em qualquer lugar do log, inclusive numa mensagem de erro que ninguém
   previu. O corte em 8 é deliberado: mascarar `5000` ou `true` tornaria o log ilegível sem
   proteger nada.

A camada 2 tem teste: `escala-do-servico.test.ts` lê o workflow e falha se alguma dessas chamadas
deixar de redirecionar a saída. **Verificado por mutação em 28/09/2026:** removendo um `>` do
workflow, o arquivo passou de 9 casos verdes para 8 verdes e 1 vermelho — ou seja, o guardrail
reprova de verdade, e não por falta de coisa para olhar.

---

## A regra que torna a volta segura: migração aditiva

A ordem é migrar → publicar. Isso quer dizer que, entre um passo e outro, **o esquema novo é
servido pelo código antigo** — e, se houver uma volta atrás, ele será servido pelo código antigo
de novo, por tempo indeterminado.

Daí a regra:

> **Toda migração precisa funcionar com a versão anterior do app rodando em cima dela.**

Na prática:

| Pode, sempre | Só em duas etapas, com um deploy entre elas |
|---|---|
| criar tabela | apagar tabela |
| criar coluna **aceitando nulo** | apagar coluna |
| criar valor de enum | renomear coluna ou tabela |
| criar índice | criar coluna `NOT NULL` sem valor padrão |

O jeito de fazer as da direita é sempre o mesmo, e tem nome: **expande, depois contrai.**

1. Deploy A — cria o novo, mantém o velho, o código escreve nos dois.
2. Deploy B — o código passa a ler só o novo.
3. Deploy C — a migração apaga o velho.

Entre A e B, e entre B e C, voltar atrás é seguro. Sem isso, **voltar o app quebra o app**, e
ninguém descobre isso na hora boa.

As quatro migrações que existem hoje (`lib/db/migrations/`) são todas aditivas.

---

## O que ainda não foi medido

`NÃO VERIFICADO`, e cada linha diz quem pode resolver e como:

| O quê | Como verificar | Quem |
|---|---|---|
| **Que um commit no `main` publica sozinho** | fazer o primeiro commit no `main` depois de o workflow chegar lá, e olhar a aba Actions | esteira, na primeira execução |
| **Que o app antigo continua servindo durante o deployment de migração** | manter `curl <url>/api/healthz` num laço de 2 em 2 segundos durante um deploy, e contar as falhas | fundador, num deploy real |
| **Quanto tempo leva uma volta atrás** | cronômetro, do *Save and deploy* ao `readyz` responder 200 | fundador, na primeira volta |
| **Que o `get-container-services` devolve as variáveis de ambiente com valores** | o comando de conferência em [preparar-a-esteira-na-aws.md](preparar-a-esteira-na-aws.md), passo 7 — ele imprime só os NOMES | fundador, 1 minuto |
| **Quanto tempo o Lightsail leva para desistir de um deployment que falha** | olhar o histórico de deployments depois do primeiro deploy | fundador |

O que **foi** medido, em 28/09/2026, e está registrado no PR da #201: a imagem constrói com as
migrações dentro, o comando de migração aplica o esquema num Postgres vazio, e o caminho do
`drizzle-kit migrate` (CI) e o do `dist/migrar.mjs` (produção) contabilizam as mesmas migrações.

---

## O que cada campo de `deploy/lightsail.json` significa

O arquivo é **dado**, e quem o lê são duas coisas: o workflow e o teste
`escala-do-servico.test.ts`. Ele existe para que mudar infraestrutura seja um commit revisado, e
não um clique lembrado.

| Campo | O que é | O que acontece se estiver errado |
|---|---|---|
| `regiao` | `sa-east-1` — São Paulo | a esteira fala com a região errada e não acha o serviço |
| `servico` | nome do serviço de contêiner: `zelo` | idem |
| `container` | nome do contêiner **dentro** do deployment: `zelo` | a esteira para e lista os nomes que encontrou |
| `rotuloDaImagem` | `app` — o rótulo com que a imagem é registrada (`:zelo.app.N`) | a esteira não acha a imagem que acabou de enviar |
| `containerDaMigracao` | `migracao` — o nome do contêiner descartável | a esteira lê o log do contêiner errado e nunca vê a marca |
| `comandoDaMigracao` | `["node", "./dist/migrar.mjs"]` | o contêiner sobe e não migra |
| `escalaEsperada` | **1** | ver [escala-do-servico.md](escala-do-servico.md) — o teste e a esteira barram |
| `caminhoDeSaude` | `/api/healthz` — "este processo está vivo?" | a verificação final testa a coisa errada |
| `caminhoDeProntidao` | `/api/readyz` — "ele consegue atender?", consulta o banco | idem |

**`comandoDaMigracao` é um array, e isso não é estilo.** O campo *Launch command* do Lightsail
**não passa por um shell**: comando com `sh -c "…"`, aspas ou `$VARIAVEL` é frágil ali. Medido na
#200. Por isso é um executável direto e seus argumentos, e há um teste que falha se o primeiro
elemento deixar de ser `node`.

## Onde cada coisa vive

| | |
|---|---|
| O workflow | [`.github/workflows/publicar.yml`](../../.github/workflows/publicar.yml) |
| A declaração do serviço | [`deploy/lightsail.json`](../../deploy/lightsail.json) |
| O script de migração | [`artifacts/api-server/src/migrar.ts`](../../artifacts/api-server/src/migrar.ts) |
| Os arquivos de migração | [`lib/db/migrations/`](../../lib/db/migrations/) — e [`lib/db/README.md`](../../lib/db/README.md) explica como escrever uma |
| Preparar a AWS (uma vez só) | [preparar-a-esteira-na-aws.md](preparar-a-esteira-na-aws.md) |
| Por que a escala é 1 | [escala-do-servico.md](escala-do-servico.md) |
| Restaurar uma cópia de segurança | [restaurar-backup.md](restaurar-backup.md) |
| Por que o produto saiu do Replit | [../decisoes/MIGRACAO-PARA-AWS.md](../decisoes/MIGRACAO-PARA-AWS.md) |
