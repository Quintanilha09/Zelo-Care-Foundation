/**
 * Entrada de aparelho novo — Issue #79.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE É O ÚNICO ARQUIVO QUE PROVA QUE O SEGUNDO FATOR NÃO TRANCA NINGUÉM.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * O fundador decidiu que o segundo fator é obrigatório, contra a minha
 * recomendação. Num app de código-fonte isso seria uma escolha de gosto; aqui é
 * um cuidador podendo ficar do lado de fora às 8h da manhã com a dose de um
 * idoso para registrar. Encosta no invariante 6 do produto.
 *
 * O que impede isso são quatro caminhos de volta, e **nenhum deles aparece na
 * tela**. Tirar qualquer um por engano não quebra nada visível:
 *
 *   1. os códigos de recuperação, gerados ANTES de a tranca valer
 *   2. o e-mail de recuperação, que recebe o mesmo código (#87)
 *   3. o resgate pela família, que dispensa o código uma vez (#87)
 *   4. o aparelho confiável por 30 dias, RENOVANDO a cada uso
 *
 * Cada um deles tem um caso aqui. Os quatro juntos são a diferença entre uma
 * função de segurança e um defeito com boas intenções.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { and, eq, like, isNull } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  trustedDevicesTable,
  deviceVerificationsTable,
  recoveryCodesTable,
} from "@workspace/db";
import { hashPassword } from "../lib/password.ts";
import { generateAccessToken } from "../lib/tokens.ts";
import { Clock } from "../lib/clock.ts";
import { hashDoCodigo, MAX_TENTATIVAS } from "../lib/codigo-de-verificacao.ts";
import { DIAS_DE_CONFIANCA, rotuloDoAparelho } from "../lib/aparelho-confiavel.ts";
import { QUANTOS_CODIGOS } from "../lib/codigos-de-recuperacao.ts";
import app from "../app.ts";

const raiz = fileURLToPath(new URL("../", import.meta.url));
const lerFonte = (caminho: string): string => readFileSync(`${raiz}${caminho}`, "utf8");

const SUFIXO = "@aparelho-test.zelo.test";
const SENHA = "senha-do-teste-4471";
const CODIGO = "424242";
const DIA_EM_MS = 24 * 60 * 60 * 1000;

let testPort: number;
let closeServer: () => Promise<void>;

before(async () => {
  await new Promise<void>((resolve, reject) => {
    const server = http.createServer(app);
    server.listen(0, "127.0.0.1", () => {
      testPort = (server.address() as { port: number }).port;
      closeServer = () => new Promise((res, rej) => server.close((e) => (e ? rej(e) : res())));
      resolve();
    });
    server.on("error", reject);
  });
});

after(async () => {
  Clock.reset();
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Aparelho %"));
});

let contadorDeIp = 0;
function ipUnico(): string {
  contadorDeIp += 1;
  return `10.${(contadorDeIp >> 16) & 255}.${(contadorDeIp >> 8) & 255}.${contadorDeIp & 255}`;
}

type Resposta = { status: number; body: Record<string, unknown> };

async function api(metodo: string, path: string, body?: unknown, token?: string): Promise<Resposta> {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: `/api${path}`,
        method: metodo,
        headers: {
          "Content-Type": "application/json",
          "x-forwarded-for": ipUnico(),
          "user-agent": "Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) as Record<string, unknown> });
          } catch {
            resolve({ status: res.statusCode ?? 0, body: { bruto: data } });
          }
        });
      },
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

type Conta = { email: string; userId: number; caregiverId: number; familyId: number; token: string };

/** Uma conta pronta para entrar. `comSegundoFator` decide se a tranca vale. */
async function conta(comSegundoFator: boolean): Promise<Conta> {
  const marca = `${Date.now()}${Math.floor(Math.random() * 1000000)}`;

  const [familia] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Aparelho ${marca}`, slug: `apar-${marca}` })
    .returning({ id: familiesTable.id });

  const email = `pessoa-${marca}${SUFIXO}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email,
      name: "Pessoa Fictícia Aparelho",
      passwordHash: await hashPassword(SENHA),
      emailVerified: true,
      status: "active",
      activeFamilyId: familia!.id,
      segundoFatorAtivoEm: comSegundoFator ? Clock.now() : null,
    })
    .returning({ id: usersTable.id });

  const [cuidador] = await db
    .insert(caregiversTable)
    .values({
      familyId: familia!.id,
      userId: user!.id,
      name: "Pessoa Fictícia Aparelho",
      role: "primary_caregiver",
    })
    .returning({ id: caregiversTable.id });

  return {
    email,
    userId: user!.id,
    caregiverId: cuidador!.id,
    familyId: familia!.id,
    token: generateAccessToken(user!.id, familia!.id, cuidador!.id, "primary_caregiver"),
  };
}

