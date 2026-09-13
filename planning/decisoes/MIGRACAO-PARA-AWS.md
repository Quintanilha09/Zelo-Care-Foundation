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

## Três defeitos que a migração conserta, e que já estão no código hoje

Nenhum deles mordeu ainda porque produção nunca foi ligada. Todos morderiam no primeiro usuário real.

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

## O que a migração exige — Issues #193 a #203

### Preparar o código (não depende da AWS existir)

| # | O quê | Por quê |
|---|---|---|
| [#193](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/193) | Armazenamento de mídia no S3 | é o **único** acoplamento real ao Replit |
| [#194](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/194) | O servidor passa a servir o front | sem isso o app não abre fora do Replit |
| [#195](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/195) | Dockerfile e imagem de produção | o Lightsail recebe uma imagem |
| [#196](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/196) | O `healthz` não pode reiniciar o app quando o banco pisca | defeito encontrado ao planejar |
| [#197](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/197) | Um nó só: o limitador de taxa é em memória | dois nós dobram o limite de login |
| [#198](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/198) | Migrações de verdade | o `push` ofereceu truncar o histórico de dose |
| [#199](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/199) | `pg_dump` de hora em hora para o S3 | backup **fora** do fornecedor |

### A infraestrutura

| # | O quê |
|---|---|
| [#200](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/200) | Provisionar a AWS em São Paulo: contêiner, banco, bucket, IAM, MFA, alarme de custo |
| [#201](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/201) | Esteira de deploy pelo GitHub Actions |

### O corte

| # | O quê |
|---|---|
| [#202](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/202) | Domínio, TLS, as 19 variáveis de ambiente e a ordem do corte |
| [#203](https://github.com/Quintanilha09/Zelo-Care-Foundation/issues/203) | Tirar o Replit do código — **só depois** de 7 dias servindo |

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

## Riscos aceitos, e o que NÃO foi verificado

`RISCO POTENCIAL:` o banco **Standard** não tem réplica. Se a instância cair, há indisponibilidade até
ela voltar — os dados não se perdem, porque o backup contínuo segue. A versão com redundância custa o
dobro (US$ 30) e é um clique quando houver receita.

`NÃO VERIFICADO:`

1. **Se 512 MB bastam.** Por isso a recomendação é o Micro de 1 GB. A geração de PDF não foi medida.
2. **O preço do pacote de Object Storage** do Lightsail. Estimado entre US$ 1 e US$ 5 no volume atual.
3. **Se `trust proxy` com valor 1 é o certo** atrás do balanceador do Lightsail. Hoje o `app.ts` confia
   em exatamente um salto. Se o balanceador acrescentar mais, `req.ip` passa a registrar o IP errado no
   log de auditoria e no limitador de login. **Precisa ser conferido no ambiente real antes do corte**
   — é item de aceite da #202.
4. **Nenhum número de desempenho.** Nada foi medido em ambiente AWS ainda, porque ele não existe.

---

## O que fica de lição, independente de fornecedor

Duas coisas neste repositório previram esta migração e acertaram, e é por isso que ela é barata:

1. **A interface de armazenamento de mídia**, escrita em vez de chamadas diretas ao fornecedor.
2. **A regra de nunca escrever `process.env.NODE_ENV !== "production"`**, nascida de um defeito real no
   deploy do Replit — em que a ausência da variável deixou cinco proteções desligadas em produção.

Fornecedor muda. A lição fica. Por isso a #203 manda apagar o código do Replit e **manter os
comentários que explicam por quê**.
