# Política de Privacidade — ZELO

> **RASCUNHO — versão 0.1, 03/09/2026. Pendente de revisão jurídica.**
>
> Cada item foi conferido contra o código e o schema do banco em 03/09/2026.
> Onde falta decisão do fundador, está marcado `[DECIDIR]`.

---

## 1. Quem trata os seus dados

`[DECIDIR]` — razão social e CNPJ do controlador. Ainda não existe pessoa
jurídica constituída.

**Contato:** contato@zelocuida.com.br

`[DECIDIR]` — **Encarregado de dados (DPO)**. A LGPD exige indicar um. Já está
registrado como pendência em `planning/STATE.md`.

## 2. Quem é o titular dos dados — a parte que confunde

**O titular dos dados de saúde é o paciente**, não o cuidador que digitou.

Quem usa o aplicativo é, quase sempre, um filho, um cônjuge ou um cuidador
contratado — e os dados que ele registra são de **outra pessoa**. Por isso o
aplicativo pergunta, ao cadastrar um paciente, se você está consentindo **como o
próprio titular** ou **como representante legal**, e guarda a resposta.

Se o paciente tem condições de decidir por si, o consentimento é dele, e você
está agindo a pedido dele.

## 3. O que coletamos

### Da sua conta

Nome, e-mail e uma senha guardada como **hash Argon2** — nunca em texto legível.
Se você entra pelo Google, não guardamos senha nenhuma.

### Do paciente

Nome, data de nascimento, fuso horário e observações que você escrever.

### Do cuidado

Tratamentos e medicamentos, horários, doses registradas (com quem registrou e
quando), consultas, aferições, estoque de medicamento, e os "momentos" — fotos,
áudios e recados que a família compartilha.

### Técnicos

Endereço IP e navegador nos registros de acesso e de auditoria, para segurança.
Inscrições de notificação (push), se você autorizar.

## 4. Por que tratamos, e com qual base legal

| Para quê | Base legal (LGPD) |
|---|---|
| Prestar o serviço que você contratou | execução de contrato — art. 7º, V |
| Tratar dados de **saúde** do paciente | **consentimento específico e destacado** — art. 11, I |
| Segurança, auditoria e prevenção a fraude | legítimo interesse — art. 7º, IX |
| Cumprir obrigação legal | art. 7º, II |

`[DECIDIR — revisão jurídica]` A escolha da base legal para dado de saúde
merece confirmação de advogado. Adotamos **consentimento** por ser o caminho mais
seguro e o que o produto já implementa de verdade — o app registra consentimento
por paciente, com versão, data, IP e navegador.

## 5. Com quem compartilhamos

Não vendemos seus dados. Não usamos seus dados para publicidade.

Usamos estes fornecedores para operar:

| Fornecedor | Para quê | O que vê |
|---|---|---|
| **Replit** | hospedagem, banco de dados e armazenamento de fotos e áudios | tudo que o serviço guarda |
| **Anthropic** | ler a receita ou a caixa do medicamento por foto | só a foto que você enviar para isso, no momento do envio |
| **Resend** | enviar e-mails do aplicativo | seu e-mail e o conteúdo da mensagem |
| **Cloudflare** | DNS e encaminhamento do e-mail de contato | tráfego de rede e e-mails enviados a `contato@` |
| **Google** | entrar com Google (opcional) e autocompletar endereço de consulta (opcional) | seu e-mail no login; o texto digitado no campo de endereço |

**Sobre a Anthropic:** a foto vai numa chamada de API e é usada só para gerar a
resposta daquela chamada. Pela política da API da Anthropic, **conteúdo enviado
por API não é usado para treinar modelos** — regra diferente da do Claude.ai de
consumidor. O ZELO não deixa a foto guardada lá.

**Sobre o Google Maps:** só é acionado se você digitar no campo de endereço de
uma consulta. Sem a chave configurada, o campo vira texto comum e nada é enviado.

## 6. Por quanto tempo guardamos

| O quê | Prazo |
|---|---|
| **Fotos, áudios e recados** | **90 dias**, e depois são apagados — a menos que alguém marque para guardar |
| Foto de receita/caixa enviada para leitura | **apagada assim que você confirma o formulário**. O padrão nunca é reter |
| Dados da conta e do cuidado | enquanto a conta existir |
| Registro de auditoria | mantido para segurança e rastreabilidade |

`[DECIDIR]` — prazo de retenção do registro de auditoria após a exclusão da
conta. Precisa equilibrar a exigência de rastreabilidade com o direito ao
esquecimento.

## 7. Seus direitos

A LGPD garante acesso, correção, portabilidade e eliminação. No ZELO, os dois
mais importantes **não dependem de pedir a ninguém** — estão na tela, em
**Ajustes › Seus dados**:

- **Levar seus dados embora:** gera um arquivo com tudo, em **JSON** (para outro
  sistema importar) e em **PDF** (para você ler)
- **Apagar tudo:** agendado com sete dias de antecedência, cancelável nesse
  período. Depois disso, os dados são apagados de verdade, e as fotos e áudios
  saem também do armazenamento

Para os demais direitos: contato@zelocuida.com.br

## 8. Como protegemos

- Senha guardada como hash **Argon2**
- Todo acesso a dados de paciente é validado no servidor contra o vínculo
  familiar. Dado de outra família responde como **inexistente**, não como
  "proibido" — nem a existência dele é revelada
- **Nenhum registro de log contém nome de medicamento, condição de saúde ou
  identificação de paciente.** Isso é imposto por uma lista de permissão no
  código, não por disciplina de quem escreve
- Sessões podem ser encerradas em todos os aparelhos de uma vez
- Registro de auditoria imutável das ações relevantes

## 9. Crianças

O ZELO é para maiores de 18 anos. Um paciente pode ser menor de idade — nesse
caso o cadastro é feito pelo representante legal, que responde pelo
consentimento.

## 10. Mudanças

Avisaremos por e-mail antes de mudanças relevantes.

## 11. Reclamações

Você pode reclamar à **ANPD** (Autoridade Nacional de Proteção de Dados) se
achar que seus direitos não foram respeitados.