function entrar(c: Conta, deviceToken?: string): Promise<Resposta> {
  return api("POST", "/auth/login", { email: c.email, password: SENHA, ...(deviceToken ? { deviceToken } : {}) });
}

/**
 * O código sorteado pelo servidor só existe no e-mail, e o hash é o que fica.
 * Como o teste sabe o `userId`, ele reescreve o hash por um código conhecido —
 * é o mesmo caminho de produção, com o segredo trocado por um combinado.
 */
async function plantarCodigo(userId: number, codigo = CODIGO): Promise<void> {
  await db
    .update(deviceVerificationsTable)
    .set({ codigoHash: hashDoCodigo(userId, codigo) })
    .where(and(eq(deviceVerificationsTable.userId, userId), eq(deviceVerificationsTable.used, false)));
}

/** Entra do zero num aparelho novo e devolve a sessão + o token do aparelho. */
async function entrarComCodigo(c: Conta): Promise<Resposta> {
  const login = await entrar(c);
  assert.equal(login.body.code, "device_verification_required", JSON.stringify(login.body));
  await plantarCodigo(c.userId);
  return api("POST", "/auth/login/aparelho", { desafio: login.body.desafio, codigo: CODIGO });
}

async function aparelhosDe(userId: number): Promise<number> {
  const linhas = await db
    .select({ id: trustedDevicesTable.id })
    .from(trustedDevicesTable)
    .where(and(eq(trustedDevicesTable.userId, userId), eq(trustedDevicesTable.revoked, false)));
  return linhas.length;
}

// ═══════════════════════════════════════════════════════════════════════════

describe("Conta que ainda não ativou o segundo fator", () => {
  it("entra direto, exatamente como entrava antes", async () => {
    // Esta é a propriedade que permite o backend ir para produção sozinho,
    // antes de a tela de ativação existir: ninguém tem códigos, ninguém está
    // ativado, e o login não muda para ninguém. Se este caso cair, subir o
    // backend sozinho deixa de ser seguro.
    const c = await conta(false);

    const res = await entrar(c);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.accessToken, "a sessão tinha que sair normalmente");
    assert.equal(res.body.code, undefined, "não podia pedir código de aparelho");
  });
});

describe("Aparelho novo", () => {
  it("NÃO devolve token de sessão nenhum antes do código", async () => {
    // O critério de aceite mais importante da Issue. Devolver a sessão junto
    // com o pedido de código faria o segundo fator virar enfeite: bastaria
    // ignorar a tela.
    const c = await conta(true);

    const res = await entrar(c);

    assert.equal(res.status, 401, JSON.stringify(res.body));
    assert.equal(res.body.code, "device_verification_required");
    assert.equal(res.body.accessToken, undefined, "vazou token de acesso antes do código");
    assert.equal(res.body.refreshToken, undefined, "vazou token de renovação antes do código");
    assert.ok(res.body.desafio, "sem desafio a pessoa não teria como confirmar");
  });

  it("acertar o código devolve a sessão e registra o aparelho", async () => {
    const c = await conta(true);

    const res = await entrarComCodigo(c);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.accessToken, "faltou o token de acesso");
    assert.ok(res.body.deviceToken, "faltou o token do aparelho — a pessoa veria código toda vez");
    assert.equal(await aparelhosDe(c.userId), 1);
  });

  it("o aparelho registrado não pede código de novo", async () => {
    const c = await conta(true);
    const primeira = await entrarComCodigo(c);

    const segunda = await entrar(c, String(primeira.body.deviceToken));

    assert.equal(segunda.status, 200, JSON.stringify(segunda.body));
    assert.ok(segunda.body.accessToken);
    assert.equal(segunda.body.code, undefined, "aparelho conhecido não podia pedir código");
  });

  it("o token de aparelho de outra conta não serve", async () => {
    // A consulta pergunta dono E hash. Se um dia perguntar só o hash, um token
    // legítimo de qualquer conta abriria qualquer outra — e nada na tela
    // mostraria isso.
    const dona = await conta(true);
    const alheia = await conta(true);
    const dela = await entrarComCodigo(dona);

    const res = await entrar(alheia, String(dela.body.deviceToken));

    assert.equal(res.status, 401);
    assert.equal(res.body.code, "device_verification_required");
  });

  it("errar o código cinco vezes mata o desafio, mesmo depois com o certo", async () => {
    // Seis dígitos são um milhão de combinações — nada para uma máquina. A
    // defesa não é o tamanho do código, é este contador.
    const c = await conta(true);
    const login = await entrar(c);
    await plantarCodigo(c.userId);

    for (let i = 0; i < MAX_TENTATIVAS; i += 1) {
      const erro = await api("POST", "/auth/login/aparelho", { desafio: login.body.desafio, codigo: "000000" });
      assert.equal(erro.status, 401, `tentativa ${i + 1} devia falhar`);
    }

    const comOCerto = await api("POST", "/auth/login/aparelho", {
      desafio: login.body.desafio,
      codigo: CODIGO,
    });

    assert.equal(comOCerto.status, 401, "o código certo não podia mais valer depois de 5 erros");
    assert.equal(comOCerto.body.accessToken, undefined);
  });

  it("a resposta é a mesma para código errado e para desafio inventado", async () => {
    // Distinguir contaria ao atacante se vale a pena insistir naquele desafio.
    const c = await conta(true);
    const login = await entrar(c);

    const errado = await api("POST", "/auth/login/aparelho", { desafio: login.body.desafio, codigo: "000000" });
    const inventado = await api("POST", "/auth/login/aparelho", { desafio: "nao-existe", codigo: "000000" });

    assert.equal(errado.status, inventado.status);
    assert.equal(errado.body.error, inventado.body.error);
  });
});

