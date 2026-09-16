# A escala do serviço é 1, e subir exige trabalho antes

> Runbook de infraestrutura — Issue #197.
> Verificado no código em 15/09/2026.

## A regra

**O serviço de contêiner roda com UM nó.** O campo de escala do Lightsail é um seletor de
número na tela, e aumentá-lo é um clique — feito, quase sempre, por quem quer "aguentar mais
gente".

**Esse clique quebra três coisas, todas em silêncio.** Nenhuma delas dá erro, aparece em log ou
derruba o app: elas simplesmente passam a funcionar pela metade, para metade das pessoas.

---

## O que quebra, e por quê

### 1. O limitador de taxa dobra sem avisar

`artifacts/api-server/src/lib/rate-limit.ts` usa o `express-rate-limit` com o armazenamento
**padrão**, que é um mapa na memória do processo. Cada nó conta o seu.

Com dois nós, quem tenta senha cai ora num, ora noutro — e o limite efetivo vira **o dobro do
número escrito no código**. Com quatro nós, o quádruplo.

O limitador de login não é conforto: é a defesa contra tentativa de senha em massa numa base de
dado de saúde. E o `/admin` é o caso pior, porque a senha dele é **única e compartilhada** — o
limite por IP é a única barreira que ele tem.

### 2. A atualização ao vivo para de chegar para parte da família

`artifacts/api-server/src/lib/realtime.ts` mantém o pub/sub em memória:

```ts
const patientEmitter = new EventEmitter();
const connectionsByUserId = new Map<number, Set<Response>>();
```

O próprio arquivo já diz, desde que foi escrito: *"este serviço roda como um único processo (sem
múltiplas instâncias hoje)"*. A suposição está no código; até a #197 não estava em lugar nenhum
que um operador fosse ler.

Com dois nós: uma cuidadora com o celular conectado ao nó A **não recebe** o evento de uma dose
registrada pela irmã através do nó B. A tela dela fica parada, mostrando a dose como pendente.

Num produto em que duas pessoas cuidam do mesmo idoso, isso é pior que uma tela travada — é o
caminho para **dose repetida**, porque a segunda pessoa não vê que a primeira já deu.

### 3. Revogar o acesso de um cuidador NÃO corta a sessão ao vivo dele

Esta é a mais grave, e é de segurança.

Quando o acesso de um cuidador é revogado, `routes/caregivers.ts` chama
`closeConnectionsForUser(userId)`, que derruba as conexões SSE abertas dele. Só que essa função
só enxerga o mapa **do próprio processo**.

Com dois nós: revogar pelo nó A não fecha nada no nó B. O cuidador removido **continua recebendo
eventos do paciente** — nome de medicamento, quem registrou, situação da dose — até a conexão
dele cair sozinha.

Encosta direto no invariante 2 do produto: *todo acesso a paciente é validado no servidor contra
o vínculo familiar*. Com dois nós, a revogação passa a valer só para o nó que a atendeu.

---

## O que fazer ANTES de subir a escala

Não basta mexer no limitador. As três precisam de coordenação entre processos, e cada uma tem
uma resposta diferente:

| O que | O que seria preciso |
|---|---|
| Limitador de taxa | contador compartilhado — uma tabela no Postgres e um `store` próprio |
| Pub/sub ao vivo | `LISTEN`/`NOTIFY` do Postgres no lugar do `EventEmitter` |
| Revogação de sessão | a mesma `NOTIFY`, com cada nó fechando as conexões que ele tem |

O banco já é o ponto de coordenação do sistema (o pg-boss roda sobre ele), então não entra
infraestrutura nova — mas **são três mudanças, não uma**, e cada uma precisa de teste próprio
que prove o comportamento com dois processos de verdade.

### O que NÃO resolve

- **Sessão fixa (*sticky session*) não resolve.** Ela ajudaria o caso 2 enquanto a conexão
  durasse, mas não faz o evento atravessar de um nó para o outro, e não conserta os casos 1 e 3.
- **Só mover o contador do limitador para o Postgres não libera dois nós.** Conserta o caso 1 e
  deixa os outros dois de pé — o que é pior que hoje, porque cria a impressão de que o problema
  foi resolvido.

---

## O custo de ficar com um nó

Honestamente: **não há redundância.** Se o contêiner cair, o Lightsail sobe outro, e o app fica
fora no intervalo.

A troca é deliberada: um nó de 1 GB atende muito mais famílias do que o piloto vai ter, e
resolver coordenação entre processos que ainda não existem é trabalho que envelhece antes de ser
usado. Quando houver motivo real para o segundo nó, a tabela acima é a lista.

---

## O mesmo risco existe no Replit, hoje

`.replit` tem `deploymentTarget = "autoscale"`. Ou seja: **o risco não é novo da AWS** — ele já
existe, e nunca esteve escrito.

O `autoscale` ainda traz um quarto problema, que a AWS resolve por construção: ele **desliga o
serviço quando não há tráfego**. O pg-boss roda dentro do processo e agenda seis tarefas, entre
elas o lembrete de dose (`*/15`) e o monitor operacional (`*/2`). Sem processo de pé às 3h da
manhã, **o lembrete não sai** — e ninguém fica sabendo.

É parte do motivo de o produto sair de lá. Ver
[MIGRACAO-PARA-AWS.md](../decisoes/MIGRACAO-PARA-AWS.md).
