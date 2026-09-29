# RUNBOOK — Preparar a esteira na AWS (uma vez só)

> Issue #201. Escrito em 28/09/2026, para ser seguido **com a tela da AWS aberta**.
>
> São 9 passos e leva por volta de 30 minutos. Cada passo diz **o que fazer**, **o que esperar** e
> **como é a falha** — porque metade do tempo perdido nessas telas é não saber se deu certo.
>
> Depois disto, todo commit no `main` publica sozinho e você não volta aqui.

> ## ⚠ Antes de você fazer o passo 1, a esteira já vai ter falhado uma vez — e está certo
>
> O workflow chegou ao `main` em 28/09/2026, no PR #217. **Esse merge é, ele mesmo, um commit no
> `main`** — então a esteira disparou na hora, antes de existir papel nenhum na AWS.
>
> Ela para no passo *"Assumir o papel na AWS por OIDC"*, dizendo que não conseguiu obter
> credencial. **Não é defeito, e nada foi publicado**: sem credencial ela não fala com a AWS, não
> constrói imagem e não toca em nada. O mesmo vai acontecer a cada commit no `main` até você
> terminar o passo 6.
>
> Se chegou um e-mail de falha do GitHub Actions, é este. Siga os passos abaixo; o primeiro commit
> depois do passo 6 é que vale.

---

## O que estamos montando, e por quê

O GitHub Actions precisa de permissão para publicar no Lightsail. Há dois jeitos:

| | |
|---|---|
| **Chave gravada** no repositório | uma credencial permanente, que vale até alguém trocar. Se vazar, vale para sempre |
| **OIDC** (é o que vamos fazer) | a cada execução, o GitHub prova quem é e a AWS devolve uma credencial que **expira em uma hora**. Não existe chave para vazar |

É mais trabalho uma vez e menos risco todos os dias. A Issue pedia OIDC de preferência, e é o que
está feito — **não há prazo de troca de chave a anotar, porque não há chave**.

**Nenhum segredo do ZELO vai para o GitHub.** A esteira lê as variáveis de ambiente do serviço que
já está no ar e as herda. O único segredo do repositório é o *endereço* do papel da AWS, que não
abre nada sozinho.

> **Sobre o número da conta.** Ele aparece várias vezes abaixo como `<ID-DA-CONTA>`. Está escrito
> assim de propósito: este repositório é **público** (decisão de 09/09/2026). Você vê o número no
> canto superior direito do console da AWS, ao clicar no seu nome — são 12 dígitos. Copie de lá a
> cada vez que aparecer `<ID-DA-CONTA>`.

---

## 1. Criar o provedor de identidade do GitHub

**Onde:** console da AWS → busque **IAM** → menu da esquerda → **Identity providers** →
**Add provider**.

**O que preencher:**

| Campo | Valor |
|---|---|
| Provider type | **OpenID Connect** |
| Provider URL | `https://token.actions.githubusercontent.com` |
| Audience | `sts.amazonaws.com` |

Clique em **Get thumbprint** se ele pedir, depois **Add provider**.

**O que esperar:** o provedor aparece na lista como `token.actions.githubusercontent.com`.

**Como é a falha:** se ele disser que **já existe**, ótimo — alguém (ou outro projeto) já criou.
Não crie um segundo; use o que está lá e siga para o passo 2.

---

## 2. Criar o papel que o GitHub vai assumir

**Onde:** IAM → **Roles** → **Create role**.

1. Em *Trusted entity type*, escolha **Web identity**.
2. Em *Identity provider*, escolha `token.actions.githubusercontent.com`.
3. Em *Audience*, escolha `sts.amazonaws.com`.
4. Preencha **GitHub organization** = `Quintanilha09`, **GitHub repository** =
   `Zelo-Care-Foundation`, **GitHub branch** = `main`.
5. Avance sem escolher política nenhuma (ela entra no passo 4).
6. **Role name:** `zelo-deploy-github`.
7. **Create role**.

**O que esperar:** o papel aparece na lista de Roles.

### Confira a política de confiança, porque é ela que tranca a porta