describe("O prazo do aparelho confiável", () => {
  it(`para de valer depois de ${DIAS_DE_CONFIANCA} dias sem uso`, async () => {
    const c = await conta(true);
    const primeira = await entrarComCodigo(c);

    Clock.advance((DIAS_DE_CONFIANCA + 1) * DIA_EM_MS);
    try {
      const res = await entrar(c, String(primeira.body.deviceToken));
      assert.equal(res.body.code, "device_verification_required", "aparelho vencido tinha que pedir código");
    } finally {
      Clock.reset();
    }
  });

  it("o uso renova o prazo — quem abre o app não vê código nunca", async () => {
    // É esta renovação que faz 30 dias serem invisíveis para o cuidador que
    // usa o app toda semana. Sem ela, o prazo vira uma data de despejo, e o
    // número teria que ser escolhido entre incomodar e proteger.
    const c = await conta(true);
    const primeira = await entrarComCodigo(c);
    const token = String(primeira.body.deviceToken);

    // Vinte dias depois ele ainda vale, e usar reinicia a contagem.
    Clock.advance(20 * DIA_EM_MS);
    try {
      const meio = await entrar(c, token);
      assert.equal(meio.status, 200, "aos 20 dias o aparelho ainda tinha que valer");

      // Mais vinte: quarenta no total, mas só vinte desde o último uso.
      Clock.advance(20 * DIA_EM_MS);
      const depois = await entrar(c, token);
      assert.equal(depois.status, 200, "o uso aos 20 dias tinha que ter renovado o prazo");
      assert.equal(depois.body.code, undefined);
    } finally {
      Clock.reset();
    }
  });
});

