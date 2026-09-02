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
 * O provedor escolhido é o Resend (ver planning/decisoes/PLATFORM_DECISIONS.md
 * §11). Enquanto `RESEND_API_KEY` não existir, não há provedor.
 */
export function hasEmailProvider(): boolean {
  const chave = process.env.RESEND_API_KEY;
  if (typeof chave !== "string" || chave.length === 0) return false;

  if (isProduction && process.env.APP_URL === undefined) {
    // Uma vez por processo: é erro de configuração, não evento de tráfego.
    if (!jaAvisouDaBaseUrl) {
      jaAvisouDaBaseUrl = true;
      safeLog.error(
        { action: "email_sem_app_url" },
        "RESEND_API_KEY existe mas APP_URL nao: todo link sairia apontando para localhost, entao o envio fica desligado. Defina APP_URL nos Secrets.",
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
  acao: { rotulo: string; url: string };
  /** Linha final, em cinza: prazo do link e o que fazer se não foi você. */
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

  const url = escapar(m.acao.url);

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
<tr><td style="padding:20px 0;">
<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>
<td style="background:${COR_VERDE};border-radius:8px;">
<a href="${url}" style="display:inline-block;padding:14px 28px;font-size:16px;font-weight:600;color:#FFFFFF;text-decoration:none;">${escapar(m.acao.rotulo)}</a>
</td></tr></table>
</td></tr>
<tr><td style="font-size:14px;line-height:1.6;color:${COR_TEXTO_SUAVE};">
<p style="margin:0 0 12px;">${escapar(m.aviso)}</p>
<p style="margin:0;">Se o bot&atilde;o n&atilde;o funcionar, copie e cole este endere&ccedil;o no navegador:<br><span style="word-break:break-all;">${url}</span></p>
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
  return [
    m.titulo,
    "",
    ...m.paragrafos.flatMap((p) => [p, ""]),
    `${m.acao.rotulo}:`,
    m.acao.url,
    "",
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

/** Envia e-mail de verificação de conta. */
export async function sendVerificationEmail(email: string, token: string): Promise<boolean> {
  const link = `${baseUrl()}/verificar-email?token=${token}`;
  devLog("Verificação de e-mail", link);

  return enviar(
    {
      para: email,
      assunto: "Confirme seu e-mail — ZELO",
      titulo: "Falta um passo",
      paragrafos: [
        "Sua conta no ZELO foi criada. Para poder entrar, confirme que este endereço é seu.",
      ],
      acao: { rotulo: "Confirmar meu e-mail", url: link },
      aviso: "O link vale 24 horas. Se não foi você quem criou a conta, ignore este e-mail — sem o clique, nada acontece.",
    },
    "verificacao",
  );
}

/** Envia e-mail de recuperação de senha. */
export async function sendPasswordResetEmail(email: string, token: string): Promise<boolean> {
  const link = `${baseUrl()}/redefinir-senha?token=${token}`;
  devLog("Recuperação de senha", link);

  return enviar(
    {
      para: email,
      assunto: "Redefinir sua senha — ZELO",
      titulo: "Vamos redefinir sua senha",
      paragrafos: ["Alguém pediu uma nova senha para a sua conta no ZELO."],
      acao: { rotulo: "Criar uma senha nova", url: link },
      aviso: "O link vale 1 hora e só funciona uma vez. Se não foi você, ignore este e-mail: sua senha continua a mesma.",
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