Abra o papel → aba **Trust relationships** → **Edit trust policy**. Ela precisa estar
**exatamente** assim (trocando `<ID-DA-CONTA>`):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Principal": {
        "Federated": "arn:aws:iam::<ID-DA-CONTA>:oidc-provider/token.actions.githubusercontent.com"
      },
      "Action": "sts:AssumeRoleWithWebIdentity",
      "Condition": {
        "StringEquals": {
          "token.actions.githubusercontent.com:aud": "sts.amazonaws.com",
          "token.actions.githubusercontent.com:sub": [
            "repo:Quintanilha09@104573504/Zelo-Care-Foundation@1336251458:ref:refs/heads/main",
            "repo:Quintanilha09/Zelo-Care-Foundation:ref:refs/heads/main"
          ]
        }
      }
    }
  ]
}
```

**A linha que importa é a do `sub`.** Sem ela, *qualquer* workflow de *qualquer* repositório do
GitHub poderia assumir este papel. Com ela, só o `main` deste repositório.

### Por que são DOIS valores, e por que o primeiro tem números — 29/09/2026

O primeiro deploy automático falhou aqui, e o motivo não é óbvio:

```
Could not assume role with OIDC: Not authorized to perform sts:AssumeRoleWithWebIdentity
```

O GitHub passou a emitir o assunto do token no **formato imutável**, com o ID numérico do dono
e o do repositório embutidos:

```
repo:Quintanilha09@104573504/Zelo-Care-Foundation@1336251458:ref:refs/heads/main
```

A política estava escrita no formato antigo, só com os nomes, e deixou de casar. Os dois ficam
na lista: o com ID porque é o que chega hoje, o sem ID porque é barato manter e cobre o caso de
o GitHub voltar atrás.

**O formato com ID é mais seguro, não menos.** Nome de usuário e de repositório podem ser
trocados e reaproveitados por outra pessoa; o ID numérico, não.

> **Não relaxe a condição para `*`.** `repo:Quintanilha09*/Zelo-Care-Foundation*` parece
> inofensivo e não é: um usuário chamado `Quintanilha09x` com um repositório
> `Zelo-Care-Foundation-teste` casaria, e teria deploy na sua conta. Acrescente o valor exato à
> lista — o campo aceita um array.

### Como descobrir o `sub` real, porque o log do GitHub não mostra

A mensagem de erro do Actions **não traz** o assunto do token. Quem traz é o CloudTrail, que
registra a tentativa recusada:

```bash
aws cloudtrail lookup-events \
  --lookup-attributes AttributeKey=EventName,AttributeValue=AssumeRoleWithWebIdentity \
  --max-results 5 --region sa-east-1 \
  --query 'Events[].CloudTrailEvent' --output text
```

O campo `userIdentity.principalId` termina com o `sub` exato que o GitHub apresentou. Compare com
a política e acrescente o que faltar.

---

## 3. Por que este papel é `sa-east-1` e não o mundo

O Lightsail **não aceita permissão por recurso** para serviço de contêiner: a política precisa
dizer `"Resource": "*"`. O que dá para restringir é a **região**, e é o que a política do passo 4
faz.

`RISCO POTENCIAL`, declarado: este papel consegue publicar em **qualquer** serviço de contêiner
Lightsail em `sa-east-1`. Hoje existe **um**. Se um dia existirem dois, a separação terá de vir de
outro lugar (conta separada, por exemplo).

O que ele **não** consegue, de propósito:

| Não pode | Por quê |
|---|---|
| mudar a escala do serviço | é o clique que quebra três coisas em silêncio ([escala-do-servico.md](escala-do-servico.md)) |
| apagar o serviço ou uma imagem | uma esteira não precisa apagar nada |
| tocar no banco | ela nunca fala com o banco direto — quem migra é o contêiner |
| tocar nos buckets | mídia e backup não são assunto de deploy |

---

## 4. Dar ao papel a permissão mínima

**Onde:** no papel `zelo-deploy-github` → aba **Permissions** → **Add permissions** →
**Create inline policy** → aba **JSON**.

Cole:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicarNoServicoDeConteiner",
      "Effect": "Allow",
      "Action": [
        "lightsail:GetContainerServices",
        "lightsail:GetContainerImages",
        "lightsail:GetContainerLog",
        "lightsail:GetContainerAPIMetadata",
        "lightsail:RegisterContainerImage",
        "lightsail:CreateContainerServiceRegistryLogin",
        "lightsail:CreateContainerServiceDeployment"
      ],
      "Resource": "*",
      "Condition": {
        "StringEquals": {
          "aws:RequestedRegion": "sa-east-1"
        }
      }
    }
  ]
}
```

