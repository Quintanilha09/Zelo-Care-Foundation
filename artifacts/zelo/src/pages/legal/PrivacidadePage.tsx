/**
 * Política de Privacidade — rota `/privacidade`, Issue #76.
 *
 * A seção 2 é a que organiza o documento inteiro: **o titular dos dados é o
 * paciente, não o cuidador que digita.** É a distinção que quase todo app de
 * saúde erra, e a que o produto já implementa ao perguntar, em cada paciente,
 * se você consente como titular ou como representante legal.
 *
 * Cópia de revisão: `docs/legal/politica-de-privacidade.md`.
 */
import { DocumentoLegal, Secao, Destaque, Tabela } from "./DocumentoLegal";

export default function PrivacidadePage() {
  return (
    <DocumentoLegal titulo="Política de Privacidade" versao="v1.0" rascunho>
      <Secao numero={1} titulo="Quem trata os seus dados">
        <p>
          O ZELO. Enquanto a pessoa jurídica não é constituída, o responsável pelo tratamento pode
          ser contatado em{" "}
          <a href="mailto:contato@zelocuida.com.br" className="underline">
            contato@zelocuida.com.br
          </a>
          .
        </p>
        <p>
          <strong>Encarregado de dados (DPO):</strong> em definição. Até lá, use o mesmo endereço
          para exercer qualquer direito previsto na LGPD — ele é lido por uma pessoa.
        </p>
      </Secao>

      <Secao numero={2} titulo="Quem é o titular dos dados">
        <Destaque>
          <p>
            <strong>O titular dos dados de saúde é o paciente</strong>, não o cuidador que digitou.
          </p>
        </Destaque>
        <p>
          Quem usa o aplicativo é, quase sempre, um filho, um cônjuge ou um cuidador contratado — e
          os dados que ele registra são de <strong>outra pessoa</strong>. Por isso o aplicativo
          pergunta, ao cadastrar um paciente, se você está consentindo como o próprio titular ou
          como representante legal, e guarda a resposta.
        </p>
        <p>
          Se o paciente tem condições de decidir por si, o consentimento é dele, e você está agindo a
          pedido dele.
        </p>
      </Secao>

      <Secao numero={3} titulo="O que coletamos">
        <p>
          <strong>Da sua conta:</strong> nome, e-mail e uma senha guardada como hash — nunca em
          texto legível. Se você entra pelo Google, não guardamos senha nenhuma.
        </p>
        <p>
          <strong>Do paciente:</strong> nome, data de nascimento, fuso horário e as observações que
          você escrever.
        </p>
        <p>
          <strong>Do cuidado:</strong> tratamentos e medicamentos, horários, doses registradas (com
          quem registrou e quando), consultas, aferições, estoque, e os “momentos” — fotos, áudios e
          recados que a família compartilha.
        </p>
        <p>
          <strong>Técnicos:</strong> endereço IP e navegador nos registros de acesso e de auditoria,
          para segurança. Inscrições de notificação, se você autorizar.
        </p>
      </Secao>

      <Secao numero={4} titulo="Por que tratamos, e com qual base legal">
        <Tabela
          cabecalho={["Para quê", "Base legal (LGPD)"]}
          linhas={[
            ["Prestar o serviço que você contratou", "execução de contrato — art. 7º, V"],
            ["Tratar dados de saúde do paciente", "consentimento específico e destacado — art. 11, I"],
            ["Segurança, auditoria e prevenção a fraude", "legítimo interesse — art. 7º, IX"],
            ["Cumprir obrigação legal", "art. 7º, II"],
          ]}
        />
      </Secao>

      <Secao numero={5} titulo="Com quem compartilhamos">
        <p>
          <strong>Não vendemos seus dados. Não usamos seus dados para publicidade.</strong>
        </p>
        <p>Usamos estes fornecedores para operar:</p>
        <Tabela
          cabecalho={["Fornecedor", "Para quê", "O que vê"]}
          linhas={[
            ["Replit", "hospedagem, banco e armazenamento de fotos e áudios", "tudo que o serviço guarda"],
            ["Anthropic", "ler a receita ou a caixa do medicamento por foto", "só a foto enviada para isso, no momento do envio"],
            ["Resend", "enviar os e-mails do aplicativo", "seu e-mail e o conteúdo da mensagem"],
            ["Cloudflare", "DNS e encaminhamento do e-mail de contato", "tráfego de rede e e-mails enviados ao contato"],
            ["Google", "entrar com Google e autocompletar endereço de consulta — os dois opcionais", "seu e-mail no login; o texto digitado no campo de endereço"],
          ]}
        />
        <p>
          <strong>Sobre a Anthropic:</strong> a foto vai numa chamada de API e é usada só para gerar
          a resposta daquela chamada. Pela política da API, conteúdo enviado por API não é usado para
          treinar modelos.
        </p>
      </Secao>

      <Secao numero={6} titulo="Por quanto tempo guardamos">
        <Tabela
          cabecalho={["O quê", "Prazo"]}
          linhas={[
            ["Fotos, áudios e recados", "90 dias, e depois apagados — a menos que alguém marque para guardar"],
            ["Foto de receita enviada para leitura", "apagada assim que você confirma o formulário. O padrão nunca é reter"],
            ["Dados da conta e do cuidado", "enquanto a conta existir"],
            ["Registro de auditoria", "mantido para segurança e rastreabilidade"],
          ]}
        />
      </Secao>

      <Secao numero={7} titulo="Seus direitos">
        <p>
          A LGPD garante acesso, correção, portabilidade e eliminação. No ZELO, os dois mais
          importantes <strong>não dependem de pedir a ninguém</strong> — estão em{" "}
          <em>Ajustes › Seus dados</em>:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Levar seus dados embora:</strong> gera um arquivo com tudo, em JSON (para outro
            sistema importar) e em PDF (para você ler).
          </li>
          <li>
            <strong>Apagar tudo:</strong> agendado com sete dias de antecedência, cancelável nesse
            período. Depois disso os dados são apagados de verdade, e as fotos e áudios saem também
            do armazenamento.
          </li>
        </ul>
      </Secao>

      <Secao numero={8} titulo="Como protegemos">
        <ul className="list-disc pl-5 space-y-1">
          <li>Senha guardada como hash Argon2.</li>
          <li>
            Todo acesso a dados de paciente é validado no servidor contra o vínculo familiar. Dado de
            outra família responde como <em>inexistente</em> — nem a existência dele é revelada.
          </li>
          <li>
            Nenhum registro de log contém nome de medicamento, condição de saúde ou identificação de
            paciente.
          </li>
          <li>Sessões podem ser encerradas em todos os aparelhos de uma vez.</li>
          <li>Registro de auditoria imutável das ações relevantes.</li>
        </ul>
      </Secao>

      <Secao numero={9} titulo="Crianças">
        <p>
          O ZELO é para maiores de 18 anos. Um paciente pode ser menor de idade — nesse caso o
          cadastro é feito pelo representante legal, que responde pelo consentimento.
        </p>
      </Secao>

      <Secao numero={10} titulo="Reclamações">
        <p>
          Você pode reclamar à <strong>ANPD</strong> — Autoridade Nacional de Proteção de Dados — se
          achar que seus direitos não foram respeitados.
        </p>
      </Secao>
    </DocumentoLegal>
  );
}