describe("Códigos de recuperação", () => {
  it("ativar sem ter gerado os códigos é recusado", async () => {
    // A recusa que sustenta a função inteira: ativar antes seria trancar a
    // porta e jogar fora a chave reserva.
    const c = await conta(false);

    const res = await api("POST", "/account/segundo-fator/ativar", {}, c.token);

    assert.equal(res.status, 400, JSON.stringify(res.body));
    assert.equal(res.body.code, "SEM_CODIGOS");

    const [u] = await db
      .select({ ativo: usersTable.segundoFatorAtivoEm })
      .from(usersTable)
      .where(eq(usersTable.id, c.userId))
      .limit(1);
    assert.equal(u?.ativo, null, "o segundo fator não podia ter sido ligado");
  });

  it("gerar, guardar e ativar — nesta ordem — registra o aparelho de agora", async () => {
    const c = await conta(false);

    const gerados = await api("POST", "/account/segundo-fator/codigos", {}, c.token);
    assert.equal(gerados.status, 200, JSON.stringify(gerados.body));
    assert.equal((gerados.body.codigos as string[]).length, QUANTOS_CODIGOS);

    const ativou = await api("POST", "/account/segundo-fator/ativar", {}, c.token);
    assert.equal(ativou.status, 200, JSON.stringify(ativou.body));
    assert.ok(ativou.body.deviceToken, "sem isto a entrada seguinte pediria código na hora");
    assert.equal(await aparelhosDe(c.userId), 1);
  });

  it("um código de recuperação entra no lugar do código do e-mail", async () => {
    // O dia em que o e-mail não chega é o dia em que isto é a conta inteira.
    const c = await conta(false);
    const gerados = await api("POST", "/account/segundo-fator/codigos", {}, c.token);
    await api("POST", "/account/segundo-fator/ativar", {}, c.token);
    const codigo = (gerados.body.codigos as string[])[0]!;

    const login = await entrar(c);
    assert.equal(login.body.code, "device_verification_required");

    const res = await api("POST", "/auth/login/aparelho", {
      desafio: login.body.desafio,
      codigoDeRecuperacao: codigo,
    });

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.accessToken);
    assert.ok(res.body.deviceToken);
  });

  it("o código de recuperação queima ao usar", async () => {
    const c = await conta(false);
    const gerados = await api("POST", "/account/segundo-fator/codigos", {}, c.token);
    await api("POST", "/account/segundo-fator/ativar", {}, c.token);
    const codigo = (gerados.body.codigos as string[])[0]!;

    const primeiro = await entrar(c);
    await api("POST", "/auth/login/aparelho", { desafio: primeiro.body.desafio, codigoDeRecuperacao: codigo });

    const segundo = await entrar(c);
    const repetido = await api("POST", "/auth/login/aparelho", {
      desafio: segundo.body.desafio,
      codigoDeRecuperacao: codigo,
    });

    assert.equal(repetido.status, 401, "um código usado não pode valer de novo");

    const vivos = await db
      .select({ id: recoveryCodesTable.id })
      .from(recoveryCodesTable)
      .where(and(eq(recoveryCodesTable.userId, c.userId), isNull(recoveryCodesTable.usedAt)));
    assert.equal(vivos.length, QUANTOS_CODIGOS - 1);
  });

  it("gerar um jogo novo, com o fator já ativo, exige a senha atual", async () => {
    // Sem isto uma sessão sequestrada trocaria as chaves reservas da conta sem
    // saber a senha. É a mesma assimetria do e-mail de recuperação (#87).
    const c = await conta(false);
    await api("POST", "/account/segundo-fator/codigos", {}, c.token);
    await api("POST", "/account/segundo-fator/ativar", {}, c.token);

    const semSenha = await api("POST", "/account/segundo-fator/codigos", {}, c.token);
    assert.equal(semSenha.status, 401, JSON.stringify(semSenha.body));

    const comSenha = await api("POST", "/account/segundo-fator/codigos", { senhaAtual: SENHA }, c.token);
    assert.equal(comSenha.status, 200, JSON.stringify(comSenha.body));
  });

  it("o jogo novo invalida o antigo", async () => {
    const c = await conta(false);
    const primeiros = await api("POST", "/account/segundo-fator/codigos", {}, c.token);
    await api("POST", "/account/segundo-fator/ativar", {}, c.token);
    await api("POST", "/account/segundo-fator/codigos", { senhaAtual: SENHA }, c.token);

    const antigo = (primeiros.body.codigos as string[])[0]!;
    const login = await entrar(c);
    const res = await api("POST", "/auth/login/aparelho", {
      desafio: login.body.desafio,
      codigoDeRecuperacao: antigo,
    });

    assert.equal(res.status, 401, "quem pede um jogo novo está anulando o antigo");
  });
});

describe("O resgate pela família (#87)", () => {
  it("dispensa o código, e some ao ser usado", async () => {
    // A coluna `resgate_liberado_ate` foi escrita pela #87 e não era lida por
    // ninguém. Este caso é o outro lado da promessa que o e-mail de resgate
    // já fazia em português para a pessoa resgatada.
    const c = await conta(true);
    const ate = new Date(Clock.now().getTime() + 6 * 60 * 60 * 1000);
    await db.update(usersTable).set({ resgateLiberadoAte: ate }).where(eq(usersTable.id, c.userId));

    const res = await entrar(c);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.accessToken, "o resgate tinha que deixar entrar sem código");
    assert.ok(res.body.deviceToken, "sem registrar o aparelho, o resgate teria servido para nada");

    const [u] = await db
      .select({ ate: usersTable.resgateLiberadoAte })
      .from(usersTable)
      .where(eq(usersTable.id, c.userId))
      .limit(1);
    assert.equal(u?.ate, null, "o resgate vale UMA vez — tinha que ter sido gasto");
  });

  it("resgate vencido não dispensa nada", async () => {
    const c = await conta(true);
    const ontem = new Date(Clock.now().getTime() - DIA_EM_MS);
    await db.update(usersTable).set({ resgateLiberadoAte: ontem }).where(eq(usersTable.id, c.userId));

    const res = await entrar(c);

    assert.equal(res.body.code, "device_verification_required");
  });
});

