# Runbook — o ambiente local

> Escrito em 29/09/2026, Issue #221, depois de o Replit ser cancelado em 24/09.
>
> O Replit era onde o fundador testava: havia uma URL, ele abria no celular, pronto.
> Este runbook é o substituto. **A produção na AWS não é lugar de testar mudança em
> andamento** — ela fica ligada, mas serve para o que só ela responde.

## O comando

```bash
pnpm dev
```

É só isso. Ele confere o Docker, sobe o Postgres, cria o banco, aplica as migrações,
semeia a família fictícia, constrói a API e sobe API e front juntos.

> **Se o terminal disser que não conhece o `pnpm`**, use a outra porta de entrada —
> ela faz exatamente a mesma coisa e só precisa do `node`:
>
> ```bash
> node scripts/desenvolver.mjs
> ```
>
> O script acha o `pnpm` sozinho, sem depender do PATH. A seção de problemas explica.

Ao terminar, imprime:

```
  Nesta máquina   http://localhost:5273
  No celular      http://192.168.x.x:5273   (mesma Wi-Fi)

  Entrar como     gabriel.hemendinger@gmail.com
  Senha           zelo-local-123
```

`Ctrl+C` encerra os dois.

> **Deixe o terminal aberto enquanto estiver testando.** É o processo dele que segura a
> API e o front. Fechar a janela derruba os dois, e a tela do app passa a responder
> `NetworkError when attempting to fetch resource` — que parece defeito do app e é só
> servidor ausente. Uma aba já aberta continua mostrando a tela antiga, o que torna o
> sintoma ainda mais confuso: recarregue depois de subir de novo.

## O que você encontra ao entrar

A conta abre a **Família Fictícia Teste**, já montada:

| | |
|---|---|
| Paciente | Dona Maria Teste, 1947 |
| Cuidadores | João Teste (principal, é você), Ana Teste (observadora) |
| Medicamentos | Cardiolex 25mg, Prexoral 10mg, Vitazan B — todos marcados "(fictício)" |
| Doses | 4 agendadas: 2 tomadas, 2 pendentes |
| Consulta | Dr. Fictício da Silva, Clínica Fictícia Teste |

Tudo obviamente falso, por invariante do produto (invariante 7).

## Abrir no celular

O front já escuta na rede (`--host 0.0.0.0`), então basta digitar o endereço que o
comando imprimiu. Duas condições:

1. **Mesma Wi-Fi** que o computador
2. **O firewall do Windows precisa deixar passar.** Na primeira vez o Windows
   pergunta; escolha "Redes privadas". Se você recusou sem querer, o endereço não
   abre e não há mensagem de erro — só uma tela que não carrega

O IP muda quando você troca de rede. O comando sempre imprime o atual.

## O que dá e o que não dá para testar aqui

| | Local | Só em produção |
|---|---|---|
| Telas, fluxos, modo idoso, registrar dose | ✅ | |
| Celular, tela pequena | ✅ | |
| Banco real, gatilhos, isolamento por família | ✅ | |
| E-mail chegando de verdade | ❌ | ✅ |
| HTTPS e domínio | ❌ | ✅ |
| Notificação push (exige HTTPS) | ❌ | ✅ |
| Comportamento sob `NODE_ENV=production` | ❌ **por construção** | ✅ |

**Sobre e-mail:** o ambiente local roda `NODE_ENV=development`. Nele a conta se
auto-verifica e **nenhum e-mail sai**. Não é defeito — é o mesmo comportamento que o
Replit tinha. Roteiro que pede para "conferir o e-mail de boas-vindas" aqui está
pedindo o impossível.

## Duas coisas que parecem detalhe e não são

### Portas 5100 e 5273, não 5000 e 5173

O Playwright usa 5000 e 5173, com `reuseExistingServer` fora do CI: se achar algo já
escutando lá, ele **usa o que achou em vez de subir o dele**.

Se o ambiente local morasse nessas portas, rodar `pnpm test:e2e` com ele no ar faria
a suíte inteira rodar contra o seu banco de desenvolvimento — criando e apagando
dados no meio do que você estivesse olhando. E passaria verde, que é o pior dos
mundos: nada avisaria.

### Banco `zelo_local`, não `zelo_dev`

`zelo_dev` é o banco do `test:all` (ver [banco-de-teste-local.md](banco-de-teste-local.md)).
A suíte de integração cria e apaga dados o tempo todo.

Mesmo container, mesma porta 5433, banco diferente. **Rodar a suíte não destrói o que
você montou à mão.**

## O `.env.local` é opcional

O comando funciona **sem nenhum `.env.local`** — ele gera `SESSION_SECRET` e
`ADMIN_PANEL_SECRET` locais e aponta o `DATABASE_URL` para o `zelo_local`.

O arquivo só faz falta para ligar integração externa:

| Variável | O que liga | Sem ela |
|---|---|---|
| `RESEND_API_KEY`, `EMAIL_FROM` | envio de e-mail | nada sai (e em dev não sairia mesmo) |
| `S3_BUCKET`, `S3_REGION`, `S3_PREFIX` | mídia no S3 | mídia usa o caminho local |
| `GOOGLE_MAPS_API_KEY` | busca de endereço | o campo aceita texto livre |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | entrar com Google | só entra por e-mail e senha |
| `ANTHROPIC_API_KEY` | recursos de IA | desligados |
| `VAPID_PUBLIC_KEY` | notificação push | não funciona local de qualquer forma (exige HTTPS) |

