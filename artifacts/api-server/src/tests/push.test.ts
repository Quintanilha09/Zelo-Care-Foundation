/**
 * Testes de Web Push — ZELO (ZELO-26).
 *
 * webpush.sendNotification fala HTTPS direto com o serviço de push real
 * (FCM, Mozilla) — não dá pra apontar isso pra um servidor de teste local
 * sem montar TLS com certificado próprio. Em vez disso, os testes de envio
 * mockam webpush.sendNotification (node:test tem mock embutido) pra
 * simular sucesso, 410 (assinatura morta) e 500 (erro transitório) — o que
 * importa aqui é a REAÇÃO do nosso código a cada caso, não o protocolo
 * HTTP do web-push em si. A entrega de verdade num aparelho fica de fora,
 * como sempre, verificada manualmente (Replit).
 *
 * As chaves VAPID vêm do .env.local — sem elas, sendPushToSubscription
 * devolve "not_configured" sem tentar enviar nada; os testes de envio são
 * pulados nesse caso.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, caregiversTable, familiesTable, patientsTable, pushSubscriptionsTable, notificationPreferencesTable } from "@workspace/db";
import webpush from "web-push";
import { generateAccessToken } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { boss } from "../lib/queue.ts";
import app from "../app.ts";

let testPort: number;
let closeServer: () => Promise<void>;
let familyId: number;
let token: string;
let patientId: number;

// web-push valida o FORMATO das chaves antes de qualquer coisa (p256dh
// precisa decodificar pra 65 bytes, um ponto EC P-256 descomprimido; auth
// pra 16 bytes) — não são chaves reais de nenhum dispositivo, só bytes do
// tamanho certo pra passar dessa validação.
const FAKE_P256DH = "BLo2cuzlA-4wjOA7jjnJbnw8wRUwGPJgEYbL1xwuLk-1lavTlcvJZoEq991XtZjCV1seThGWVJwhVb1_OEnjwSM";
const FAKE_AUTH = "E8QZ6W_hYURALUeSRTn6DA";

async function api(authToken: string, method: string, path: string, body?: unknown) {
  const payload = body !== undefined ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
    const req = http.request(
      {
        hostname: "127.0.0.1", port: testPort, path: `/api${path}`, method,
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`,
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

function fakeEndpoint(): string {
  return `https://push.test/${Math.random().toString(36).slice(2)}`;
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

  const [family] = await db.insert(familiesTable).values({ name: "Família Push Teste", slug: `push-test-${Date.now()}` }).returning();
  familyId = family.id;

  const [user] = await db.insert(usersTable).values({
    email: `push-${Date.now()}@zelo.test`, name: "Cuidador Push", passwordHash: await hashPassword("x"), emailVerified: true, status: "active",
  }).returning();

  const [caregiver] = await db.insert(caregiversTable).values({ familyId, userId: user.id, name: "Cuidador Push", role: "primary_caregiver" }).returning();
  token = generateAccessToken(user.id, familyId, caregiver.id, "primary_caregiver");

  const [patient] = await db.insert(patientsTable).values({ familyId, name: "Paciente Push Teste", timezone: "America/Sao_Paulo" }).returning();
  patientId = patient.id;
});

after(async () => {
  await closeServer();
  await boss.stop({ graceful: false });
  await db.delete(familiesTable).where(eq(familiesTable.id, familyId));
});

describe("Assinatura de push — ZELO-26", () => {
  it("GET /push/vapid-public-key devolve a chave configurada", async () => {
    const res = await api(token, "GET", "/push/vapid-public-key");
    assert.ok(res.status === 200 || res.status === 503);
    if (res.status === 200) assert.ok((res.body as { publicKey: string }).publicKey.length > 0);
  });

  it("assinar, listar e desassinar um dispositivo", async () => {
    const endpoint = fakeEndpoint();
    const subscribeRes = await api(token, "POST", "/push/subscribe", {
      endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "iPhone de Teste",
    });
    assert.equal(subscribeRes.status, 200);

    const listRes = await api(token, "GET", "/push/subscriptions");
    const subs = listRes.body as Array<{ deviceLabel: string | null; active: boolean }>;
    assert.ok(subs.some((s) => s.deviceLabel === "iPhone de Teste" && s.active));
    // nunca devolve as chaves de criptografia pro cliente
    assert.equal((subs[0] as unknown as { p256dh?: string }).p256dh, undefined);

    const deleteRes = await api(token, "DELETE", "/push/subscribe", { endpoint });
    assert.equal(deleteRes.status, 204);

    const listAfter = await api(token, "GET", "/push/subscriptions");
    assert.equal((listAfter.body as Array<{ deviceLabel: string | null }>).some((s) => s.deviceLabel === "iPhone de Teste"), false);
  });

  it("assinar de novo com o mesmo endpoint atualiza em vez de duplicar", async () => {
    const endpoint = fakeEndpoint();
    await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Label 1" });
    await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Label 2" });

    const list = (await api(token, "GET", "/push/subscriptions")).body as Array<{ deviceLabel: string | null }>;
    assert.equal(list.filter((s) => s.deviceLabel === "Label 1" || s.deviceLabel === "Label 2").length, 1, "reassinar o mesmo endpoint não deve duplicar a linha");

    await api(token, "DELETE", "/push/subscribe", { endpoint });
  });
});

describe("Envio de push e limpeza automática de assinatura expirada — ZELO-26", () => {
  it("envio bem-sucedido: sent=1, assinatura continua ativa e failureCount zera", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => ({ statusCode: 201, body: "", headers: {} }));

    const endpoint = fakeEndpoint();
    const sub = await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo OK" });
    const subscriptionId = (sub.body as { id: number }).id;

    const testRes = await api(token, "POST", "/push/test", { subscriptionId });
    assert.equal(testRes.status, 200);
    assert.deepEqual(testRes.body, { sent: 1, expired: 0, failed: 0, results: [{ subscriptionId, result: { ok: true } }] });

    const list = (await api(token, "GET", "/push/subscriptions")).body as Array<{ id: number; active: boolean; failureCount: number }>;
    const row = list.find((s) => s.id === subscriptionId);
    assert.equal(row?.active, true);
    assert.equal(row?.failureCount, 0);

    await api(token, "DELETE", "/push/subscribe", { endpoint });
  });

  it("410 do serviço de push desativa a assinatura sozinha", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => {
      const err = new Error("Gone") as Error & { statusCode: number };
      err.statusCode = 410;
      throw err;
    });

    const endpoint = fakeEndpoint();
    const sub = await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo Expirado" });
    const subscriptionId = (sub.body as { id: number }).id;

    const testRes = await api(token, "POST", "/push/test", { subscriptionId });
    assert.equal((testRes.body as { expired: number }).expired, 1);

    const list = (await api(token, "GET", "/push/subscriptions")).body as Array<{ id: number; active: boolean }>;
    assert.equal(list.find((s) => s.id === subscriptionId)?.active, false, "assinatura com 410 deve ser desativada automaticamente");

    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, subscriptionId));
  });

  it("404 do serviço de push também conta como expirada (não só 410)", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => {
      const err = new Error("Not Found") as Error & { statusCode: number };
      err.statusCode = 404;
      throw err;
    });

    const endpoint = fakeEndpoint();
    const sub = await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo 404" });
    const subscriptionId = (sub.body as { id: number }).id;

    await api(token, "POST", "/push/test", { subscriptionId });

    const list = (await api(token, "GET", "/push/subscriptions")).body as Array<{ id: number; active: boolean }>;
    assert.equal(list.find((s) => s.id === subscriptionId)?.active, false);

    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, subscriptionId));
  });

  it("erro transitório (500) incrementa failureCount mas mantém a assinatura ativa", async (t) => {
    if (!process.env.VAPID_PUBLIC_KEY) { t.skip("VAPID_PUBLIC_KEY não configurada neste ambiente"); return; }
    t.mock.method(webpush, "sendNotification", async () => {
      const err = new Error("Internal Server Error") as Error & { statusCode: number };
      err.statusCode = 500;
      throw err;
    });

    const endpoint = fakeEndpoint();
    const sub = await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo Instável" });
    const subscriptionId = (sub.body as { id: number }).id;

    await api(token, "POST", "/push/test", { subscriptionId });

    const list = (await api(token, "GET", "/push/subscriptions")).body as Array<{ id: number; active: boolean; failureCount: number }>;
    const row = list.find((s) => s.id === subscriptionId);
    assert.equal(row?.active, true, "erro transitório não é a mesma coisa que assinatura expirada — não desativa");
    assert.ok((row?.failureCount ?? 0) >= 1);

    await db.delete(pushSubscriptionsTable).where(eq(pushSubscriptionsTable.id, subscriptionId));
  });

  it("POST /push/ack (chamado pelo service worker) registra a entrega confirmada", async () => {
    const endpoint = fakeEndpoint();
    await api(token, "POST", "/push/subscribe", { endpoint, keys: { p256dh: FAKE_P256DH, auth: FAKE_AUTH }, deviceLabel: "Dispositivo Ack" });

    const before = (await api(token, "GET", "/push/subscriptions")).body as Array<{ deviceLabel: string | null; lastDeliveredAt: string | null }>;
    assert.equal(before.find((s) => s.deviceLabel === "Dispositivo Ack")?.lastDeliveredAt, null);

    // /push/ack não tem auth — é chamado de dentro do evento `push` do service
    // worker, que não tem acesso ao token da página.
    const ackRes = await new Promise<{ status: number }>((resolve, reject) => {
      const payload = JSON.stringify({ endpoint });
      const req = http.request(
        { hostname: "127.0.0.1", port: testPort, path: "/api/push/ack", method: "POST", headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(payload) } },
        (res) => resolve({ status: res.statusCode ?? 0 })
      );
      req.on("error", reject);
      req.write(payload);
      req.end();
    });
    assert.equal(ackRes.status, 204);

    const after = (await api(token, "GET", "/push/subscriptions")).body as Array<{ deviceLabel: string | null; lastDeliveredAt: string | null }>;
    assert.ok(after.find((s) => s.deviceLabel === "Dispositivo Ack")?.lastDeliveredAt !== null);

    await api(token, "DELETE", "/push/subscribe", { endpoint });
  });
});

describe("Preferências de notificação por paciente — ZELO-26", () => {
  it("padrão é tudo ativado até o cuidador desligar algo", async () => {
    const res = await api(token, "GET", `/patients/${patientId}/notification-preferences`);
    assert.equal(res.status, 200);
    const { preferences } = res.body as { preferences: Array<{ category: string; enabled: boolean }> };
    assert.equal(preferences.length, 4);
    assert.ok(preferences.every((p) => p.enabled === true));
  });

  it("desligar uma categoria persiste e não afeta as outras", async () => {
    const patch = await api(token, "PATCH", `/patients/${patientId}/notification-preferences`, { category: "stock", enabled: false });
    assert.equal(patch.status, 200);

    const res = await api(token, "GET", `/patients/${patientId}/notification-preferences`);
    const { preferences } = res.body as { preferences: Array<{ category: string; enabled: boolean }> };
    assert.equal(preferences.find((p) => p.category === "stock")?.enabled, false);
    assert.equal(preferences.find((p) => p.category === "dose")?.enabled, true);

    // liga de novo — testa o caminho de UPDATE do upsert, não só o de INSERT
    await api(token, "PATCH", `/patients/${patientId}/notification-preferences`, { category: "stock", enabled: true });
    const resAfter = await api(token, "GET", `/patients/${patientId}/notification-preferences`);
    const { preferences: prefsAfter } = resAfter.body as { preferences: Array<{ category: string; enabled: boolean }> };
    assert.equal(prefsAfter.find((p) => p.category === "stock")?.enabled, true);

    await db.delete(notificationPreferencesTable).where(eq(notificationPreferencesTable.patientId, patientId));
  });

  it("categoria inválida é rejeitada com 400", async () => {
    const res = await api(token, "PATCH", `/patients/${patientId}/notification-preferences`, { category: "invalida", enabled: false });
    assert.equal(res.status, 400);
  });
});