describe("A lista de aparelhos, em Ajustes", () => {
  it("aparelho de outra pessoa responde 404, nunca 403", async () => {
    // Invariante 2 do produto. 403 confirmaria que aquele identificador
    // existe, o que 404 não conta.
    const dona = await conta(true);
    const alheia = await conta(true);
    await entrarComCodigo(dona);

    const [aparelho] = await db
      .select({ id: trustedDevicesTable.id })
      .from(trustedDevicesTable)
      .where(eq(trustedDevicesTable.userId, dona.userId))
      .limit(1);

    const res = await api("DELETE", `/account/aparelhos/${aparelho!.id}`, undefined, alheia.token);

    assert.equal(res.status, 404, JSON.stringify(res.body));
    assert.equal(await aparelhosDe(dona.userId), 1, "o aparelho da outra pessoa continua valendo");
  });

  it("revogar faz o próximo login daquele aparelho pedir código de novo", async () => {
    // Lista de aparelhos sem revogação é enfeite — e revogação que não muda o
    // login é o mesmo enfeite com mais passos.
    const c = await conta(true);
    const primeira = await entrarComCodigo(c);
    const [aparelho] = await db
      .select({ id: trustedDevicesTable.id })
      .from(trustedDevicesTable)
      .where(eq(trustedDevicesTable.userId, c.userId))
      .limit(1);

    await api("DELETE", `/account/aparelhos/${aparelho!.id}`, undefined, c.token);

    const res = await entrar(c, String(primeira.body.deviceToken));
    assert.equal(res.body.code, "device_verification_required");
  });

  it("sair de todos revoga inclusive o aparelho de quem pediu", async () => {
    // Quem clica nisto está dizendo "não sei mais quem tem acesso". A resposta
    // certa a essa frase inclui a própria pessoa.
    const c = await conta(true);
    const primeira = await entrarComCodigo(c);

    const res = await api("POST", "/account/aparelhos/sair-de-todos", {}, c.token);

    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(await aparelhosDe(c.userId), 0);

    const depois = await entrar(c, String(primeira.body.deviceToken));
    assert.equal(depois.body.code, "device_verification_required");
  });

  it("a lista mostra um rótulo que a pessoa reconhece", async () => {
    const c = await conta(true);
    await entrarComCodigo(c);

    const res = await api("GET", "/account/aparelhos", undefined, c.token);

    assert.equal(res.status, 200);
    const lista = res.body as unknown as Array<{ label: string }>;
    assert.equal(lista.length, 1);
    assert.equal(lista[0]!.label, rotuloDoAparelho("Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36"));
  });
});

describe("Quem nunca pode ser barrado", () => {
  // ═══════════════════════════════════════════════════════════════════════
  // O ACESSO DO PACIENTE NÃO PODE PEDIR SEGUNDO FATOR. NUNCA.
  // ═══════════════════════════════════════════════════════════════════════
  //
  // O aparelho é do idoso, o token é próprio, e quem está ali muitas vezes não
  // tem e-mail nenhum. Pedir código nesse caminho seria tirar do paciente a
  // tela que lhe diz qual remédio tomar — invariante 6, na forma mais direta
  // que ele tem.
  //
  // Hoje isso é verdade por construção: `patient-access` e `google-auth` não
  // passam pelo login com senha. Estes dois casos leem o código-fonte porque
  // "por construção" é exatamente o tipo de garantia que uma refatoração
  // futura desfaz sem nenhum sintoma.

  it("o acesso do paciente não consulta o segundo fator", () => {
    const fonte = lerFonte("routes/patient-access.ts");
    assert.doesNotMatch(
      fonte,
      /segundoFatorAtivoEm|deviceVerifications|trustedDevices/,
      "o modo idoso passou a depender do segundo fator — isto tranca o paciente",
    );
  });

  it("o login com Google não pede código", () => {
    // Quem entra pelo Google já passou pelo segundo fator do Google. Pedir de
    // novo incomoda e não acrescenta segurança.
    const fonte = lerFonte("routes/google-auth.ts");
    assert.doesNotMatch(fonte, /segundoFatorAtivoEm|deviceVerifications/, "o login com Google passou a pedir código");
  });

  it("não existe rota que desligue o segundo fator", () => {
    // `segundo_fator_ativo_em` é de mão única: nulo é "ainda não ativou",
    // nunca "desligou". Uma rota que o zerasse transformaria uma decisão do
    // fundador num interruptor — e faria a conta perder a proteção sem que
    // ninguém percebesse.
    const fonte = lerFonte("routes/segundo-fator.ts")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(fonte, /segundoFatorAtivoEm:\s*null/, "alguém escreveu uma rota que desativa o segundo fator");
  });
});
