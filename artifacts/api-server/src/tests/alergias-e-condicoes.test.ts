/**
 * Alergias e condições do paciente — Issue #176.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * É O PRIMEIRO DADO QUE UM PRONTO-SOCORRO PERGUNTA.
 *
 * E o cuidador que chega com o idoso às três da manhã costuma não saber de
 * cor — ainda mais quando não é o cuidador principal. A ficha do paciente
 * tinha nome, nascimento, fuso, contato de emergência e observações. Alergia
 * não existia.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que este arquivo guarda ─────────────────────────────────────────────
 *
 *   1. os dois campos aceitam texto livre e voltam inteiros
 *   2. editar a ficha é o caminho normal — alergia se descobre depois
 *   3. **nunca entram em log**: é dado de saúde (invariante 3)
 *   4. o app **nunca cruza** um com o medicamento cadastrado (invariante 4)
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { like } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, familiesTable, caregiversTable } from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import { sanitizeLogContext } from "../lib/safe-logger.ts";
import app from "../app.ts";

const SUFIXO = "@alergias.zelo.test";

let testPort: number;
let closeServer: () => Promise<void>;
let token: string;

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

  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;
  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Fictícia Alergias ${marca}`, slug: `ale-${marca}` })
    .returning({ id: familiesTable.id });

  const email = `ale-${marca}${SUFIXO}`;
  const [user] = await db
    .insert(usersTable)
    .values({
      email, name: "Pessoa Fictícia", passwordHash: "hash-nao-usado",
      emailVerified: true, status: "active", activeFamilyId: family.id,
    })
    .returning({ id: usersTable.id });

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: "Pessoa Fictícia", email, role: "primary_caregiver" })
    .returning({ id: caregiversTable.id });

  token = generateAccessToken(user.id, family.id, caregiver.id, "primary_caregiver");
});

after(async () => {
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Alergias %"));
});

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const dados = body === undefined ? undefined : JSON.stringify(body);
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          Authorization: `Bearer ${token}`,
          ...(dados ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(dados) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => resolve({
          status: res.statusCode ?? 0,
          body: data ? (JSON.parse(data) as Record<string, unknown>) : {},
        }));
      },
    );
    req.on("error", reject);
    if (dados) req.write(dados);
    req.end();
  });
}

/**
 * UM paciente para o arquivo inteiro.
 *
 * O plano Grátis cuida de um só, e criar um por caso bateria no limite no
 * segundo — foi o que aconteceu na primeira execução deste arquivo. Subir o
 * plano seria a outra saída, mas aqui não é preciso: o que se testa são dois
 * campos de texto, e um paciente basta para todos.
 */
let pacienteId: number;

async function criarPaciente(extra: Record<string, unknown> = {}): Promise<number> {
  const res = await api("POST", "/patients", {
    name: "Dona Maria Teste",
    timezone: "America/Sao_Paulo",
    healthConsent: { givenBy: "legal_representative", version: "v1.0" },
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return (res.body as { id: number }).id;
}

describe("Alergias e condicoes do paciente", () => {
  it("guardam texto livre e voltam inteiros", async () => {
    pacienteId = await criarPaciente({
      allergies: "Alérgica a AAS e a esparadrapo",
      conditions: "Diabetes tipo 2, hipertensão",
    });

    const lido = await api("GET", `/patients/${pacienteId}`);
    const paciente = lido.body as { allergies: string; conditions: string };

    // Frase de gente, e não item de catálogo: obrigar a escolher de uma lista
    // fechada faria perder justamente a metade que ninguém previu.
    assert.equal(paciente.allergies, "Alérgica a AAS e a esparadrapo");
    assert.equal(paciente.conditions, "Diabetes tipo 2, hipertensão");
  });

  it("editar a ficha muda os dois", async () => {
    // Alergia se descobre depois; condição muda. Editar é o caminho normal.
    const editado = await api("PATCH", `/patients/${pacienteId}`, {
      allergies: "Dipirona",
      conditions: "Hipertensão",
    });
    assert.equal(editado.status, 200);

    const lido = await api("GET", `/patients/${pacienteId}`);
    assert.equal((lido.body as { allergies: string }).allergies, "Dipirona");
    assert.equal((lido.body as { conditions: string }).conditions, "Hipertensão");
  });

  it("NUNCA entram em log — a allowlist do safeLog nao os conhece", () => {
    const limpo = sanitizeLogContext({
      familyId: 1,
      allergies: "Alérgica a dipirona",
      conditions: "Diabetes tipo 2",
    }) as Record<string, unknown>;

    // A allowlist é positiva: o que não está nela vira [REDACTED] sozinho.
    // Este caso existe para o dia em que alguém "organizar" a lista e
    // acrescentar campos sem pensar no que eles carregam.
    assert.equal(limpo.familyId, 1, "id de sistema continua passando");
    assert.notEqual(limpo.allergies, "Alérgica a dipirona");
    assert.notEqual(limpo.conditions, "Diabetes tipo 2");
  });

  it("o app NAO cruza alergia com medicamento — invariante 4", async () => {
    const lido = await api("GET", `/patients/${pacienteId}`);

    /**
     * A linha que não se cruza.
     *
     * Guardar "alérgica a dipirona" e mostrar para quem cuida é REGISTRO.
     * Comparar com o medicamento cadastrado e avisar é **verificação de
     * interação medicamentosa**, e o invariante 4 a proíbe.
     *
     * ── Por que os NOMES DOS CAMPOS, e não o JSON inteiro ────────────────
     *
     * A primeira versão varria o JSON atrás de "alert", e reprovou na hora:
     * casou com `uncoveredAlertSentAt`, que é o aviso de paciente sem
     * cuidador responsável e não tem nada com alergia. Um teste que reprova
     * o que está certo ensina a desligá-lo.
     *
     * Cruzar alergia com remédio apareceria como um CAMPO NOVO na resposta —
     * uma lista de conflitos, um sinal de risco. É isso que se olha.
     */
    const campos = Object.keys(lido.body);
    const suspeitos = campos.filter((c) =>
      /(interac|interaction|conflit|contraindica|risco|risk)/i.test(c),
    );
    assert.deepEqual(
      suspeitos,
      [],
      "campo novo cruzando alergia com medicamento é verificação de interação, " +
        "e o invariante 4 a proíbe — o ZELO registra, o médico interpreta",
    );

    // E o que ele devolve é exatamente o que alguém escreveu, sem enfeite.
    assert.equal((lido.body as { allergies: string }).allergies, "Dipirona");
  });
});