> **`SESSION_SECRET` e `ADMIN_PANEL_SECRET` têm de ser diferentes.** Iguais, o painel
> administrativo se desliga sozinho — proteção deliberada, porque um token de admin
> passaria por `verifyAccessToken` como se fosse sessão de cuidador. O comando
> recusa subir se estiverem iguais, e diz por quê.

## Quando eu mudo código da API

A API é **construída** ao subir, não observada. Mudança em `artifacts/api-server`
pede `Ctrl+C` e `pnpm dev` de novo.

O front não: o vite recarrega sozinho. Mudança em `artifacts/zelo` aparece na tela
sem reiniciar nada.

## Começar do zero

Para apagar tudo e semear de novo:

```bash
docker exec zelo-test-pg psql -U zelo_dev -c "DROP DATABASE zelo_local"
```

Depois `pnpm dev`. Ele recria, migra e semeia.

Para apagar só a família fictícia, mantendo o resto:

```bash
docker exec zelo-test-pg psql -U zelo_dev -d zelo_local -c "DELETE FROM families WHERE slug = 'familia-ficticia-teste'"
```

A semente é idempotente: com a família presente ela não faz nada, e avisa.

## Quando dá errado

| Sintoma | Causa | O que fazer |
|---|---|---|
| **`pnpm` não é reconhecido** | **causa não encontrada — ver abaixo** | **use `node scripts/desenvolver.mjs`** |
| "O Docker não respondeu" | Docker Desktop fechado ou ainda subindo | abra e espere o ícone parar de girar |
| "A porta 5100 já está ocupada" | um `pnpm dev` anterior não morreu | `netstat -ano \| findstr :5100`, feche aquele processo |
| Celular não abre o endereço | firewall, ou Wi-Fi diferente | confira a rede; no Windows libere para "redes privadas" |
| Tela carrega mas nada funciona | o front subiu e a API não | olhe as linhas `[api]` no terminal |
| Login diz senha errada | banco recriado sem semear | `pnpm dev` de novo, ou rode a semente |

### O "`pnpm` não é reconhecido" — 29/09/2026

Aconteceu de verdade, no PowerShell do fundador. **A causa nunca foi encontrada**, e
isso está registrado aqui porque a investigação inteira deu certo e mesmo assim o
erro continuou.

Conferido na máquina, tudo correto:

| O que | Resultado |
|---|---|
| PATH do usuário, no registro | contém `AppData\Roaming\npm` |
| Tipo do valor | `ExpandString` (expande variáveis) |
| Comprimento total do PATH | 659 caracteres — longe de qualquer truncamento |
| `PATHEXT` | contém `.CMD` |
| Perfil do PowerShell | não existe, em nenhum dos quatro caminhos |
| Os arquivos | `pnpm`, `pnpm.cmd` e `pnpm.ps1` presentes |
| Chamada direta ao `.cmd` | responde `11.22.0` |
| Um processo novo de PowerShell | **acha o pnpm normalmente** |

Abrir um terminal novo **não** resolveu, o que derrubou a hipótese de janela velha.

**A saída foi tirar a dependência.** O script procura o `pnpm` por conta própria, e só
precisa que o `node` funcione — ele já está rodando dentro do Node quando começa a
procurar. A ordem:

1. `pnpm` no PATH
2. **`corepack`, que vem junto do Node** e mora ao lado do executável que está rodando
3. `%APPDATA%\npm\pnpm.cmd`
4. `corepack` no PATH

Verificado nos dois cenários: com o diretório no PATH ele acha em (1); sem o
diretório, cai em (2) e encontra a mesma versão 11.22.0.

Por isso `node scripts/desenvolver.mjs` funciona mesmo onde `pnpm dev` não funciona.

## A conta da semente é o e-mail real do fundador

Pedido dele em 29/09/2026: entrar no ambiente local com o endereço que já usa.

O desenho anterior usava `joao.teste@zelo.test`, e o TLD `.test` não era enfeite — ele
é reservado pela RFC 2606 e **nunca resolve na internet**, então conta escapada não
entregaria e-mail a ninguém.

> **Essa rede de proteção deixou de existir.** Quem sustenta o risco agora é a guarda
> de `IS_PRODUCTION` logo abaixo. Se ela cair, a semente passa a criar um acesso com
> senha conhecida para um endereço real. As duas coisas andam juntas: não mexa numa
> sem olhar a outra.

O endereço em si não é novidade pública — ele já assina todo commit do repositório. A
senha ao lado dele é.

**A semente não sobrescreve senha de conta que já existe.** Se você se cadastrou pelo
app e depois resemeou, ela reaproveita a conta, aponta para a família fictícia e
mantém a senha que você escolheu.

## A semente não roda em produção

`seed.ts` recusa quando `IS_PRODUCTION` — ela cria uma conta de **senha conhecida**,
escrita em texto puro no repositório. Num banco de produção isso não é dado de
demonstração, é porta dos fundos.

A guarda usa `IS_PRODUCTION` e não `NODE_ENV !== "production"`, porque a **ausência**
de `NODE_ENV` já significa produção neste código. A forma ingênua deixaria a semente
rodar justamente no ambiente mal configurado.
