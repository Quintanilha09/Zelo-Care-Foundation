/**
 * Termos de Uso — rota `/termos`, Issue #76.
 *
 * A seção 2 é a razão de este documento existir na forma em que está: ela diz
 * o que o ZELO **não** faz. É o invariante 4 do produto (`CLAUDE.md`) deixando
 * de ser regra interna e virando compromisso público.
 *
 * Cópia de revisão, com as anotações para o advogado: `docs/legal/termos-de-uso.md`.
 */
import { DocumentoLegal, Secao, Destaque, Tabela, LinkInterno } from "./DocumentoLegal";

export default function TermosPage() {
  return (
    <DocumentoLegal titulo="Termos de Uso" versao="v1.0" rascunho>
      <p>
        Estes Termos valem entre você e o ZELO. Ao criar uma conta, você concorda com eles.
      </p>

      <Secao numero={1} titulo="O que é o ZELO">
        <p>
          Um aplicativo para famílias organizarem o cuidado de alguém — normalmente uma pessoa
          idosa. Vários cuidadores registram juntos, no mesmo lugar, os remédios tomados, as
          consultas e as aferições, sem duplicar trabalho e sem depender da memória de uma pessoa só.
        </p>
      </Secao>

      <Secao numero={2} titulo="O que o ZELO não é">
        <Destaque>
          <p>
            <strong>O ZELO não pratica medicina.</strong> Ele nunca prescreve medicamento, calcula
            ou sugere dose, interpreta o resultado de uma aferição, verifica interação entre
            medicamentos, nem diz se um tratamento está certo ou errado.
          </p>
          <p>
            O aplicativo registra o que você informa e mostra de volta. As aferições são guardadas
            como você digitou, sem faixa de referência e sem sinal de “normal” ou “alterado”.{" "}
            <strong>Quem interpreta é o médico; o ZELO anota.</strong>
          </p>
        </Destaque>
        <p>
          Isso vale inclusive para a leitura de receita por foto: o aplicativo tenta transcrever o
          que está escrito, e tudo passa pela sua confirmação antes de ser salvo. Ele nunca completa
          o que não conseguiu ler.
        </p>
        <p>
          <strong>O ZELO não substitui atendimento médico e não é serviço de emergência.</strong> Em
          urgência, procure o SAMU (192) ou o serviço de saúde mais próximo.
        </p>
      </Secao>

      <Secao numero={3} titulo="Quem pode usar">
        <p>Você precisa ter 18 anos ou mais para criar uma conta.</p>
        <p>
          Ao cadastrar uma pessoa como paciente, você declara que é a própria pessoa, que tem
          autorização dela, ou que é seu representante legal. O aplicativo pergunta qual dos casos é
          o seu e guarda a resposta com data e hora.
        </p>
      </Secao>

      <Secao numero={4} titulo="Sua conta">
        <ul className="list-disc pl-5 space-y-1">
          <li>Você é responsável por manter sua senha em segredo.</li>
          <li>
            Convidar alguém para cuidar junto <strong>dá a essa pessoa acesso aos dados de saúde do
            paciente</strong>, no nível do papel escolhido. Pense antes de convidar.
          </li>
          <li>Você pode remover um cuidador a qualquer momento.</li>
        </ul>
      </Secao>

      <Secao numero={5} titulo="Papéis e o que cada um pode fazer">
        <Tabela
          cabecalho={["Papel", "Pode"]}
          linhas={[
            ["Cuidador principal", "tudo, inclusive convidar, remover e excluir a família"],
            ["Cuidador", "registrar doses, consultas e aferições"],
            ["Cuidador contratado", "registrar doses e aferições"],
            ["Observador", "apenas acompanhar, sem registrar nada"],
          ]}
        />
      </Secao>

      <Secao numero={6} titulo="Planos">
        <p>
          Os planos pagos <strong>ainda não estão disponíveis</strong>. Quando estiverem, eles
          ampliarão <em>quantos</em> pacientes, cuidadores e tratamentos cabem — e as condições de
          preço, cobrança e cancelamento serão informadas antes de qualquer cobrança.
        </p>
        <Destaque>
          <p>
            <strong>Nada que proteja a segurança do paciente fica atrás de pagamento.</strong>{" "}
            Registrar dose, receber lembrete, o escalonamento para outro cuidador e o modo idoso
            funcionam em todos os planos, inclusive no gratuito.
          </p>
        </Destaque>
      </Secao>

      <Secao numero={7} titulo="Seus dados">
        <p>
          O tratamento de dados pessoais está na{" "}
          <LinkInterno href="/privacidade">Política de Privacidade</LinkInterno>, e o de dados de
          saúde na{" "}
          <LinkInterno href="/consentimento-saude">Política de Dados de Saúde</LinkInterno>.
        </p>
        <p>
          Em resumo: <strong>você pode levar seus dados embora e pode apagar tudo</strong>, a
          qualquer momento, em <em>Ajustes › Seus dados</em>.
        </p>
      </Secao>

      <Secao numero={8} titulo="Uso aceitável">
        <ul className="list-disc pl-5 space-y-1">
          <li>Não cadastre dados de alguém sem autorização dessa pessoa ou de quem a representa.</li>
          <li>Não tente acessar dados de outra família.</li>
          <li>Não automatize acesso ao serviço sem combinar antes.</li>
        </ul>
      </Secao>

      <Secao numero={9} titulo="Disponibilidade">
        <p>
          O ZELO é oferecido “como está”. Fazemos o possível para que os lembretes cheguem na hora,
          mas <strong>não garantimos entrega de notificação</strong>: ela depende do seu aparelho, do
          sistema operacional e da sua conexão.
        </p>
        <Destaque>
          <p>
            <strong>Não confie apenas no aplicativo para uma dose crítica.</strong>
          </p>
        </Destaque>
      </Secao>

      <Secao numero={10} titulo="Encerramento">
        <p>
          Você pode excluir sua conta a qualquer momento em <em>Ajustes › Seus dados</em>. A exclusão
          é agendada com <strong>sete dias de antecedência</strong> e pode ser cancelada nesse
          período — é a janela que protege contra exclusão feita por engano ou por alguém que tomou
          sua conta.
        </p>
        <p>Podemos encerrar contas que violem estes Termos.</p>
      </Secao>

      <Secao numero={11} titulo="Mudanças e contato">
        <p>Avisaremos por e-mail antes de mudanças relevantes.</p>
        <p>
          Fale conosco em{" "}
          <a href="mailto:contato@zelocuida.com.br" className="underline">
            contato@zelocuida.com.br
          </a>
          .
        </p>
      </Secao>
    </DocumentoLegal>
  );
}
