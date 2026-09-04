# Resgate de conta por suporte

> **Última saída de quem perdeu o acesso.** Issue #87, escrito em 04/09/2026.
> Este procedimento vale a partir do dia em que a #79 (segundo fator obrigatório) entrar.

## Por que este documento existe antes de ser necessário

Recuperação por suporte é **o elo mais fraco de qualquer segundo fator**. Foi assim que a maior
parte dos sequestros de conta de gente conhecida aconteceu: ninguém quebrou criptografia, alguém
convenceu um atendente.

Se uma pessoa escrever para `contato@zelocuida.com.br` dizendo *"perdi meu e-mail, me devolve o
acesso"* e o atendimento devolver, **o segundo fator inteiro vira teatro** — e o trabalho da #79
não compra nada.

Hoje o suporte é o fundador sozinho, e o risco parece pequeno. Ele não é: procedimento improvisado
é justamente o que se explora, e o dia em que houver uma segunda pessoa atendendo é tarde para
escrever a regra.

## Antes de tudo: este é o terceiro caminho, não o primeiro

Confira, nesta ordem, se um dos dois caminhos automáticos resolve. Eles são melhores que este em
todos os aspectos — mais rápidos, sem julgamento humano, e sem risco de engenharia social.

| Caminho | Quando serve | Onde fica |
|---|---|---|
| **E-mail de recuperação** | a pessoa cadastrou um endereço reserva | Ajustes › Sua conta |
| **Resgate pela família** | há outro cuidador, e ele é `primary_caregiver` | pela conta dele |
| **Este runbook** | não há nem um nem outro | aqui |

Se o e-mail de recuperação existir, **mande a pessoa usá-lo** e encerre. Não há nada a decidir.

## As cinco exigências. Nenhuma é opcional.

### 1. A senha continua sendo exigida

Quem perdeu o e-mail **não perdeu a senha**. Ela é o fator que sobra, e o suporte não pode
dispensá-la.

Se a pessoa também não sabe a senha, isto **não é um resgate de conta** — é um pedido de acesso de
alguém que não apresenta nenhum fator. Recuse. É exatamente o cenário que este documento existe
para recusar.

### 2. Perguntas que só o titular responde

Confira ao menos **três**, e use só perguntas cujas respostas estão dentro do produto:

- os nomes dos pacientes cadastrados
- aproximadamente quando a conta foi criada
- quantos cuidadores a família tem, e os nomes deles
- o nome de um medicamento em tratamento ativo
- a data aproximada do último registro de dose

**Nunca use dado que aparece em vazamento**: nome completo, telefone, CPF, data de nascimento,
endereço. Esses são públicos para qualquer atacante e não provam nada.

> As respostas certas estão no painel operacional (`/admin`). Consulte lá, e **não peça à pessoa
> que confirme algo que você já disse** — quem está mentindo concorda com tudo.

### 3. Janela de espera de sete dias, com aviso ao e-mail ANTIGO

**É o item que mais protege e o que menos custa.**

Ao aceitar o pedido, envie um aviso ao endereço **antigo** dizendo que um resgate foi pedido e que
ele valerá em sete dias. Só então execute.

Se o pedido não partiu do titular, esses sete dias são a única chance que ele tem de reagir. E se
partiu, sete dias de espera é um preço pequeno perto de perder o histórico de medicação de alguém.

O produto já usa exatamente esse padrão na exclusão de conta — não é regra nova, é a mesma.

> **Sem a janela, todo o resto vira julgamento no calor do pedido.** E o pedido sempre chega com
> pressa, porque pressa é a ferramenta de quem está mentindo. Pressa não é motivo para encurtar a
> janela: é motivo para desconfiar dela.

### 4. Registro em auditoria

Todo resgate por suporte entra no `audit_log`: **quem pediu, o que foi conferido, quem liberou, e
quando**. Sem registro não há como investigar depois, e "eu lembro que conferi" não é registro.

### 5. Uma coisa só, e nada além

O resgate devolve **acesso à conta**. Ele não troca o e-mail principal, não troca a senha, e não
concede papel nenhum que a pessoa já não tivesse. Se o pedido vier junto com outra coisa
("aproveita e me põe como cuidador principal"), **isso é um segundo pedido** e não entra por este
caminho.

## O roteiro, em ordem

1. **Confirme que os dois caminhos automáticos não servem.** Se servirem, encerre apontando para eles.
2. **Peça a senha.** Sem ela, recuse — e explique por quê, com estas palavras: *"a senha é o único
   fator que ainda temos para saber que é você. Sem ela, devolver o acesso seria devolver a conta a
   qualquer pessoa que escrevesse este e-mail."*
3. **Faça três perguntas** da lista acima, consultando `/admin` para conferir.
4. **Avise o endereço antigo** de que um resgate foi pedido e vale em sete dias.
5. **Espere os sete dias.** Se o titular reagir dizendo que não foi ele, **cancele e trate como
   tentativa de invasão** — o e-mail dele ainda funciona, então o pedido era falso.
6. **Execute e registre** no `audit_log`.

## O caso que este runbook NÃO resolve

Quem cuida sozinho, **não cadastrou e-mail de recuperação e também não sabe a senha**. Não há
fator nenhum, e devolver a conta seria entregá-la a quem pedir.

O fundador decidiu em 03/09/2026 que essa pessoa **assume o risco**. A decisão é legítima, e o
custo dela precisa estar dito com o número na frente: **o histórico inteiro é perdido, e nem a
exportação da LGPD salva, porque exportar também exige entrar.**

É por isso que o pedido do e-mail de recuperação aparece **depois do primeiro paciente
cadastrado** — quando a pessoa já está investida e o app já provou que serve para alguma coisa — e
volta a aparecer se ela adiar.

## Quando revisar

- Quando houver uma **segunda pessoa** no atendimento. O procedimento passa a valer para alguém
  que não escreveu as regras, e é aí que ele é testado de verdade.
- Quando a #79 entrar. O custo de errar aqui sobe no mesmo dia.
