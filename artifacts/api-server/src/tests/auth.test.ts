/**
 * Testes de autenticação — ZELO.
 *
 * Cobre:
 * - Cadastro completo (usuário + família + cuidador + consentimentos)
 * - Verificação de e-mail
 * - Login com credenciais corretas e incorretas
 * - Token de acesso revogado rejeitado IMEDIATAMENTE (sem esperar expirar)
 * - Rotação de refresh token: token antigo rejeitado após renovação
 * - Detecção de roubo de sessão: reusar token antigo derruba TODAS as sessões
 * - Logout individual e logout de todos os dispositivos
 * - Recuperação de senha
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { eq, like } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  caregiversTable,
  familiesTable,
  refreshTokensTable,
  passwordResetsTable,
  consentRecordsTable,
} from "@workspace/db";
import { hashToken, generateAccessToken, } from "../lib/tokens.ts";
import { hashPassword } from "../lib/password.ts";
import { Clock } from "../lib/clock.ts";
import app from "../app.ts";

// ── Helpers ───────────────────────────────────────────────────────────────

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
  // Limpa dados criados pelos testes (by email pattern)
  await db.delete(usersTable).where(eq(usersTable.email, "auth-test@zelo.test"));
  await db.delete(usersTable).where(eq(usersTable.email, "auth-test2@zelo.test"));
  // Apaga a FAMÍLIA, não só o usuário. `families` é a raiz: patients e
  // caregivers têm cascade a partir dela, mas nada cascateia a partir de
  // `users` — apagar o usuário deixava a família para trás. Em 24/08/2026
  // havia ~90 famílias órfãs acumuladas no banco de dev.
  //
  // Por PADRÃO DE NOME, não por id capturado: assim também recolhe o lixo de
  // execuções anteriores que morreram antes do `after` — que é como a maior
  // parte das órfãs apareceu. Torna a limpeza idempotente, mesma regra que
  // este projeto já aplica aos hooks `before`.
  await db.delete(familiesTable).where(like(familiesTable.name, "Família Teste %@zelo.test"));
});

async function api(method: string, path: string, body?: unknown, token?: string) {
  const payload = body ? JSON.stringify(body) : undefined;
  return new Promise<{ status: number; body: unknown }>((resolve, reject) => {
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
        res.on("data", (chunk: Buffer) => (data += chunk.toString()));
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

/** Cria um usuário de teste já verificado diretamente no banco. */
async function createVerifiedUser(email: string, password: string) {
  const hash = await hashPassword(password);
  const [family] = await db
    .insert(familiesTable)
    .values({ name: `Família Teste ${email}`, slug: `test-${Date.now()}-${Math.random().toString(36).slice(2)}` })
    .returning();

  const [user] = await db
    .insert(usersTable)
    .values({ email, name: "Usuário Teste", passwordHash: hash, emailVerified: true, status: "active" })
    .returning();

  const [caregiver] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, userId: user.id, name: "Usuário Teste", email, role: "primary_caregiver" })
    .returning();

  await db.insert(consentRecordsTable).values([
    { userId: user.id, consentType: "terms_of_service", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1" },
    { userId: user.id, consentType: "health_data_processing", consentGiven: "true", version: "v1.0", ipAddress: "127.0.0.1" },
  ]);

  return { userId: user.id, familyId: family.id, caregiverId: caregiver.id, role: caregiver.role as "primary_caregiver" };
}

// ── Testes ────────────────────────────────────────────────────────────────

