import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/**
 * Envio de e-mail pelo Resend — Issue #73 (fase 11.1b).
 *
 * ── O que este arquivo prova, e por que não usa a rede ────────────────────
 *
 * `globalThis.fetch` é trocado por um espião. O que interessa não é que o
 * Resend responda — isso é problema deles e já foi verificado à mão contra a
 * API real — e sim **o que o ZELO manda** e **como reage ao que volta**.
 *
 * Bater na API de verdade num teste significaria: chave em CI, e-mail saindo a
 * cada execução, e um teste que fica vermelho quando a internet cai. Nada disso
 * mede o código deste repositório.
 *
 * ── A propriedade mais importante aqui é a que não se vê ──────────────────
 *
 * **Nada lança.** `POST /auth/password-reset/request` só chama o envio quando a
 * conta existe. Se uma falha de envio virasse exceção, a rota responderia 500
 * para e-mail cadastrado e 200 para e-mail desconhecido — um oráculo de
 * enumeração de contas de graça. Por isso metade dos casos abaixo é uma
 * variação de "o provedor deu errado" seguida de `assert.equal(..., false)`.
 */

const CHAVE_DE_TESTE = "re_chave_de_teste";
const APP = "https://zelo-care-foundation.replit.app";

type Chamada = { url: string; init: RequestInit };

let chamadas: Chamada[] = [];
let fetchOriginal: typeof globalThis.fetch;

/** Importa o módulo do zero. Sem isto, `EMAIL_FROM` viria do primeiro import. */
async function importarEmail(): Promise<typeof import("../lib/email.ts")> {
  return (await import(`../lib/email.ts?v=${Math.random()}`)) as typeof import("../lib/email.ts");
}

