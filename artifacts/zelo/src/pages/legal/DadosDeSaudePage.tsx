/**
 * Política de Dados de Saúde — rota `/consentimento-saude`, Issue #76.
 *
 * É o documento mais sensível dos três: trata de **dado pessoal sensível** na
 * definição do art. 5º, II da LGPD, e é a base legal do produto inteiro.
 *
 * O cadastro já cita este documento como "versão v1.0 — rascunho, pendente de
 * revisão jurídica". A moldura repete esse aviso aqui: admitir lá e esconder
 * aqui seria pior que não ter o aviso.
 *
 * Cópia de revisão: `docs/legal/politica-de-dados-de-saude.md`.
 */
import { DocumentoLegal, Secao, Destaque, Tabela } from "./DocumentoLegal";

export default function DadosDeSaudePage() {
  return (
    <DocumentoLegal titulo="Política de Dados de Saúde" versao="v1.0" rascunho>
      <Secao numero={1} titulo="Por que este documento é separado">
        <p>
          Dado de saúde tem regra própria na LGPD. Não basta a Política de Privacidade geral: o
          art. 11 exige <strong>consentimento específico e destacado</strong> para tratar saúde, e
          “destacado” significa que não pode estar embutido num aceite genérico.
        </p>
        <p>
          Por isso o cadastro do ZELO pede <strong>dois consentimentos separados</strong>: um para os
          Termos de Uso, outro só para os dados de saúde.
        </p>
      </Secao>

      <Secao numero={2} titulo="De quem são estes dados">
        <Destaque>
          <p>
            <strong>Do paciente.</strong> Não de quem digita.
          </p>
          <p>
            Se o paciente tem condições de decidir por si, o consentimento precisa ser dele.
            Cadastrar alguém capaz sem que essa pessoa saiba não é permitido pelos Termos.
          </p>
        </Destaque>
        <p>Ao cadastrar um paciente, o aplicativo pergunta em qual situação você está:</p>
        <Tabela
          cabecalho={["Situação", "O que significa"]}
          linhas={[
            ["Sou o titular", "você está cadastrando a si mesmo"],
            ["Sou representante legal", "você responde legalmente por essa pessoa"],
          ]}
        />
        <p>
          A resposta é gravada com versão do texto, data, hora, endereço IP e navegador — um
          consentimento por paciente, nunca reaproveitado de outro.
        </p>
      </Secao>

      <Secao numero={3} titulo="Que dados de saúde são tratados">
        <ul className="list-disc pl-5 space-y-1">
          <li>Medicamentos, concentração, forma e posologia como está escrita na receita</li>
          <li>Horários e registros de dose: tomada, pulada, atrasada, e por quem foi registrada</li>
          <li>Consultas e compromissos de saúde</li>
          <li>Aferições — pressão, glicemia, peso e outras — como você digitou</li>
          <li>Estoque de medicamento</li>
          <li>Fotos, áudios e recados dos “momentos”, quando envolvem o paciente</li>
          <li>A foto da receita ou da caixa, quando você usa a leitura por foto</li>
        </ul>
      </Secao>

      <Secao numero={4} titulo="O que o ZELO não faz com esses dados">
        <p>
          Esta delimitação é estrutural — não é promessa de comportamento, é ausência de código que
          faria o contrário:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>Não prescreve e não sugere tratamento.</li>
          <li>Não calcula nem sugere dose.</li>
          <li>
            Não interpreta aferição. Não há faixa de referência, “normal” ou “alterado”, nem cor de
            alerta clínico. O valor volta como você digitou.
          </li>
          <li>Não verifica interação medicamentosa.</li>
          <li>
            Não toma decisão automatizada sobre nada. Ninguém é avaliado, classificado ou pontuado
            por esses dados.
          </li>
        </ul>
      </Secao>

      <Secao numero={5} titulo="Leitura de receita por foto">
        <ol className="list-decimal pl-5 space-y-1">
          <li>
            A foto vai para a Anthropic com a instrução de{" "}
            <strong>transcrever, nunca inferir</strong>.
          </li>
          <li>O que não estiver claramente legível volta vazio, e não chutado.</li>
          <li>O resultado aparece no formulário para você conferir e corrigir.</li>
          <li>
            <strong>Nada é salvo sem a sua confirmação.</strong> Não existe caminho no aplicativo que
            crie um tratamento direto da foto.
          </li>
          <li>
            Terminada a confirmação, <strong>a foto é apagada</strong>. Você precisa pedir
            explicitamente para mantê-la.
          </li>
        </ol>
      </Secao>

      <Secao numero={6} titulo="Fotos e áudios dos momentos">
        <p>
          Ficam <strong>90 dias</strong> e depois são apagados, a menos que alguém marque para
          guardar. Há um consentimento de imagem separado, por paciente, antes de qualquer foto do
          paciente ser publicada.
        </p>
      </Secao>

      <Secao numero={7} titulo="Quem vê">
        <p>
          Somente os cuidadores vinculados àquela família, no nível do papel de cada um. O servidor
          valida isso a cada requisição, contra o vínculo de quem está autenticado — nunca contra o
          que o aplicativo enviou.
        </p>
        <p>
          <strong>Nós não lemos os dados de saúde das famílias.</strong> O acesso técnico existe para
          operar e depurar o serviço, e é registrado.
        </p>
      </Secao>

      <Secao numero={8} titulo="Retirar o consentimento">
        <p>
          Você pode retirar a qualquer momento — e, na prática, isso é <strong>excluir o paciente ou
          a conta</strong>, em <em>Ajustes › Seus dados</em>.
        </p>
        <p>
          Retirar o consentimento significa que o ZELO não pode mais tratar aqueles dados, e portanto
          não pode mais prestar o serviço para aquele paciente. Não há meio termo: o produto inteiro
          é o tratamento desses dados.
        </p>
        <Destaque>
          <p>
            <strong>Antes de apagar, leve seus dados.</strong> A exportação entrega tudo em JSON e em
            PDF, e é a única forma de manter o histórico depois da exclusão.
          </p>
        </Destaque>
      </Secao>

      <Secao numero={9} titulo="Vazamento">
        <p>
          Em caso de incidente de segurança com risco relevante, comunicaremos os titulares afetados
          e a <strong>ANPD</strong>, como manda o art. 48 da LGPD.
        </p>
      </Secao>

      <Secao numero={10} titulo="Contato">
        <p>
          <a href="mailto:contato@zelocuida.com.br" className="underline">
            contato@zelocuida.com.br
          </a>
        </p>
      </Secao>
    </DocumentoLegal>
  );
}
