/**
 * Serviço de e-mail — ZELO.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ATÉ 02/09/2026 ESTE ARQUIVO NÃO ENVIAVA NADA.
 *
 * As quatro funções abaixo escreviam um `logger.warn` em produção e voltavam.
 * A auditoria §10 (23/08/2026) encontrou a consequência: quem se cadastrava por
 * e-mail e senha ficava preso para sempre, porque o login exige `emailVerified`
 * e o link nunca chegava. A fase 11.1a tapou o buraco recusando o cadastro; esta
 * fase (11.1b) o resolve.
 *
 * A cadeia que travava isso — nome definitivo → domínio verificado por DNS →
 * provedor de e-mail — fechou em 02/09/2026. Ver a Issue #73.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que `fetch` e não o SDK do Resend ─────────────────────────────────
 *
 * A superfície usada é UM endpoint HTTP. O SDK traria uma dependência, uma
 * árvore de tipos e uma cadência de atualização para embrulhar um `POST` de
 * doze linhas. O Node 24 já tem `fetch` e `AbortSignal.timeout` nativos.
 *
 * ── Por que nada aqui lança exceção ───────────────────────────────────────
 *
 * Não é preferência de estilo, é segurança. `POST /auth/password-reset/request`
 * só chama o envio **quando a conta existe** — é assim que ele evita confirmar
 * quem está cadastrado. Se uma falha de envio virasse exceção, a rota
 * responderia 500 para e-mail existente e 200 para inexistente: um oráculo de
 * enumeração de contas, entregue de graça a quem souber ler um código HTTP.
 *
 * Toda função devolve `boolean`. Quem chama decide o que fazer com `false`.
 *
 * ── O que NUNCA aparece em log ────────────────────────────────────────────
 *
 * Endereço do destinatário, token, e o link (que carrega o token). O log de
 * falha usa `safeLog`, cuja lista de permissão **descarta o que não estiver
 * nela** — é uma trava, não um lembrete. O único texto livre que sai do
 * provedor é o campo `name` da resposta de erro, que é um código estável
 * (`validation_error`, `rate_limit_exceeded`); a `message`, que pode conter o
 * endereço recusado, é deliberadamente descartada.
 */

import { logger } from "./logger";
import { safeLog } from "./safe-logger";
import { IS_PRODUCTION as isProduction } from "./environment.ts";

const ENDPOINT = "https://api.resend.com/emails";

/** Um envio lento não pode segurar a resposta do cadastro para sempre. */
const TEMPO_LIMITE_MS = 10_000;

/**
 * O plano gratuito do Resend aceita 2 requisições por segundo. O aviso de
 * exclusão vai para todos os cuidadores da família, um e-mail por pessoa —
 * então estourar o limite é possível. Uma tentativa a mais, depois de esperar,
 * resolve sem transformar isto numa fila.
 */
const ESPERA_APOS_429_MS = 1_100;

/**
 * Remetente. `contato@zelocuida.com.br` de propósito, e não um `nao-responda@`:
 * o endereço recebe de verdade (Cloudflare Email Routing encaminha para a caixa
 * do fundador), então quem responder a um e-mail do ZELO é lido por alguém. Num
 * produto para famílias com idosos, responder o e-mail é a reação natural — e
 * cair no vazio é uma resposta pior do que nenhuma.
 */
const REMETENTE = process.env.EMAIL_FROM ?? "ZELO <contato@zelocuida.com.br>";

// Paleta da marca — a mesma de `routes/dashboard.ts`. Sem vermelho em lugar
// nenhum: o invariante 5 o proíbe em contexto de dose, e um e-mail de aviso não
// é lugar de estrear a exceção.
const COR_TEXTO = "#2D2D2B";
const COR_TEXTO_SUAVE = "#6B6B6B";
const COR_FUNDO = "#F8F7F5";
const COR_VERDE = "#659A76";
const COR_BORDA = "#EDEBE7";

/**
 * Endereço público do app, lido a cada chamada.
 *
 * Lido na chamada e não na carga do módulo porque `hasEmailProvider()` abaixo
 * depende dele, e o teste de guardrail reimporta o módulo para exercitar as
 * duas pontas.
 */
function baseUrl(): string {
  return process.env.APP_URL ?? "http://localhost:5173";
}