describe("Autenticação — ZELO", () => {

  describe("Cadastro", () => {
    it("cadastro com consentimentos retorna 201", async () => {
      const res = await api("POST", "/auth/register", {
        name: "Teste Auth",
        email: "auth-test@zelo.test",
        password: "SenhaSegura123!",
        consentTerms: true,
        consentHealthData: true,
      });
      assert.equal(res.status, 201);
    });

    it("cadastro sem consentimento de saúde retorna 400", async () => {
      const res = await api("POST", "/auth/register", {
        name: "Teste Sem Consent",
        email: "auth-noconsent@zelo.test",
        password: "SenhaSegura123!",
        consentTerms: true,
        consentHealthData: false,
      });
      assert.equal(res.status, 400);
    });

    it("cadastro com senha fraca retorna 400", async () => {
      const res = await api("POST", "/auth/register", {
        name: "Teste Senha Fraca",
        email: "auth-weak@zelo.test",
        password: "123",
        consentTerms: true,
        consentHealthData: true,
      });
      assert.equal(res.status, 400);
    });
  });

  describe("Login", () => {
    let userId: number;
    let familyId: number;
    let caregiverId: number;

    before(async () => {
      const result = await createVerifiedUser("auth-test2@zelo.test", "SenhaSegura456!");
      userId = result.userId;
      familyId = result.familyId;
      caregiverId = result.caregiverId;
    });

    it("login com credenciais corretas retorna access + refresh token", async () => {
      const res = await api("POST", "/auth/login", {
        email: "auth-test2@zelo.test",
        password: "SenhaSegura456!",
      });
      assert.equal(res.status, 200);
      const body = res.body as Record<string, unknown>;
      assert.ok(typeof body.accessToken === "string", "deve ter accessToken");
      assert.ok(typeof body.refreshToken === "string", "deve ter refreshToken");
      assert.equal(body.expiresIn, 900);
    });

    it("login com senha errada retorna 401", async () => {
      const res = await api("POST", "/auth/login", {
        email: "auth-test2@zelo.test",
        password: "SenhaErrada!",
      });
      assert.equal(res.status, 401);
    });

    it("login com e-mail inexistente retorna 401 (sem confirmar existência)", async () => {
      const res = await api("POST", "/auth/login", {
        email: "naoexiste@zelo.test",
        password: "QualquerCoisa!",
      });
      assert.equal(res.status, 401);
    });

    describe("Token de acesso revogado — rejeitado imediatamente sem esperar expirar", () => {
      it("token revogado é rejeitado na próxima requisição", async () => {
        // Gera token e o revoga imediatamente via blacklist em memória
        const accessToken = generateAccessToken(userId, familyId, caregiverId, "primary_caregiver");

        // Usa o token — deve funcionar antes de revogar
        const okRes = await api("GET", "/patients", undefined, accessToken);
        assert.equal(okRes.status, 200, "deve funcionar antes de revogar");

        // Revoga via logout
        const loginRes = await api("POST", "/auth/login", {
          email: "auth-test2@zelo.test",
          password: "SenhaSegura456!",
        });
        const { accessToken: accessToken2, refreshToken } = loginRes.body as Record<string, string>;

        const logoutRes = await api("POST", "/auth/logout", { refreshToken }, accessToken2);
        assert.equal(logoutRes.status, 204);

        // O access token deve ser rejeitado imediatamente após logout
        const afterRes = await api("GET", "/patients", undefined, accessToken2);
        assert.equal(afterRes.status, 401, "token revogado deve ser rejeitado imediatamente");
      });
    });

    describe("Rotação de refresh token", () => {
      it("refresh retorna novo par de tokens e invalida o antigo", async () => {
        const loginRes = await api("POST", "/auth/login", {
          email: "auth-test2@zelo.test",
          password: "SenhaSegura456!",
        });
        const { refreshToken: oldRefresh } = loginRes.body as Record<string, string>;

        // Usa o refresh para obter novos tokens
        const refreshRes = await api("POST", "/auth/refresh", { refreshToken: oldRefresh });
        assert.equal(refreshRes.status, 200, "refresh deve funcionar");
        const { accessToken: newAccess, refreshToken: newRefresh } = refreshRes.body as Record<string, string>;
        assert.ok(newAccess, "deve retornar novo access token");
        assert.ok(newRefresh, "deve retornar novo refresh token");
        assert.notEqual(newRefresh, oldRefresh, "novo refresh deve ser diferente do antigo");

        // O token antigo deve estar revogado no banco
        const oldHash = hashToken(oldRefresh);
        const [oldRecord] = await db
          .select({ revoked: refreshTokensTable.revoked })
          .from(refreshTokensTable)
          .where(eq(refreshTokensTable.tokenHash, oldHash))
          .limit(1);
        assert.ok(oldRecord?.revoked, "token antigo deve estar revogado no banco");
      });

      it("ROUBO DE SESSÃO: reusar token já rotacionado derruba TODAS as sessões", async () => {
        // Cria uma sessão fresca
        const loginRes = await api("POST", "/auth/login", {
          email: "auth-test2@zelo.test",
          password: "SenhaSegura456!",
        });
        const { refreshToken: originalToken } = loginRes.body as Record<string, string>;

        // Primeiro refresh legítimo (rotaciona)
        const firstRefreshRes = await api("POST", "/auth/refresh", { refreshToken: originalToken });
        assert.equal(firstRefreshRes.status, 200);
        const { accessToken: legitimateAccess, refreshToken: newToken } = firstRefreshRes.body as Record<string, string>;

        // Verifica que o novo token funciona
        const validRes = await api("GET", "/patients", undefined, legitimateAccess);
        assert.equal(validRes.status, 200, "token legítimo deve funcionar antes do ataque");

        // Avança o relógio 1 segundo para garantir que:
        //   iat(legitimateAccess) < Math.floor(Clock.now()/1000) no momento do theft detection
        // Necessário pois JWT iat tem resolução de 1s — sem avanço, token e revogação
        // caem no mesmo segundo e a comparação iat < logoutAtSec não revogaria o token.
        Clock.advance(1001);

        // ATAQUE: atacante reutiliza o token ORIGINAL (já rotacionado)
        const attackRes = await api("POST", "/auth/refresh", { refreshToken: originalToken });
        assert.equal(attackRes.status, 401, "token antigo deve ser rejeitado");

        // Consequência: TODOS os tokens do usuário devem estar revogados agora
        const newTokenHash = hashToken(newToken);
        const [newRecord] = await db
          .select({ revoked: refreshTokensTable.revoked })
          .from(refreshTokensTable)
          .where(eq(refreshTokensTable.tokenHash, newTokenHash))
          .limit(1);
        assert.ok(newRecord?.revoked, "token legítimo também deve ser revogado (toda a sessão comprometida)");

        // E o access token legítimo também deve ser rejeitado (logout-all em memória)
        const afterAttackRes = await api("GET", "/patients", undefined, legitimateAccess);
        assert.equal(afterAttackRes.status, 401, "access token legítimo rejeitado após detecção de roubo");
      });
    });

    describe("Logout de todos os dispositivos", () => {
      it("logout-all revoga todos os refresh tokens do usuário", async () => {
        // Usuário PRÓPRIO, não o auth-test2@zelo.test reaproveitado no resto do
        // arquivo. O teste anterior (roubo de sessão) usa Clock.advance(1001) e
        // revoga aquele usuário com um carimbo "1s no futuro simulado" — um
        // login novo criado logo depois, mesmo após Clock.reset(), ainda nasce
        // com iat no tempo REAL (que só andou ~150ms reais, não 1001ms), então
        // cai como "revogado antes de existir". Isso não é bug de produção —
        // é dois testes de revogação competindo pelo mesmo usuário. A correção
        // de verdade é isolar o fixture, não brincar mais com o relógio.
        const email = `logout-all-${Date.now()}@zelo.test`;
        const created = await createVerifiedUser(email, "SenhaSegura456!");

        // Cria 2 sessões
        const [l1, l2] = await Promise.all([
          api("POST", "/auth/login", { email, password: "SenhaSegura456!" }),
          api("POST", "/auth/login", { email, password: "SenhaSegura456!" }),
        ]);
        const { accessToken: t1 } = l1.body as Record<string, string>;
        const { refreshToken: r2 } = l2.body as Record<string, string>;

        // Logout-all com a primeira sessão
        const logoutRes = await api("POST", "/auth/logout-all", {}, t1);
        assert.equal(logoutRes.status, 204);

        // O refresh token da segunda sessão deve estar revogado
        const r2Hash = hashToken(r2);
        const [record] = await db
          .select({ revoked: refreshTokensTable.revoked })
          .from(refreshTokensTable)
          .where(eq(refreshTokensTable.tokenHash, r2Hash))
          .limit(1);
        assert.ok(record?.revoked, "todos os tokens devem ser revogados no logout-all");

        await db.delete(usersTable).where(eq(usersTable.id, created.userId));
        await db.delete(familiesTable).where(eq(familiesTable.id, created.familyId));
      });
    });

    describe("Trocar nome e senha da própria conta — Issue #45", () => {
      /**
       * Até 01/09/2026 não havia rota nenhuma para a pessoa mudar os
       * próprios dados. `PATCH /caregivers/:id` existia, mas é o cuidador
       * PRINCIPAL editando OUTRA pessoa, e não toca em `users`.
       */
      it("PATCH /account/me troca o nome, e o cuidador desta família acompanha", async () => {
        const email = `conta-nome-${Date.now()}@zelo.test`;
        const criado = await createVerifiedUser(email, "SenhaSegura456!");
        const login = await api("POST", "/auth/login", { email, password: "SenhaSegura456!" });
        const { accessToken } = login.body as Record<string, string>;

        const res = await api("PATCH", "/account/me", { name: "  Ana   Maria Fictícia  " }, accessToken);
        assert.equal(res.status, 200);

        const [user] = await db
          .select({ name: usersTable.name })
          .from(usersTable)
          .where(eq(usersTable.id, criado.userId))
          .limit(1);
        assert.equal(
          user?.name,
          "Ana Maria Fictícia",
          "o nome precisa ser normalizado antes de gravar — espaço nas pontas e repetido"
        );

        // O nome do cuidador é o que aparece em "quem registrou a dose".
        // Ver dois nomes diferentes para a mesma pessoa é pior que não poder
        // trocar.
        const [caregiver] = await db
          .select({ name: caregiversTable.name })
          .from(caregiversTable)
          .where(eq(caregiversTable.userId, criado.userId))
          .limit(1);
        assert.equal(caregiver?.name, "Ana Maria Fictícia");

        await db.delete(usersTable).where(eq(usersTable.id, criado.userId));
        await db.delete(familiesTable).where(eq(familiesTable.id, criado.familyId));
      });

      it("senha atual errada NÃO troca a senha", async () => {
        const email = `conta-senha-errada-${Date.now()}@zelo.test`;
        const criado = await createVerifiedUser(email, "SenhaSegura456!");
        const login = await api("POST", "/auth/login", { email, password: "SenhaSegura456!" });
        const { accessToken } = login.body as Record<string, string>;

        const res = await api("POST", "/account/password", {
          currentPassword: "SenhaErrada999!",
          newPassword: "OutraSenhaBoa789!",
        }, accessToken);
        assert.equal(res.status, 401);

        // E a senha velha continua valendo — não basta recusar, não pode ter
        // gravado nada pelo caminho.
        const conferindo = await api("POST", "/auth/login", { email, password: "SenhaSegura456!" });
        assert.equal(conferindo.status, 200, "a senha antiga precisa continuar funcionando");

        await db.delete(usersTable).where(eq(usersTable.id, criado.userId));
        await db.delete(familiesTable).where(eq(familiesTable.id, criado.familyId));
      });

      it("senha fraca é recusada antes de qualquer escrita", async () => {
        const email = `conta-senha-fraca-${Date.now()}@zelo.test`;
        const criado = await createVerifiedUser(email, "SenhaSegura456!");
        const login = await api("POST", "/auth/login", { email, password: "SenhaSegura456!" });
        const { accessToken } = login.body as Record<string, string>;

        const res = await api("POST", "/account/password", {
          currentPassword: "SenhaSegura456!",
          newPassword: "curta",
        }, accessToken);
        assert.equal(res.status, 400);

        await db.delete(usersTable).where(eq(usersTable.id, criado.userId));
        await db.delete(familiesTable).where(eq(familiesTable.id, criado.familyId));
      });

      /**
       * O coração desta Issue: trocar senha é o que se faz quando se
       * desconfia de alguém. Se as outras sessões sobrevivessem, a troca não
       * protegeria de nada.
       */
      it("trocar a senha derruba as OUTRAS sessões e mantém a atual", async () => {
        const email = `conta-senha-${Date.now()}@zelo.test`;
        const criado = await createVerifiedUser(email, "SenhaSegura456!");

        const [s1, s2] = await Promise.all([
          api("POST", "/auth/login", { email, password: "SenhaSegura456!" }),
          api("POST", "/auth/login", { email, password: "SenhaSegura456!" }),
        ]);
        const { accessToken: token1 } = s1.body as Record<string, string>;
        const { refreshToken: refresh2 } = s2.body as Record<string, string>;

        const res = await api("POST", "/account/password", {
          currentPassword: "SenhaSegura456!",
          newPassword: "NovaSenhaBoa789!",
        }, token1);
        assert.equal(res.status, 200);

        // A sessão que trocou recebe um par novo — senão ela também cairia,
        // que é o oposto do que a pessoa pediu.
        const novos = res.body as { accessToken?: string; refreshToken?: string };
        assert.ok(novos.accessToken, "quem trocou a senha precisa sair com token novo");
        assert.ok(novos.refreshToken);

        // A OUTRA sessão morreu.
        const [outra] = await db
          .select({ revoked: refreshTokensTable.revoked })
          .from(refreshTokensTable)
          .where(eq(refreshTokensTable.tokenHash, hashToken(refresh2)))
          .limit(1);
        assert.ok(outra?.revoked, "a sessão do outro aparelho precisa ser revogada");

        // E a senha nova é a que vale.
        const comNova = await api("POST", "/auth/login", { email, password: "NovaSenhaBoa789!" });
        assert.equal(comNova.status, 200);
        const comVelha = await api("POST", "/auth/login", { email, password: "SenhaSegura456!" });
        assert.equal(comVelha.status, 401, "a senha antiga não pode continuar valendo");

        await db.delete(usersTable).where(eq(usersTable.id, criado.userId));
        await db.delete(familiesTable).where(eq(familiesTable.id, criado.familyId));
      });

      it("sem autenticação, nenhuma das duas rotas responde", async () => {
        const semToken = await api("PATCH", "/account/me", { name: "Quem Quer Que Seja" });
        assert.equal(semToken.status, 401);
        const senhaSemToken = await api("POST", "/account/password", {
          currentPassword: "x",
          newPassword: "OutraSenhaBoa789!",
        });
        assert.equal(senhaSemToken.status, 401);
      });
    });

    describe("Recuperação de senha", () => {
      it("solicitação de reset retorna 200 mesmo para e-mail inexistente (antiEnumeração)", async () => {
        const res = await api("POST", "/auth/password-reset/request", {
          email: "naoexiste@zelo.test",
        });
        assert.equal(res.status, 200, "deve retornar 200 mesmo sem e-mail existente");
      });

      it("solicitação para e-mail existente cria código no banco", async () => {
        // Este caso terminava em `assert.ok(true)` — ele lia a tabela errada
        // (`email_verifications`, preenchida no cadastro) e depois afirmava
        // uma tautologia. Passava com a rota quebrada.
        //
        // A tabela certa é `password_resets`, e desde a Issue #102 ela guarda
        // o hash de um código de 6 dígitos.
        const antes = await db
          .select({ id: passwordResetsTable.id })
          .from(passwordResetsTable)
          .where(eq(passwordResetsTable.userId, userId));

        await api("POST", "/auth/password-reset/request", {
          email: "auth-test2@zelo.test",
        });

        const depois = await db
          .select({ id: passwordResetsTable.id })
          .from(passwordResetsTable)
          .where(eq(passwordResetsTable.userId, userId));

        assert.equal(
          depois.length,
          antes.length + 1,
          "o pedido precisa gravar um código de redefinição",
        );
      });
    });
  });
});