**Policy name:** `zelo-esteira-lightsail`. **Create policy**.

**O que esperar:** a política aparece na aba *Permissions* do papel.

**Como é a falha:** se a esteira parar com `AccessDeniedException`, a mensagem **diz qual ação
faltou**. Acrescente só aquela ação a esta lista — não troque por `lightsail:*`.

---

## 5. Copiar o endereço do papel

No topo da página do papel, copie o **ARN**. Ele tem esta cara:

```
arn:aws:iam::<ID-DA-CONTA>:role/zelo-deploy-github
```

---

## 6. Guardar o endereço no GitHub

**Onde:** github.com → repositório → **Settings** → **Secrets and variables** → **Actions** →
**New repository secret**.

| Campo | Valor |
|---|---|
| Name | `AWS_DEPLOY_ROLE_ARN` |
| Secret | o ARN que você copiou |

**O que esperar:** ele aparece na lista, com o valor escondido.

**Por que segredo e não variável**, já que um ARN não abre nada: para o número da conta não
aparecer no log de uma execução pública. O GitHub troca segredo por `***` automaticamente.

---

## 7. Conferir que a herança de ambiente vai funcionar — 1 minuto

Este é o passo mais barato do runbook e evita o susto mais caro.

A esteira herda as variáveis do deployment que está no ar. **Se a AWS não as devolvesse pela API,
o desenho inteiro não funcionaria.** Isso está marcado como `HIPÓTESE` no runbook de deploy, e o
comando abaixo resolve.

Rode na sua máquina, **depois** de existir um deployment (passo 8):

```bash
aws lightsail get-container-services --service-name zelo --region sa-east-1 \
  | jq -r '.containerServices[0].currentDeployment.containers.zelo.environment | keys[]'
```

