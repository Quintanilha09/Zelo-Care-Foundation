/**
 * Paciente descoberto na lista de pacientes — Issue #122.
 *
 * `GET /patients` passou a devolver `responsaveis` em cada paciente, e é isso
 * que a tela usa para achar quem está sem cuidador.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * O QUE ESTE ARQUIVO EXISTE PARA IMPEDIR
 *
 *   1. **Vazamento pela junção nova.** `responsaveis` sai de um join com
 *      `caregivers`. Um join escrito sem o filtro de família devolveria o
 *      cuidador de outra família junto com o paciente desta — invariante 2
 *      quebrado por dentro de um campo que ninguém olha.
 *
 *   2. **Vínculo virar autorização.** Um cuidador SEM vínculo nenhum continua
 *      recebendo a lista inteira de pacientes da família. Se alguém "melhorar"
 *      isso e passar a filtrar `GET /patients` pelo vínculo, toda família que
 *      ainda não vinculou ninguém abre o app numa lista vazia. Este teste
 *      falha antes disso chegar ao `main`.
 * ═══════════════════════════════════════════════════════════════════════════
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  familiesTable,
  caregiversTable,
  patientsTable,
  caregiverPatientsTable,
} from "@workspace/db";
import { generateAccessToken } from "../lib/tokens.ts";
import app from "../app.ts";

const SUFIXO = "@descobertos.zelo.test";

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
  await closeServer();
  await db.delete(usersTable).where(like(usersTable.email, `%${SUFIXO}`));
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Fictícia Descoberto %"));
});

interface PacienteDaLista {
  id: number;
  name: string;
  responsaveis: Array<{ id: number; name: string }>;
}

async function listarPacientes(token: string): Promise<PacienteDaLista[]> {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: testPort,
        path: "/api/patients",
        method: "GET",
        headers: { Authorization: `Bearer ${token}` },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          assert.equal(res.statusCode, 200, data);
          resolve(JSON.parse(data) as PacienteDaLista[]);
        });
      },
    );
    req.on("error", reject);
    req.end();
  });
}

/**
 * Uma família com dois cuidadores e dois pacientes, nenhum vínculo criado.
 *
 * Dois pacientes de propósito: com um só, "a lista devolveu o responsável
 * certo" e "a lista devolveu o único responsável que existe" são a mesma
 * frase, e o teste passaria mesmo se o Map ignorasse a chave.
 */
async function cenario(rotulo: string) {
  const marca = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const [family] = await db
    .insert(familiesTable)
    .values({
      name: `Família Fictícia Descoberto ${rotulo} ${marca}`,
      slug: `desc-${rotulo}-${marca}`,
    })
    .returning({ id: familiesTable.id });

  const criarCuidador = async (papel: "primary_caregiver" | "caregiver", sufixo: string) => {
    const email = `desc-${rotulo}-${sufixo}-${marca}${SUFIXO}`;
    const [user] = await db
      .insert(usersTable)
      .values({
        email,
        name: `Pessoa Fictícia ${sufixo}`,
        passwordHash: "hash-nao-usado",
        emailVerified: true,
        status: "active",
        activeFamilyId: family.id,
      })
      .returning({ id: usersTable.id });

    const [c] = await db
      .insert(caregiversTable)
      .values({
        familyId: family.id,
        userId: user.id,
        name: `Pessoa Fictícia ${sufixo}`,
        email,
        role: papel,
      })
      .returning({ id: caregiversTable.id });

    return { id: c.id, nome: `Pessoa Fictícia ${sufixo}`, token: generateAccessToken(user.id, family.id, c.id, papel) };
  };

  const principal = await criarCuidador("primary_caregiver", "Principal");
  const comum = await criarCuidador("caregiver", "Comum");

  const criarPaciente = async (nome: string) => {
    const [p] = await db
      .insert(patientsTable)
      .values({ familyId: family.id, name: nome, timezone: "America/Sao_Paulo" })
      .returning({ id: patientsTable.id });
    return p.id;
  };

  const maria = await criarPaciente("Dona Maria Teste");
  const joao = await criarPaciente("Seu João Teste");

  return { familyId: family.id, principal, comum, maria, joao };
}

describe("Paciente descoberto em GET /patients", () => {
  it("paciente sem vínculo vem com `responsaveis` vazio, não `undefined`", async () => {
    const c = await cenario("vazio");

    const lista = await listarPacientes(c.principal.token);
    assert.equal(lista.length, 2);

    for (const p of lista) {
      // Vazio e não ausente: a tela distingue "está descoberto" de "o campo
      // não veio", e as duas coisas se parecem demais quando é `undefined`.
      assert.ok(Array.isArray(p.responsaveis), `sem array em ${p.name}`);
      assert.equal(p.responsaveis.length, 0);
    }
  });

  it("o responsável aparece no paciente certo, e só nele", async () => {
    const c = await cenario("certo");

    await db.insert(caregiverPatientsTable).values({
      caregiverId: c.comum.id,
      patientId: c.maria,
      createdByCaregiverId: c.principal.id,
    });

    const lista = await listarPacientes(c.principal.token);
    const maria = lista.find((p) => p.id === c.maria);
    const joao = lista.find((p) => p.id === c.joao);

    assert.ok(maria && joao);
    assert.deepEqual(
      maria.responsaveis.map((r) => r.id),
      [c.comum.id],
    );
    assert.equal(maria.responsaveis[0].name, c.comum.nome);
    // O outro paciente da MESMA família continua descoberto. É o que pega um
    // Map indexado pela chave errada.
    assert.equal(joao.responsaveis.length, 0);
  });

  it("cuidador de outra família nunca aparece como responsável", async () => {
    const a = await cenario("famA");
    const b = await cenario("famB");

    // Vínculo legítimo dentro de cada família.
    await db.insert(caregiverPatientsTable).values({
      caregiverId: a.comum.id,
      patientId: a.maria,
      createdByCaregiverId: a.principal.id,
    });
    await db.insert(caregiverPatientsTable).values({
      caregiverId: b.comum.id,
      patientId: b.maria,
      createdByCaregiverId: b.principal.id,
    });

    const lista = await listarPacientes(a.principal.token);

    // Nem o paciente nem o cuidador da outra família encostam nesta resposta.
    assert.ok(!lista.some((p) => p.id === b.maria), "paciente de outra família na lista");
    const idsDeResponsaveis = lista.flatMap((p) => p.responsaveis.map((r) => r.id));
    assert.ok(
      !idsDeResponsaveis.includes(b.comum.id),
      "cuidador de outra família apareceu como responsável",
    );
  });

  it("VÍNCULO NÃO É AUTORIZAÇÃO: sem vínculo nenhum, a lista continua completa", async () => {
    const c = await cenario("acesso");

    // `comum` não é responsável por ninguém. Ainda assim vê os dois pacientes
    // da família — é assim que o produto funciona, e mudar isso quebraria
    // toda família que ainda não vinculou ninguém.
    const lista = await listarPacientes(c.comum.token);
    assert.equal(lista.length, 2);
    assert.deepEqual(
      lista.map((p) => p.id).sort((x, y) => x - y),
      [c.maria, c.joao].sort((x, y) => x - y),
    );
  });
});