let jaAvisouDaBaseUrl = false;

/**
 * `APP_URL` é um endereço http(s) absoluto?
 *
 * `new URL()` sozinho não basta: ele aceita `mailto:`, `javascript:` e
 * qualquer outro esquema. O que serve para montar link de e-mail é http ou
 * https, e mais nada.
 */
function ehEnderecoAbsoluto(valor: string | undefined): boolean {
  if (typeof valor !== "string" || valor.length === 0) return false;
  try {
    const url = new URL(valor);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Existe provedor de e-mail configurado?
 *
 * Mesmo padrão do `isConfigured()` do Google (ver routes/google-auth.ts): uma
 * capacidade que pode faltar, declarada em vez de suposta.
 *
 * **Por que isto existe.** A auditoria §10 (23/08/2026) encontrou que nenhum
 * e-mail era enviado em produção. Como o login exige `emailVerified` e a
 * auto-verificação só roda em desenvolvimento, quem se cadastrava por e-mail e
 * senha ficava preso para sempre, sem nenhum sinal para ninguém. Com esta
 * função, o servidor para de criar contas que jamais poderão ser verificadas:
 * ele diz, antes de criar, que o caminho é o Google.
 *
 * **Por que `APP_URL` conta como parte do provedor.** Sem ela, `baseUrl()` cai
 * em `http://localhost:5173` e todo link sai apontando para a máquina de quem
 * lê. O e-mail chega, parece perfeito, e é inútil — a pior falha das três, por
 * ser a única silenciosa. Faltando a variável em produção é melhor recusar o
 * cadastro e mandar pelo Google, que é exatamente o caminho que a fase 11.1a já
 * construiu. Em desenvolvimento e em teste a exigência não vale: ali o
 * `localhost` é o endereço certo.
 *
 * **E precisa ser uma URL, não qualquer string.** Em 03/09/2026 a variável foi
 * configurada como `206f61db-....replit.dev`, sem `https://`. Ela existia, a
 * checagem passava, e todo link saía relativo e quebrado. Uma variável que
 * "existe" e não é endereço é o mesmo problema de não existir, com a checagem
 * dando o aval.
 *
 * O que isto NÃO pega é `APP_URL` bem formada apontando para um app que não
 * está no ar — foi o caso do dia seguinte. Não há como conferir isso na carga
 * do processo, e é justamente por isso que a redefinição de senha deixou de
 * usar link (Issue #102).
 *
 * O provedor escolhido é o Resend (ver planning/decisoes/PLATFORM_DECISIONS.md
 * §11). Enquanto `RESEND_API_KEY` não existir, não há provedor.
 */
export function hasEmailProvider(): boolean {
  const chave = process.env.RESEND_API_KEY;
  if (typeof chave !== "string" || chave.length === 0) return false;

  if (isProduction && !ehEnderecoAbsoluto(process.env.APP_URL)) {
    // Uma vez por processo: é erro de configuração, não evento de tráfego.
    if (!jaAvisouDaBaseUrl) {
      jaAvisouDaBaseUrl = true;
      safeLog.error(
        { action: "email_sem_app_url" },
        "RESEND_API_KEY existe mas APP_URL nao e uma URL http(s) absoluta: todo link sairia quebrado, entao o envio fica desligado. Defina APP_URL nos Secrets, com https:// na frente.",
      );
    }
    return false;
  }

  return true;
}

function devLog(label: string, link: string): void {
  // O link CARREGA o token (verificação, reset de senha, convite) — quem lê
  // o log assume a conta. Por isso só é impresso quando o ambiente está
  // EXPLICITAMENTE marcado como desenvolvimento: antes, um ambiente sem
  // NODE_ENV definido (o deploy do Replit) escrevia estes links no log de
  // produção. Ver lib/environment.ts.
  //
  // Usa `logger` cru, e não `safeLog`, de propósito: `link` não está na lista
  // de permissão — e não deve estar. Aqui a exposição é a função.
  if (!isProduction) {
    logger.info({ link }, `[DEV EMAIL] ${label}`);
  }
}

/** Uma mensagem, descrita uma vez só. */
type Mensagem = {
  para: string;
  assunto: string;
  titulo: string;
  paragrafos: string[];
  /**
   * Botão. Opcional desde a Issue #77: o e-mail de verificação passou a levar
   * um CÓDIGO e não tem para onde apontar — mandar a pessoa a uma tela que vai
   * pedir o código que já está no e-mail é um clique sem função.
   */
  acao?: { rotulo: string; url: string };
  /**
   * Código de 6 dígitos, exibido grande. Ver `lib/codigo-de-verificacao.ts`.
   *
   * O fundador pediu explicitamente para **poder copiar e colar**, então nada
   * de separar os dígitos em caixinhas aqui: é um texto contínuo, e selecionar
   * devolve "123456" limpo, sem espaço no meio.
   */
  codigo?: string;
  /** Linha final, em cinza: prazo e o que fazer se não foi você. */
  aviso: string;
};

function escapar(texto: string): string {
  return texto
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * HTML e texto puro saem da MESMA `Mensagem`, e é o ponto destas duas funções.
 * Manter duas versões escritas à mão é como elas divergem: alguém corrige o
 * prazo no HTML, esquece o texto, e metade dos leitores recebe a informação
 * velha sem ninguém perceber — porque quase ninguém lê a versão texto.
 *
 * Tabela e estilo em atributo não são desleixo: é o que cliente de e-mail
 * renderiza. Não existe folha de estilo externa aqui.
 */
function montarHtml(m: Mensagem): string {
  const paragrafos = m.paragrafos
    .map(
      (p) =>
        `<p style="margin:0 0 12px;font-size:16px;line-height:1.6;color:${COR_TEXTO};">${escapar(p)}</p>`,
    )
    .join("");

  // O código vem numa caixa larga e com fonte monoespaçada: é o que faz seis
  // dígitos serem lidos de uma vez por quem não enxerga bem, e o que faz o
  // toque-e-arrasta do celular pegar o número inteiro.
  const bloco = m.codigo
    ? `<tr><td style="padding:20px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>
<td align="center" style="background:${COR_FUNDO};border:1px solid ${COR_BORDA};border-radius:12px;padding:20px;font-family:'SFMono-Regular',Consolas,'Liberation Mono',Menlo,monospace;font-size:34px;font-weight:700;letter-spacing:6px;color:${COR_TEXTO};">${escapar(m.codigo)}</td>
</tr></table>
</td></tr>`
    : m.acao
      ? `<tr><td style="padding:20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${COR_VERDE};border-radius:8px;">
<a href="${escapar(m.acao.url)}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">${escapar(m.acao.rotulo)}</a>
</td></tr></table>
</td></tr>`
      : "";

  const rodapeDoLink = m.acao
    ? `<p style="margin:0;">Se o bot&atilde;o n&atilde;o funcionar, copie e cole este endere&ccedil;o no navegador:<br><span style="word-break:break-all;">${escapar(m.acao.url)}</span></p>`
    : "";

  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapar(m.assunto)}</title>
</head>
<body style="margin:0;padding:0;background:${COR_FUNDO};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${COR_FUNDO};padding:24px 12px;">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;background:#FFFFFF;border-radius:12px;padding:32px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<tr><td style="padding-bottom:16px;font-size:20px;font-weight:600;color:${COR_TEXTO};">${escapar(m.titulo)}</td></tr>
<tr><td>${paragrafos}</td></tr>
${bloco}
<tr><td style="font-size:14px;line-height:1.6;color:${COR_TEXTO_SUAVE};">
<p style="margin:0 0 12px;">${escapar(m.aviso)}</p>
${rodapeDoLink}
</td></tr>
<tr><td style="padding-top:24px;border-top:1px solid ${COR_BORDA};font-size:13px;color:${COR_TEXTO_SUAVE};">
ZELO &mdash; cuidado compartilhado para fam&iacute;lias
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

function montarTexto(m: Mensagem): string {
  const bloco = m.codigo
    ? [m.codigo, ""]
    : m.acao
      ? [`${m.acao.rotulo}:`, m.acao.url, ""]
      : [];

  return [
    m.titulo,
    "",
    ...m.paragrafos.flatMap((p) => [p, ""]),
    ...bloco,
    m.aviso,
    "",
    "—",
    "ZELO — cuidado compartilhado para famílias",
  ].join("\n");
}

/** Código estável do erro do provedor, sem texto livre. Ver o cabeçalho. */
async function codigoDoErro(resposta: Response): Promise<string> {
  try {
    const corpo = (await resposta.json()) as { name?: unknown };
    return typeof corpo.name === "string" ? corpo.name : "sem_codigo";
  } catch {
    return "resposta_ilegivel";
  }
}

/**
 * O envio propriamente dito. Nunca lança — ver o cabeçalho do arquivo.
 *
 * @returns `true` se o provedor aceitou a mensagem. Aceitar não é entregar:
 *   caixa cheia e marcação como spam acontecem depois e não aparecem aqui.
 */
async function enviar(m: Mensagem, tipo: string): Promise<boolean> {
  const chave = process.env.RESEND_API_KEY;
  if (typeof chave !== "string" || chave.length === 0) return false;

  const corpo = JSON.stringify({
    from: REMETENTE,
    to: [m.para],
    subject: m.assunto,
    html: montarHtml(m),
    text: montarTexto(m),
  });

  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    try {
      const resposta = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${chave}`,
          "Content-Type": "application/json",
        },
        body: corpo,
        signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      });

      if (resposta.ok) return true;

      // 429 é o limite de 2 req/s do plano gratuito. Esperar e repetir uma vez
      // só resolve o caso real (vários cuidadores em sequência) sem virar fila.
      if (resposta.status === 429 && tentativa === 1) {
        await new Promise((r) => setTimeout(r, ESPERA_APOS_429_MS));
        continue;
      }

      safeLog.error(
        { action: "email_recusado", status: resposta.status, outcome: await codigoDoErro(resposta), entityType: tipo },
        "O provedor recusou o envio de e-mail",
      );
      return false;
    } catch (erro) {
      // `AbortSignal.timeout` lança `TimeoutError`; rede fora lança `TypeError`.
      // Só o NOME da exceção vai pro log: a mensagem de erro de rede costuma
      // trazer a URL, e um dia dessas URLs pode ter um identificador.
      safeLog.error(
        { action: "email_falhou", outcome: erro instanceof Error ? erro.name : "desconhecido", entityType: tipo },
        "Falha ao falar com o provedor de e-mail",
      );
      return false;
    }
  }

  return false;
}

/**
 * Envia o código de verificação de conta — Issue #77.
 *
 * O código vai **no assunto também**, como fazem GitHub e banco: dá para ler na
 * notificação do celular sem abrir o e-mail, sem trocar de aplicativo, sem
 * perder de vista a tela onde ele vai ser digitado. Num público que não navega
 * com desenvoltura entre janelas, isso vale mais do que parece.
 *
 * Não há link nenhum aqui, e é de propósito: quem está lendo já tem a tela do
 * código aberta do outro lado.
 */
export async function sendVerificationEmail(email: string, codigo: string): Promise<boolean> {
  // O código NÃO passa pelo devLog. O link antigo era impresso em
  // desenvolvimento porque não havia outro jeito de pegá-lo; o código aparece
  // na tela do próprio e-mail e, sem provedor, a conta se auto-verifica de
  // qualquer forma. Imprimir seria expor credencial sem ganhar nada.
  devLog("Código de verificação emitido", `${baseUrl()}/verificar-email`);

  return enviar(
    {
      para: email,
      assunto: `${codigo} é o seu código de confirmação — ZELO`,
      titulo: "Seu código de confirmação",
      paragrafos: [
        "Digite este código na tela do ZELO para confirmar sua conta:",
      ],
      codigo,
      aviso: "O código vale 10 minutos e só serve uma vez. Se não foi você quem criou a conta, ignore este e-mail — sem o código, nada acontece.",
    },
    "verificacao",
  );
}

/**
 * Código para confirmar o endereço NOVO, numa troca de e-mail — Issue #46.
 *
 * Vai para o endereço novo, e é a prova de que quem pediu a troca controla o
 * destino. Sem isso, um erro de digitação viraria conta inacessível e um
 * atacante escreveria o próprio endereço na conta alheia.
 */
export async function sendEmailChangeCode(novoEmail: string, codigo: string): Promise<boolean> {
  devLog("Código de troca de e-mail emitido", `${baseUrl()}/ajustes/conta`);

  return enviar(
    {
      para: novoEmail,
      assunto: `${codigo} é o seu código para trocar o e-mail — ZELO`,
      titulo: "Confirme este endereço",
      paragrafos: [
        "Alguém pediu para passar a usar este endereço como e-mail de acesso ao ZELO. Digite o código na tela do aplicativo para confirmar.",
      ],
      codigo,
      aviso: "O código vale 10 minutos. Se você não pediu isso, ignore este e-mail — sem o código, a troca não acontece e a conta continua com o endereço atual.",
    },
    "troca_de_email",
  );
}

/**
 * Aviso ao endereço ANTIGO de que a troca foi pedida — Issue #46.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE É O E-MAIL QUE SALVA UMA CONTA SEQUESTRADA.
 *
 * Os outros dois controles da troca — senha atual e código no endereço novo —
 * já falharam quando alguém está sentado numa sessão aberta e conhece a senha.
 * Este aviso é o único que chega a quem foi lesado, e é o que dá a ela a
 * chance de reagir antes de perder o acesso.
 *
 * Ele sai **quando a troca é PEDIDA**, não quando é concluída: avisar depois é
 * avisar tarde.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O endereço novo aparece por inteiro, e não mascarado: quem lê é a dona da
 * conta, e o endereço é a prova do que aconteceu.
 */
export async function sendEmailChangeWarning(
  emailAntigo: string,
  novoEmail: string,
): Promise<boolean> {
  const link = `${baseUrl()}/ajustes/conta`;
  devLog("Aviso de troca de e-mail ao endereço antigo", link);

  return enviar(
    {
      para: emailAntigo,
      assunto: "Pediram para trocar o e-mail da sua conta — ZELO",
      titulo: "Alguém pediu para trocar seu e-mail",
      paragrafos: [
        `Foi pedida a troca do e-mail de acesso da sua conta no ZELO para ${novoEmail}.`,
        "Se foi você, não precisa fazer nada: basta confirmar o código que enviamos para o endereço novo.",
        "Se NÃO foi você, alguém tem acesso à sua conta. Troque sua senha agora — isso encerra todas as sessões abertas e cancela a troca.",
      ],
      acao: { rotulo: "Trocar minha senha agora", url: link },
      aviso: "Enquanto o código não for confirmado, seu e-mail de acesso continua sendo este.",
    },
    "aviso_de_troca_de_email",
  );
}

/**
 * Envia o código de redefinição de senha — Issue #102.
 *
 * ── Era um link, e o link quebrou ─────────────────────────────────────────
 *
 * Em 03/09/2026 o fundador ficou sem conseguir trocar a senha. O e-mail chegou
 * perfeito e o botão levava a uma página de erro do Replit: `APP_URL` apontava
 * para um app que nunca foi publicado.
 *
 * Terceiro tropeço na mesma variável em dois dias — antes ela esteve ausente,
 * e depois sem `https://`. **O problema não era a variável, era depender de
 * link.** A verificação de conta já tinha feito esta troca na Issue #77, pela
 * mesma razão, e não deu mais problema.
 *
 * ── Nenhum link, de propósito ─────────────────────────────────────────────
 *
 * Quem lê este e-mail acabou de pedir a redefinição, e a tela que pede o
 * código já está aberta do outro lado. Um link só acrescentaria uma forma de
 * falhar — e, como se viu, ela falha.
 *
 * O código vai **no assunto também**, como no e-mail de confirmação: dá para
 * ler na notificação do celular sem abrir o e-mail.
 */
export async function sendPasswordResetEmail(email: string, codigo: string): Promise<boolean> {
  // O código NÃO passa pelo devLog — mesma regra do código de confirmação.
  // Imprimir credencial no log de desenvolvimento não ganha nada: em
  // desenvolvimento o e-mail sai no console inteiro de qualquer forma.
  devLog("Redefinição de senha pedida", `${baseUrl()}/redefinir-senha`);

  return enviar(
    {
      para: email,
      assunto: `${codigo} é o seu código para redefinir a senha — ZELO`,
      titulo: "Vamos redefinir sua senha",
      paragrafos: [
        "Alguém pediu uma nova senha para a sua conta no ZELO. Digite este código na tela do aplicativo:",
      ],
      codigo,
      aviso: "O código vale 10 minutos e só serve uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.",
    },
    "reset_de_senha",
  );
}

/**
 * Notifica cuidadores sobre solicitação de exclusão de dados.
 *
 * Um e-mail por pessoa, em sequência — nunca um só com todos no `to`. Os
 * endereços dos outros cuidadores não são de quem recebe: a rota de exportação
 * já os omite pelo mesmo motivo (ver routes/export.ts).
 *
 * @returns `true` só se TODOS foram aceitos. Este aviso é o que permite reagir
 *   a uma exclusão que ninguém pediu; um envio parcial não é sucesso.
 */
export async function sendDeletionNotification(
  emails: string[],
  scheduledAt: Date,
): Promise<boolean> {
  // Fuso fixo de São Paulo, e não o do servidor. No Replit o processo roda em
  // UTC, então uma exclusão marcada para 02:00Z sairia com a data do dia
  // seguinte — num aviso legal, com prazo, sobre apagar tudo.
  const dataStr = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(scheduledAt);

  const link = `${baseUrl()}/ajustes/seus-dados`;
  devLog(`Notificação de exclusão agendada para ${dataStr}`, link);

  let todosAceitos = true;
  for (const email of emails) {
    const aceito = await enviar(
      {
        para: email,
        assunto: "Pedido de exclusão dos dados — ZELO",
        titulo: "A exclusão dos dados foi pedida",
        paragrafos: [
          `Alguém com acesso à sua família pediu a exclusão de todos os dados no ZELO. Está marcada para ${dataStr}.`,
          "Até essa data dá para cancelar, e é reversível com um toque. Depois dela, não.",
        ],
        acao: { rotulo: "Ver ou cancelar", url: link },
        aviso: "Se não foi você quem pediu, cancele agora e troque sua senha.",
      },
      "exclusao",
    );
    if (!aceito) todosAceitos = false;
  }

  return todosAceitos;
}

/** Envia e-mail de convite para cuidador. */
export async function sendCaregiverInviteEmail(email: string, token: string): Promise<boolean> {
  const link = `${baseUrl()}/convite?token=${token}`;
  devLog("Convite de cuidador", link);

  // Nada aqui nomeia o paciente nem quem convidou: o invariante 3 vale para
  // e-mail tanto quanto para log, e a função só recebe endereço e token de
  // qualquer forma. Quem aceitar vê o nome dentro do app, autenticado.
  return enviar(
    {
      para: email,
      assunto: "Você foi convidado para cuidar junto — ZELO",
      titulo: "Um convite para cuidar junto",
      paragrafos: [
        "Você recebeu um convite para acompanhar o cuidado de alguém no ZELO — remédios, consultas e aferições, tudo num lugar só.",
        "Ao aceitar, você passa a ver e a registrar junto com o resto da família, sem ninguém duplicar o que o outro já fez.",
      ],
      acao: { rotulo: "Aceitar o convite", url: link },
      aviso: "O convite tem prazo. Se você não reconhece quem convidou, ignore este e-mail.",
    },
    "convite",
  );
}

/**
 * Código para confirmar o endereço de RECUPERAÇÃO — Issue #87.
 *
 * Vai para o endereço reserva, e é a prova de que alguém o controla. Sem essa
 * prova, o reserva é pior que nenhum: ele dá a sensação de rede de proteção, e
 * a pessoa só descobre que não havia rede no dia em que cai.
 *
 * Não confundir com `sendEmailChangeCode`: aquele troca a identidade de login,
 * este cadastra um segundo endereço de poder menor. Os dois mandam código para
 * um endereço novo, e é só o que têm em comum.
 */
export async function sendRecoveryEmailCode(emailReserva: string, codigo: string): Promise<boolean> {
  devLog("Código de e-mail de recuperação emitido", `${baseUrl()}/ajustes/conta`);

  return enviar(
    {
      para: emailReserva,
      assunto: `${codigo} é o seu código de recuperação — ZELO`,
      titulo: "Confirme este endereço de recuperação",
      paragrafos: [
        "Alguém indicou este endereço como e-mail de recuperação de uma conta no ZELO. Digite este código na tela do aplicativo para confirmar:",
      ],
      codigo,
      aviso:
        "O código vale 10 minutos. Este endereço serve só para recuperar o acesso — ele não entra na conta, não troca a senha e não recebe dados de saúde. Se você não esperava este e-mail, ignore: sem o código, nada acontece.",
    },
    "codigo_de_recuperacao",
  );
}

/**
 * Aviso ao endereço PRINCIPAL de que um reserva foi cadastrado — Issue #87.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * É O MESMO PAPEL DO AVISO DA ISSUE #46, E PELA MESMA RAZÃO: SE QUEM PEDIU NÃO
 * FOI A DONA DA CONTA, ESTE E-MAIL É A ÚNICA COISA QUE A AVISA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Um atacante com sessão aberta que cadastre o próprio endereço como reserva
 * ganha, no futuro (#79), um caminho para receber o código de aparelho novo.
 * Ele ainda precisa da senha — o limite de poder do reserva garante isso — mas
 * o aviso é o que dá à vítima a chance de reagir antes disso importar.
 *
 * Vai quando o reserva é **pedido**, e não quando é confirmado: avisar só no
 * fim é avisar tarde.
 */
export async function sendRecoveryEmailWarning(
  emailPrincipal: string,
  emailReserva: string,
): Promise<boolean> {
  const link = `${baseUrl()}/ajustes/conta`;
  devLog("Aviso de e-mail de recuperação ao endereço principal", link);

  return enviar(
    {
      para: emailPrincipal,
      assunto: "Cadastraram um e-mail de recuperação na sua conta — ZELO",
      titulo: "Um e-mail de recuperação foi cadastrado",
      paragrafos: [
        `Foi indicado o endereço ${emailReserva} como e-mail de recuperação da sua conta no ZELO.`,
        "Se foi você, não precisa fazer nada: basta confirmar o código que enviamos para esse endereço.",
        "Se NÃO foi você, alguém tem acesso à sua conta. Troque sua senha agora — isso encerra todas as sessões abertas.",
      ],
      acao: { rotulo: "Trocar minha senha agora", url: link },
      aviso:
        "O endereço de recuperação não entra na sua conta e não troca sua senha. Ele só serve para você voltar caso perca o acesso a este e-mail.",
    },
    "aviso_de_email_de_recuperacao",
  );
}

/**
 * Avisa quem foi resgatado — Issue #87.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SE A PESSOA NÃO PEDIU O RESGATE, ESTE E-MAIL É A ÚNICA COISA QUE A AVISA.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O resgate pela família não concede poder novo ao cuidador principal — ele já
 * via e fazia tudo naquela família. O que ele abre é um caminho para **pular o
 * segundo fator** de outra pessoa, e isso importa quando alguém já tem a senha
 * dela.
 *
 * O aviso é a contrapartida. Mesmo papel do aviso de troca de e-mail (#46): não
 * impede o abuso, mas tira dele o silêncio.
 *
 * O nome de quem resgatou vai por inteiro. Quem lê precisa saber de quem
 * cobrar explicação — e as duas pessoas já compartilham os dados de saúde de um
 * paciente, então não há nada a proteger escondendo.
 */
export async function sendRescueNotice(
  emailResgatado: string,
  nomeDeQuemResgatou: string,
  nomeDaFamilia: string,
  validoAte: Date,
): Promise<boolean> {
  const link = `${baseUrl()}/ajustes/conta`;
  devLog("Aviso de resgate de acesso", link);

  const quando = validoAte.toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  });

  return enviar(
    {
      para: emailResgatado,
      assunto: "Seu acesso ao ZELO foi restaurado — ZELO",
      titulo: "Restauraram o seu acesso",
      paragrafos: [
        `${nomeDeQuemResgatou}, cuidador principal da família ${nomeDaFamilia}, restaurou o seu acesso ao ZELO.`,
        `Isso significa que a sua próxima entrada, até ${quando}, não vai pedir o código de aparelho novo. Sua senha continua sendo necessária.`,
        "Se foi você quem pediu, não precisa fazer nada — é só entrar.",
        "Se NÃO foi você, troque sua senha agora e fale com essa pessoa. O resgate não dá acesso à sua conta sozinho, mas com a sua senha daria.",
      ],
      acao: { rotulo: "Trocar minha senha", url: link },
      aviso: "O resgate vale uma vez só, e expira sozinho se você não usar.",
    },
    "aviso_de_resgate",
  );
}