/** Troca o `fetch` global por um que devolve sempre a mesma resposta. */
function responderSempre(status: number, corpo: unknown = {}): void {
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    return Promise.resolve(
      new Response(JSON.stringify(corpo), {
        status,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
}

/** Devolve os status da lista, um por chamada, na ordem. */
function responderEmSequencia(...status: number[]): void {
  let i = 0;
  globalThis.fetch = ((url: string | URL | Request, init?: RequestInit) => {
    chamadas.push({ url: String(url), init: init ?? {} });
    const s = status[Math.min(i, status.length - 1)] ?? 200;
    i++;
    return Promise.resolve(
      new Response(JSON.stringify({ name: "rate_limit_exceeded" }), {
        status: s,
        headers: { "Content-Type": "application/json" },
      }),
    );
  }) as typeof globalThis.fetch;
}

/** O corpo JSON que foi mandado ao provedor na chamada `indice`. */
function corpoEnviado(indice = 0): {
  from: string;
  to: string[];
  subject: string;
  html: string;
  text: string;
} {
  const bruto = chamadas[indice]?.init.body;
  assert.equal(typeof bruto, "string", "o corpo precisa ser JSON serializado");
  return JSON.parse(bruto as string) as ReturnType<typeof corpoEnviado>;
}

describe("Envio de e-mail pelo Resend", () => {
  let chaveOriginal: string | undefined;
  let appUrlOriginal: string | undefined;

  beforeEach(() => {
    chaveOriginal = process.env.RESEND_API_KEY;
    appUrlOriginal = process.env.APP_URL;
    fetchOriginal = globalThis.fetch;
    chamadas = [];
    process.env.RESEND_API_KEY = CHAVE_DE_TESTE;
    process.env.APP_URL = APP;
  });

  afterEach(() => {
    globalThis.fetch = fetchOriginal;
    if (chaveOriginal === undefined) delete process.env.RESEND_API_KEY;
    else process.env.RESEND_API_KEY = chaveOriginal;
    if (appUrlOriginal === undefined) delete process.env.APP_URL;
    else process.env.APP_URL = appUrlOriginal;
  });

  // ── O que sai daqui ────────────────────────────────────────────────────

  it("monta o POST que a API do Resend espera", async () => {
    responderSempre(200, { id: "abc" });
    const { sendVerificationEmail } = await importarEmail();

    const aceito = await sendVerificationEmail("alguem@exemplo.com", "tok123");

    assert.equal(aceito, true);
    assert.equal(chamadas.length, 1);
    assert.equal(chamadas[0]!.url, "https://api.resend.com/emails");
    assert.equal(chamadas[0]!.init.method, "POST");

    const cabecalhos = chamadas[0]!.init.headers as Record<string, string>;
    assert.equal(cabecalhos.Authorization, `Bearer ${CHAVE_DE_TESTE}`);
    assert.equal(cabecalhos["Content-Type"], "application/json");

    const corpo = corpoEnviado();
    assert.deepEqual(corpo.to, ["alguem@exemplo.com"]);
    assert.ok(corpo.from.includes("@"), "precisa de um remetente");
    assert.ok(corpo.subject.length > 0, "precisa de assunto");
  });

  it("manda HTML e texto puro, e os dois carregam o MESMO link", async () => {
    // O convite, e não mais a redefinição de senha: desde a Issue #102 ela
    // manda código e não tem link nenhum. O convite continua precisando de
    // link — quem recebe ainda não tem conta, então não há tela onde digitar.
    responderSempre(200);
    const { sendCaregiverInviteEmail } = await importarEmail();
    await sendCaregiverInviteEmail("alguem@exemplo.com", "tok123");

    const { html, text } = corpoEnviado();
    const esperado = `${APP}/convite?token=tok123`;

    assert.ok(html.length > 0 && text.length > 0, "as duas versões precisam existir");
    assert.ok(html.includes(esperado), "o HTML precisa levar ao link certo");
    assert.ok(
      text.includes(esperado),
      "a versão texto precisa levar ao MESMO link — é ela que sobra quando o cliente bloqueia HTML",
    );
  });

  it("cada e-mail aponta para a rota que existe de verdade no app", async () => {
    responderSempre(200);
    const email = await importarEmail();

    await email.sendCaregiverInviteEmail("a@exemplo.com", "t3");
    await email.sendDeletionNotification(["a@exemplo.com"], new Date("2026-09-09T12:00:00Z"));

    // O aviso de exclusão apontava para `/conta/exclusao`, rota que nunca
    // existiu — a real é `/ajustes/seus-dados`. Foi o defeito que criou este
    // teste.
    //
    // A lista encolheu duas vezes, e as duas por bom motivo: a verificação
    // saiu na Issue #77 e a redefinição de senha na #102. As duas viraram
    // código, e código não tem para onde mandar ninguém.
    assert.ok(corpoEnviado(0).text.includes(`${APP}/convite?token=t3`));
    assert.ok(corpoEnviado(1).text.includes(`${APP}/ajustes/seus-dados`));
  });


  // ── O e-mail de senha virou código — Issue #102 ────────────────────────

  it("o e-mail de senha leva o CÓDIGO, no corpo e no assunto", async () => {
    responderSempre(200);
    const { sendPasswordResetEmail } = await importarEmail();
    await sendPasswordResetEmail("alguem@exemplo.com", "482915");

    const { html, text, subject } = corpoEnviado();

    assert.ok(text.includes("482915"), "a versão texto precisa trazer o código");
    assert.ok(html.includes("482915"), "o HTML precisa trazer o código");
    assert.ok(subject.startsWith("482915"), `o código precisa abrir o assunto, veio: ${subject}`);
  });

  it("o e-mail de senha NÃO tem link — foi o link que quebrou", async () => {
    responderSempre(200);
    const { sendPasswordResetEmail } = await importarEmail();
    await sendPasswordResetEmail("alguem@exemplo.com", "482915");

    // Em 03/09/2026 este e-mail chegou perfeito e o botão levava a uma página
    // de erro do Replit: `APP_URL` apontava para um app não publicado. Este
    // caso trava a volta do link, que é a volta do defeito.
    const { html, text } = corpoEnviado();
    for (const [nome, conteudo] of [["html", html], ["texto", text]] as const) {
      assert.ok(
        !conteudo.includes("/redefinir-senha?"),
        `${nome}: sobrou link com token do desenho antigo`,
      );
      assert.ok(!/<a\s/i.test(conteudo), `${nome}: não deve haver botão nem link`);
    }
  });

  // ── O e-mail de verificação virou código — Issue #77 ───────────────────

  it("o e-mail de verificação leva o CÓDIGO, no corpo e no assunto", async () => {
    responderSempre(200);
    const { sendVerificationEmail } = await importarEmail();
    await sendVerificationEmail("alguem@exemplo.com", "482915");

    const { html, text, subject } = corpoEnviado();

    assert.ok(text.includes("482915"), "a versão texto precisa trazer o código");
    assert.ok(html.includes("482915"), "o HTML precisa trazer o código");
    // No assunto porque é o que aparece na notificação do celular: dá para ler
    // sem abrir o e-mail, sem trocar de aplicativo, sem perder de vista a tela
    // onde o código vai ser digitado.
    assert.ok(subject.startsWith("482915"), `o código precisa abrir o assunto, veio: ${subject}`);
  });

  it("o e-mail de verificação NÃO tem link — não há para onde mandar a pessoa", async () => {
    responderSempre(200);
    const { sendVerificationEmail } = await importarEmail();
    await sendVerificationEmail("alguem@exemplo.com", "482915");

    const { html, text } = corpoEnviado();
    for (const [nome, conteudo] of [["html", html], ["texto", text]] as const) {
      assert.ok(
        !conteudo.includes("/verificar-email?"),
        `${nome}: sobrou link com token do desenho antigo`,
      );
      assert.ok(!/<a\s/i.test(conteudo), `${nome}: não deve haver botão nem link`);
    }
  });

  it("o código sai copiável — dígitos juntos, sem espaço no meio", async () => {
    responderSempre(200);
    const { sendVerificationEmail } = await importarEmail();
    await sendVerificationEmail("alguem@exemplo.com", "482915");

    // O fundador pediu para poder copiar e colar. Separar os dígitos com espaço
    // (`4 8 2 9 1 5`) ou com traço faria o valor colado não bater com o que a
    // tela espera. O afastamento visual é `letter-spacing`, que não entra na
    // seleção.
    const { html, text } = corpoEnviado();
    assert.ok(html.includes(">482915<"), "no HTML o código é um texto contínuo");
    assert.ok(text.split("\n").includes("482915"), "no texto o código ocupa uma linha só, limpa");
  });

  it("o corpo do e-mail não vaza o token de outra pessoa nem nome de paciente", async () => {
    responderSempre(200);
    const { sendCaregiverInviteEmail } = await importarEmail();
    await sendCaregiverInviteEmail("convidado@exemplo.com", "tok_do_convite");

    const { html, text } = corpoEnviado();
    // O convite não recebe nome nenhum — nem do paciente, nem de quem convidou.
    // Este teste trava a tentação de "melhorar" o e-mail acrescentando os dois:
    // o invariante 3 vale para e-mail tanto quanto para log.
    for (const conteudo of [html, text]) {
      assert.ok(!/paciente\s+\w+/i.test(conteudo), "não pode nomear paciente");
      assert.ok(!/convidou você\s*[,:]/i.test(conteudo), "não pode nomear quem convidou");
    }
  });

  // ── Como reage ao que volta ────────────────────────────────────────────

  it("chave recusada (401) devolve false e NÃO lança", async () => {
    responderSempre(401, { name: "restricted_api_key" });
    const { sendPasswordResetEmail } = await importarEmail();

    const aceito = await sendPasswordResetEmail("alguem@exemplo.com", "tok");
    assert.equal(aceito, false, "falha de provedor não pode virar exceção — ver o cabeçalho");
  });

  it("destinatário recusado (422) devolve false e NÃO lança", async () => {
    responderSempre(422, { name: "validation_error" });
    const { sendVerificationEmail } = await importarEmail();

    assert.equal(await sendVerificationEmail("invalido", "tok"), false);
  });

  it("rede fora devolve false e NÃO lança", async () => {
    globalThis.fetch = (() => Promise.reject(new TypeError("fetch failed"))) as typeof globalThis.fetch;
    const { sendPasswordResetEmail } = await importarEmail();

    assert.equal(await sendPasswordResetEmail("alguem@exemplo.com", "tok"), false);
  });

  it("limite de taxa (429) é tentado uma segunda vez antes de desistir", async () => {
    // O plano gratuito aceita 2 requisições por segundo, e o aviso de exclusão
    // manda um e-mail por cuidador em sequência: estourar é realista.
    responderEmSequencia(429, 200);
    const { sendVerificationEmail } = await importarEmail();

    assert.equal(await sendVerificationEmail("alguem@exemplo.com", "tok"), true);
    assert.equal(chamadas.length, 2, "precisa ter tentado de novo depois do 429");
  });

  it("429 duas vezes seguidas desiste — não fica repetindo para sempre", async () => {
    responderSempre(429, { name: "rate_limit_exceeded" });
    const { sendVerificationEmail } = await importarEmail();

    assert.equal(await sendVerificationEmail("alguem@exemplo.com", "tok"), false);
    assert.equal(chamadas.length, 2, "uma repetição, não um laço");
  });

  it("sem RESEND_API_KEY não tenta a rede nenhuma vez", async () => {
    delete process.env.RESEND_API_KEY;
    responderSempre(200);
    const { sendVerificationEmail } = await importarEmail();

    assert.equal(await sendVerificationEmail("alguem@exemplo.com", "tok"), false);
    assert.equal(chamadas.length, 0, "sem chave não existe requisição para fazer");
  });

  // ── Aviso de exclusão: o caso com vários destinatários ─────────────────

  it("aviso de exclusão manda UM e-mail por pessoa, nunca todos no mesmo to", async () => {
    responderSempre(200);
    const { sendDeletionNotification } = await importarEmail();

    const todos = await sendDeletionNotification(
      ["a@exemplo.com", "b@exemplo.com", "c@exemplo.com"],
      new Date("2026-09-09T12:00:00Z"),
    );

    assert.equal(todos, true);
    assert.equal(chamadas.length, 3, "um envio por cuidador");
    // O endereço dos outros cuidadores não é de quem recebe. A rota de
    // exportação já os omite pelo mesmo motivo (ver routes/export.ts).
    for (let i = 0; i < 3; i++) {
      assert.equal(corpoEnviado(i).to.length, 1, "um destinatário por mensagem");
    }
  });

  it("um envio recusado no meio faz o aviso de exclusão devolver false", async () => {
    responderEmSequencia(200, 422, 422, 200);
    const { sendDeletionNotification } = await importarEmail();

    const todos = await sendDeletionNotification(
      ["a@exemplo.com", "b@exemplo.com"],
      new Date("2026-09-09T12:00:00Z"),
    );

    // Este aviso é o que permite reagir a uma exclusão que ninguém pediu.
    // Metade entregue não é sucesso.
    assert.equal(todos, false);
  });

  it("a data da exclusão sai no fuso de São Paulo, não no do servidor", async () => {
    responderSempre(200);
    const { sendDeletionNotification } = await importarEmail();

    // 02:00 UTC do dia 09 é 23:00 do dia 08 em São Paulo. O processo no Replit
    // roda em UTC: sem fuso explícito, um aviso legal com prazo sairia com a
    // data errada — um dia a mais para apagar tudo.
    await sendDeletionNotification(["a@exemplo.com"], new Date("2026-09-09T02:00:00Z"));

    const { text } = corpoEnviado();
    assert.ok(text.includes("08/09/2026"), `esperava 08/09/2026 no texto, veio: ${text}`);
    assert.ok(!text.includes("09/09/2026"), "não pode sair a data em UTC");
  });

  // ── Varredura de código ────────────────────────────────────────────────

  it("as falhas são registradas por safeLog, nunca pelo logger cru", () => {
    const caminho = fileURLToPath(new URL("../lib/email.ts", import.meta.url));
    const fonte = readFileSync(caminho, "utf8");

    // `logger` cru é permitido em UM lugar só: `devLog`, que imprime o link
    // (com token dentro) e só roda fora de produção — ali a exposição é a
    // função. Todo o resto passa por `safeLog`, cuja lista de permissão
    // DESCARTA o que não estiver nela. Sem isso, um dia alguém escreve
    // `logger.error({ para })` e o endereço de uma família vai pro log.
    const usosDeLoggerCru = fonte.match(/(?<!safe)[lL]ogger\.(info|warn|error)\(/g) ?? [];
    assert.equal(
      usosDeLoggerCru.length,
      1,
      `logger cru só pode aparecer em devLog; encontrei ${usosDeLoggerCru.length} usos`,
    );

    assert.ok(fonte.includes("safeLog.error("), "as falhas precisam ir por safeLog");
  });

  it("a mensagem de erro do provedor não entra no log — só o código", () => {
    const caminho = fileURLToPath(new URL("../lib/email.ts", import.meta.url));
    const fonte = readFileSync(caminho, "utf8");

    // A resposta de erro do Resend traz `message` em texto livre, que numa
    // validação pode conter o endereço recusado. `name` é código estável
    // (`validation_error`, `rate_limit_exceeded`) e não carrega ninguém junto.
    assert.ok(fonte.includes("corpo.name"), "o código do erro vem de `name`");
    assert.ok(
      !/corpo\.message|\.message\s*\)/.test(fonte),
      "a `message` do provedor não pode ser lida: é texto livre e pode conter o endereço",
    );
  });
});