**O que esperar:** uma lista de nomes, uma por linha — `ADMIN_PANEL_SECRET`, `APP_URL`,
`DATABASE_URL`, `RESEND_API_KEY`, `SESSION_SECRET`, e assim por diante. Deve haver **19**
(ver #202).

**Como é a falha:** lista vazia, ou `null`. Aí a herança não funciona e a esteira precisa de outro
desenho — **abra uma Issue antes de improvisar**, porque a alternativa (pôr as 19 variáveis nos
Secrets do GitHub) é exatamente o que este desenho evita.

> O comando imprime só os **nomes**. Não troque `keys[]` por `to_entries` "para ver melhor" — aí
> ele imprime os valores, e o terminal fica com a senha do banco no histórico.

---

## 8. A primeira implantação, que é manual

**Por que manual:** é ela que define as variáveis de ambiente. A esteira herda; ela não cria.

### 8a. Ter uma imagem no registro

Se você **nunca** publicou, o registro do serviço está vazio. Não precisa de Docker na sua máquina:
deixe a esteira fazer isso.

1. Com os passos 1 a 6 feitos, mande um commit qualquer para o `main` — pode ser de documentação.
2. Vá em **Actions** → o **Validate** roda os três checks e, quando fecharem, **Publicar** começa.
3. Ela vai **construir e enviar a imagem** e depois **parar** com esta mensagem:

   > `O servico 'zelo' nao tem nenhum deployment no ar. A imagem desta execucao JA esta no
   > registro: :zelo.app.1`

   **Isso é o esperado na primeira vez.** A imagem está lá; falta a implantação.

### 8b. Criar a implantação no console

**Onde:** Lightsail → **Containers** → serviço **`zelo`** → **Create your first deployment**.

| Campo | Valor | Por quê |
|---|---|---|
| Container name | **`zelo`** | tem de bater com `container` em `deploy/lightsail.json`, senão a esteira para e diz |
| Image | `:zelo.app.1` (o que a esteira registrou) | |
| Launch command | **deixe vazio** | a imagem já traz o comando certo |
| Port | **`5000`**, protocolo **HTTP** | é o `EXPOSE` do Dockerfile |

Em **Environment variables**, acrescente as 19 variáveis da #202 — `DATABASE_URL`,
`SESSION_SECRET`, `ADMIN_PANEL_SECRET`, `RESEND_API_KEY`, `APP_URL`, o trio `VAPID_*`, e as
demais.

Em **Public endpoint**:

| Campo | Valor |
|---|---|
| Container | `zelo` |
| Port | `5000` |
| Health check path | **`/api/healthz`** |

> **`/api/healthz` e não `/api/readyz`, e a diferença importa.** Quem responde a esta verificação
> decide **reiniciar o contêiner**. O `healthz` pergunta "este processo está vivo?" e não toca no
> banco; o `readyz` consulta o banco. Se o health check usasse o `readyz`, uma piscada do banco
> reiniciaria o app — levando junto o pg-boss e todas as conexões abertas. Uma indisponibilidade
> curta do banco viraria uma longa do aplicativo, causada pela própria verificação. Foi a #196.

**Save and deploy.**

**O que esperar:** o serviço entra em *Deploying* e, alguns minutos depois, a versão aparece como
**Active**. Abra a URL do serviço: a tela de login do ZELO tem de carregar.

**Como é a falha:** o deployment vira *Failed*. Abra **Open log** no contêiner `zelo` — quase
sempre é variável de ambiente faltando, e o log diz qual.

### 8c. Rodar o passo 7 agora

Com um deployment no ar, o comando do passo 7 tem o que ler. Rode e confirme os 19 nomes.

---

## 9. O primeiro deploy automático

Faça um commit qualquer no `main` (pode ser de documentação — ela vai direto ao `main` por regra).

**O que esperar, na aba Actions:**

1. **Validate** roda os três checks.
2. Quando fecharem verdes, **Publicar** começa sozinha.
3. Ela constrói, envia, migra, publica e verifica.
4. No fim, o *Summary* mostra commit, imagem e versão.

**O que medir enquanto roda** — são os números que faltam ao projeto, e só este momento os dá:

| O quê | Como |
|---|---|
| **O app cai durante a migração?** | deixe rodando num terminal: `while true; do curl -s -o /dev/null -w "%{http_code} " <url>/api/healthz; sleep 2; done`. Conte quantos códigos diferentes de 200 aparecem |
| **Quanto tempo leva o deploy inteiro** | o próprio GitHub mostra, ao lado da execução |
| **Quanto tempo leva uma volta atrás** | faça uma de propósito, agora que não há usuário. É o melhor dia possível para descobrir |

**Escreva os três em [deploy-para-a-aws.md](deploy-para-a-aws.md)**, na seção "O que ainda não foi
medido". Eles são a diferença entre um runbook que ajuda e um que só descreve.

---

## Como desfazer tudo isto

```bash
# tira a permissão
aws iam delete-role-policy --role-name zelo-deploy-github --policy-name zelo-esteira-lightsail
# tira o papel
aws iam delete-role --role-name zelo-deploy-github
# tira o provedor (só se nenhum outro projeto o usar)
aws iam delete-open-id-connect-provider \
  --open-id-connect-provider-arn arn:aws:iam::<ID-DA-CONTA>:oidc-provider/token.actions.githubusercontent.com
```

E apague o segredo `AWS_DEPLOY_ROLE_ARN` nas configurações do repositório.

Depois disso a esteira falha logo no passo do OIDC, e o serviço continua rodando o que estiver no
ar — desfazer a esteira **não derruba o app**.

---

## Onde continuar

| | |
|---|---|
| Como o deploy funciona, e como voltar atrás | [deploy-para-a-aws.md](deploy-para-a-aws.md) |
| Por que a escala é 1 | [escala-do-servico.md](escala-do-servico.md) |
| Domínio, TLS e as 19 variáveis | Issue #202 |
| Por que o produto saiu do Replit | [../decisoes/MIGRACAO-PARA-AWS.md](../decisoes/MIGRACAO-PARA-AWS.md) |
