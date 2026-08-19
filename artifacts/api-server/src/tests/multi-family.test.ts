/**
 * Cuidador em mais de uma família — ZELO (bug de produção, 18/08/2026).
 *
 * CENÁRIO REAL QUE QUEBROU: uma cuidadora convidada clicou no link, não
 * tinha conta, se cadastrou (o cadastro criava uma família PRÓPRIA vazia),
 * aceitou o convite (segundo vínculo, agora na família de quem convidou) e
 * no login caía na família dela — sem paciente nenhum, sem os outros
 * cuidadores. Do lado de quem convidou, o vínculo aparecia normalmente,
 * então o bug era invisível pra quem administrava.
 *
 * Três garantias testadas aqui:
 * 1. Cadastro COM token de convite entra direto na família de quem
 *    convidou, sem criar família fantasma.
 * 2. Login é determinístico pra quem tem várias famílias — nunca "a
 *    primeira que o banco devolver".
 * 3. Quem já está com duas famílias (como a Ana) consegue trocar.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, inArray } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable, caregiversTable, familiesTable, patientsTable, caregiverInvitesTable,
} from "@workspace/db";
import { generateAccessToken, generateOneTimeToken, hashToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { resolveActiveCaregiver } from "../lib/active-family.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let ownerFamilyId: number;
let ownerToken: string;
let ownerPatientId: number;
const createdUserIds: number[] = [];
const createdFamilyIds: number[] = [];

async function api(method: string, path: string, body: unknown, token?: string): Promise<{ status: number; body: unknown }> {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c: Buffer) => (data += c.toString()));
        res.on("end", () => {
          try { resolve({ status: res.statusCode ?? 0, body: JSON.parse(data) }); }
          catch { resolve({ status: res.statusCode ?? 0, body: data }); }
        });
      }
    );
    req.on("error", reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Cria um convite pendente direto no banco, como POST /invites faria. */
async function createInvite(role: "caregiver" | "hired_caregiver" | "observer"): Promise<string> {
  const { raw, hash } = generateOneTimeToken();
  await db.insert(caregiverInvitesTable).values({
    familyId: ownerFamilyId,
    tokenHash: hash,
    role,
    expiresAt: new Date(Clock.now().getTime() + 7 * 86_400_000),
  });
  return raw;
}

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

  const [family] = await db.insert(familiesTable).values({ name: "Família Multi Teste", slug: `multi-fam-${Date.now()}` }).returning();
  ownerFamilyId = family.id;
  createdFamilyIds.push(family.id);

  const [owner] = await db.insert(usersTable).values({
    email: `multi-owner-${Date.now()}@zelo.test`, name: "Dono da Família",
    passwordHash: await hashPassword("SenhaForte#2026"), emailVerified: true, status: "active",
  }).returning();
  createdUserIds.push(owner.id);
  const [ownerCaregiver] = await db.insert(caregiversTable).values({
    familyId: ownerFamilyId, userId: owner.id, name: "Dono da Família", role: "primary_caregiver",
  }).returning();
  ownerToken = generateAccessToken(owner.id, ownerFamilyId, ownerCaregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({
    familyId: ownerFamilyId, name: "Paciente Multi Teste", timezone: "America/Sao_Paulo",
  }).returning();
  ownerPatientId = patient.id;
});

after(async () => {
  Clock.reset();
  await closeServer();
  if (createdUserIds.length > 0) await db.delete(usersTable).where(inArray(usersTable.id, createdUserIds));
  if (createdFamilyIds.length > 0) await db.delete(familiesTable).where(inArray(familiesTable.id, createdFamilyIds));
});

