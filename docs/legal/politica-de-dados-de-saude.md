# Política de Dados de Saúde — ZELO

> **RASCUNHO — versão 0.1, 03/09/2026. Pendente de revisão jurídica.**
>
> Este é o documento que o cadastro já cita como *"versão v1.0 — rascunho,
> pendente de revisão jurídica"*. É o mais sensível dos três: trata de **dado
> pessoal sensível** na definição do art. 5º, II da LGPD.

---

## 1. Por que este documento existe separado

Dado de saúde tem regra própria na LGPD. Não basta a Política de Privacidade
geral: o art. 11 exige **consentimento específico e destacado** para tratar
saúde, e "destacado" significa que não pode estar embutido num aceite genérico.

Por isso o cadastro do ZELO pede **dois consentimentos separados**: um para os
Termos de Uso, outro só para os dados de saúde.

## 2. De quem são estes dados

**Do paciente.** Não de quem digita.

Essa distinção é a coisa mais importante aqui. Quem opera o aplicativo é o
cuidador; os dados registrados são de outra pessoa — a mãe, o pai, o avô, o
paciente sob cuidado contratado.

Ao cadastrar um paciente, o aplicativo pergunta em qual situação você está:

| Situação | O que significa |
|---|---|
| **Sou o titular** | você está cadastrando a si mesmo |
| **Sou representante legal** | você responde legalmente por essa pessoa |

A resposta é gravada com **versão do texto, data, hora, endereço IP e
navegador** — um consentimento por paciente, nunca reaproveitado de outro.

**Se o paciente tem condições de decidir por si, o consentimento precisa ser
dele.** Cadastrar alguém capaz sem que essa pessoa saiba não é permitido pelos
Termos, e não é o que o app se propõe a apoiar.

## 3. Que dados de saúde são tratados

- Medicamentos, concentração, forma e posologia como está escrita na receita
- Horários e registros de dose: tomada, pulada, atrasada, com quem registrou
- Consultas e compromissos de saúde
- Aferições — pressão, glicemia, peso e outras — **como você digitou**
- Estoque de medicamento
- Fotos, áudios e recados dos "momentos", quando envolvem o paciente
- Foto da receita ou da caixa, quando você usa a leitura por foto

## 4. O que o ZELO NÃO faz com esses dados

Esta é a delimitação que define o produto, e ela é estrutural — não é promessa
de comportamento, é ausência de código que faria o contrário:

- **Não prescreve** e não sugere tratamento
- **Não calcula nem sugere dose**
- **Não interpreta aferição.** Não há faixa de referência, não há "normal" ou
  "alterado", não há cor de alerta clínico. O valor volta como você digitou
- **Não verifica interação medicamentosa**
- **Não toma decisão automatizada** sobre nada

Ninguém é avaliado, classificado ou pontuado por esses dados.

## 5. Leitura de receita por foto — como funciona

Você pode fotografar a receita ou a caixa para preencher o formulário mais
rápido. O que acontece:

1. A foto vai para a **Anthropic** (modelo Claude), numa chamada de API, com a
   instrução de **transcrever, nunca inferir**
2. O que não estiver claramente legível **volta vazio**, e não chutado
3. O resultado aparece no formulário **para você conferir e corrigir**
4. **Nada é salvo sem a sua confirmação.** Não existe caminho no código que crie
   um tratamento direto da foto — isso é garantido por teste automatizado
5. Terminada a confirmação, **a foto é apagada**. O padrão nunca é guardar; você
   precisa pedir explicitamente para manter

O que sobra depois do descarte é só estatística de acerto do modelo por campo —
sem imagem, sem texto livre da receita.

## 6. Fotos e áudios dos "momentos"

Ficam **90 dias** e depois são apagados, a menos que alguém marque para guardar.

Há um consentimento de imagem separado, por paciente, antes de qualquer foto do
paciente ser publicada.

## 7. Quem vê

Somente os cuidadores vinculados àquela família, no nível do papel de cada um.
O servidor valida isso a cada requisição, contra o vínculo familiar de quem está
autenticado — nunca contra o que o aplicativo enviou.

Dado de outra família responde como **inexistente**. Nem a existência é revelada.

**Nós não lemos os dados de saúde das famílias.** O acesso técnico existe para
operar e depurar o serviço, e é registrado.

## 8. Retirar o consentimento

Você pode retirar o consentimento a qualquer momento — e, na prática, isso é
**excluir o paciente ou a conta**, em **Ajustes › Seus dados**.

Retirar o consentimento significa que o ZELO não pode mais tratar aqueles dados,
e portanto não pode mais prestar o serviço para aquele paciente. Não há meio
termo: o produto inteiro é o tratamento desses dados.

Antes de apagar, **leve seus dados**: a exportação entrega tudo em JSON e em PDF.

## 9. Vazamento

Em caso de incidente de segurança com risco relevante, comunicaremos os titulares
afetados e a **ANPD**, como manda o art. 48 da LGPD.

`[DECIDIR]` — prazo interno de comunicação e quem é o responsável por acioná-la.
Precisa de runbook em `planning/runbooks/`, não de improviso no dia.

## 10. Contato

contato@zelocuida.com.br

`[DECIDIR]` — Encarregado de dados (DPO).