describe("Cadastro por link de convite — não cria família fantasma", () => {
  it("quem se cadastra COM inviteToken entra direto na família de quem convidou, como único vínculo", async () => {
    const inviteToken = await createInvite("hired_caregiver");
    const email = `convidada-${Date.now()}@zelo.test`;

    const res = await api("POST", "/auth/register", {
      name: "Cuidadora Convidada", email, password: "SenhaForte#2026",
      consentTerms: true, consentHealthData: true, inviteToken,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    createdUserIds.push(user.id);

    const links = await db.select().from(caregiversTable).where(eq(caregiversTable.userId, user.id));
    assert.equal(links.length, 1, "um vínculo só — a família fantasma é exatamente o bug que quebrou a produção");
    assert.equal(links[0].familyId, ownerFamilyId, "e o vínculo é com a família de quem convidou");
    assert.equal(links[0].role, "hired_caregiver", "o papel vem do convite — não vira dona da família alheia");

    // O convite não pode continuar valendo depois de usado no cadastro.
    const [invite] = await db.select().from(caregiverInvitesTable).where(eq(caregiverInvitesTable.tokenHash, hashToken(inviteToken)));
    assert.equal(invite.used, true);
    assert.equal(invite.status, "accepted");
  });

  it("ela enxerga o paciente e os cuidadores da família — o sintoma que o usuário reportou", async () => {
    const inviteToken = await createInvite("caregiver");
    const email = `convidada-ve-${Date.now()}@zelo.test`;

    await api("POST", "/auth/register", {
      name: "Cuidadora Que Enxerga", email, password: "SenhaForte#2026",
      consentTerms: true, consentHealthData: true, inviteToken,
    });
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    createdUserIds.push(user.id);

    const login = await api("POST", "/auth/login", { email, password: "SenhaForte#2026" });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    const token = (login.body as { accessToken: string }).accessToken;

    const patients = await api("GET", "/patients", undefined, token);
    assert.ok((patients.body as Array<{ id: number }>).some((p) => p.id === ownerPatientId), "precisa ver o paciente da família");

    const caregivers = await api("GET", "/caregivers", undefined, token);
    assert.ok((caregivers.body as Array<{ name: string }>).length >= 2, "precisa ver os outros cuidadores, não só ela mesma");

    const me = await api("GET", "/account/me", undefined, token);
    assert.equal((me.body as { caregiver: { familyId: number } }).caregiver.familyId, ownerFamilyId);
    assert.equal((me.body as { family: { name: string } }).family.name, "Família Multi Teste", "o cabeçalho mostra a família certa");
  });

  it("convite inválido não bloqueia o cadastro — cai no caminho normal, com família própria", async () => {
    const email = `token-ruim-${Date.now()}@zelo.test`;
    const res = await api("POST", "/auth/register", {
      name: "Cadastro Com Token Ruim", email, password: "SenhaForte#2026",
      consentTerms: true, consentHealthData: true, inviteToken: "token-que-nao-existe",
    });
    assert.equal(res.status, 201, "conta legítima nunca deve ser recusada por causa de um convite ruim");

    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    createdUserIds.push(user.id);
    const links = await db.select().from(caregiversTable).where(eq(caregiversTable.userId, user.id));
    assert.equal(links.length, 1);
    assert.notEqual(links[0].familyId, ownerFamilyId, "não entra na família de ninguém com token inválido");
    assert.equal(links[0].role, "primary_caregiver", "é dona da própria família");
    createdFamilyIds.push(links[0].familyId);
  });
});

describe("Login determinístico e troca de família", () => {
  it("reproduz o estado quebrado (2 famílias) e prova que o login não varia mais entre chamadas", async () => {
    // Exatamente o que aconteceu: cadastro normal (família própria) e SÓ
    // DEPOIS o aceite do convite — dois vínculos, como a conta da produção.
    const email = `duas-familias-${Date.now()}@zelo.test`;
    await api("POST", "/auth/register", {
      name: "Cuidadora Com Duas", email, password: "SenhaForte#2026",
      consentTerms: true, consentHealthData: true,
    });
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    createdUserIds.push(user.id);
    const ownLinks = await db.select().from(caregiversTable).where(eq(caregiversTable.userId, user.id));
    const ownFamilyId = ownLinks[0].familyId;
    createdFamilyIds.push(ownFamilyId);

    const inviteToken = await createInvite("caregiver");
    const firstLogin = await api("POST", "/auth/login", { email, password: "SenhaForte#2026" });
    const firstToken = (firstLogin.body as { accessToken: string }).accessToken;
    const accept = await api("POST", "/invites/accept", { token: inviteToken }, firstToken);
    assert.equal(accept.status, 201, JSON.stringify(accept.body));

    const links = await db.select().from(caregiversTable).where(eq(caregiversTable.userId, user.id));
    assert.equal(links.length, 2, "o estado da produção: dois vínculos, duas famílias");

    // Antes da correção isto era `.limit(1)` sem ordenação: podia variar.
    const a = await resolveActiveCaregiver(user.id);
    const b = await resolveActiveCaregiver(user.id);
    const c = await resolveActiveCaregiver(user.id);
    assert.equal(a!.familyId, b!.familyId);
    assert.equal(b!.familyId, c!.familyId);

    // E a troca funciona nos dois sentidos, que é o que desbloqueia quem
    // já estava preso na família errada.
    const loginRes = await api("POST", "/auth/login", { email, password: "SenhaForte#2026" });
    let token = (loginRes.body as { accessToken: string }).accessToken;

    const families = await api("GET", "/account/families", undefined, token);
    const list = families.body as Array<{ familyId: number; isActive: boolean }>;
    assert.equal(list.length, 2);
    assert.equal(list.filter((f) => f.isActive).length, 1, "exatamente uma família ativa por vez");

    const switched = await api("POST", "/account/switch-family", { familyId: ownerFamilyId }, token);
    assert.equal(switched.status, 200, JSON.stringify(switched.body));
    token = (switched.body as { accessToken: string }).accessToken;

    const patients = await api("GET", "/patients", undefined, token);
    assert.ok((patients.body as Array<{ id: number }>).some((p) => p.id === ownerPatientId), "depois de trocar, vê o paciente da outra família");

    // A escolha persiste: um login novo já abre na família trocada.
    const relogin = await api("POST", "/auth/login", { email, password: "SenhaForte#2026" });
    const reloginToken = (relogin.body as { accessToken: string }).accessToken;
    const me = await api("GET", "/account/me", undefined, reloginToken);
    assert.equal((me.body as { caregiver: { familyId: number } }).caregiver.familyId, ownerFamilyId, "a troca sobrevive ao logout/login");

    const back = await api("POST", "/account/switch-family", { familyId: ownFamilyId }, reloginToken);
    assert.equal(back.status, 200, "e dá pra voltar pra própria família");
  });

  it("não deixa trocar pra uma família onde o usuário não é cuidador", async () => {
    const email = `sem-acesso-${Date.now()}@zelo.test`;
    await api("POST", "/auth/register", {
      name: "Sem Acesso", email, password: "SenhaForte#2026",
      consentTerms: true, consentHealthData: true,
    });
    const [user] = await db.select().from(usersTable).where(eq(usersTable.email, email));
    createdUserIds.push(user.id);
    const links = await db.select().from(caregiversTable).where(eq(caregiversTable.userId, user.id));
    createdFamilyIds.push(links[0].familyId);

    const login = await api("POST", "/auth/login", { email, password: "SenhaForte#2026" });
    const token = (login.body as { accessToken: string }).accessToken;

    const res = await api("POST", "/account/switch-family", { familyId: ownerFamilyId }, token);
    assert.equal(res.status, 404, "familyId vindo do cliente nunca é confiado — precisa existir vínculo");

    const me = await api("GET", "/account/me", undefined, token);
    assert.notEqual((me.body as { caregiver: { familyId: number } }).caregiver.familyId, ownerFamilyId);
  });
});
