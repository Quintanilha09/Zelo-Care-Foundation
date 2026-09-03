import { getAuth } from "../lib/auth-types.ts";
/**
 * Rotas de autenticação — ZELO.
 * POST /api/auth/register
 * POST /api/auth/verify-email
 * POST /api/auth/login
 * POST /api/auth/refresh
 * POST /api/auth/logout
 * POST /api/auth/logout-all
 * POST /api/auth/password-reset/request
 * POST /api/auth/password-reset/confirm
 *
 * SEGURANÇA:
 * - Nenhum log contém e-mail, senha ou token (allowlist do safeLog)
 * - Rate limiting em todos os endpoints sensíveis
 * - Token de refresh usa rotação com detecção de roubo de sessão
 * - Recuperação de senha retorna 200 mesmo se o e-mail não existir (antiEnumeração)
 */

import { Router } from "express";
import { z } from "zod";
import { eq, and, gt, gte, desc, count } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  usersTable,
  caregiversTable,
  caregiverInvitesTable,
  familiesTable,
  refreshTokensTable,
  emailVerificationsTable,
  passwordResetsTable,
  consentRecordsTable,
} from "@workspace/db";
import { hashPassword, verifyPassword, validatePasswordStrength } from "../lib/password";
import {
  generateAccessToken,
  generateRefreshToken,
  generateOneTimeToken,
  hashToken,
  decodeRefreshTokenUserId,
  revokeAccessToken,
  revokeAllAccessTokensForUser,
} from "../lib/tokens";
import { sendVerificationEmail, sendPasswordResetEmail, hasEmailProvider } from "../lib/email";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { requireAuth } from "../middleware/require-auth";
import {
  loginByIpLimiter,
  loginByEmailLimiter,
  registerLimiter,
  passwordResetLimiter,
  publicTokenLimiter,
  refreshLimiter,
  resendVerificationLimiter,
} from "../lib/rate-limit";
import { Clock } from "../lib/clock";
import { resolveActiveCaregiver } from "../lib/active-family.ts";
import { allowsDevelopmentShortcuts } from "../lib/environment.ts";
import {
  gerarCodigo,
  hashDoCodigo,
  conferirHash,
  normalizarCodigo,
  expiraEm,
  MAX_TENTATIVAS,
  MAX_CODIGOS_POR_HORA,
  inicioDaMedicao,
  esperarAtePiso,
} from "../lib/codigo-de-verificacao.ts";

const router = Router();

// ── CADASTRO ─────────────────────────────────────────────────────────────

const RegisterBody = z.object({
  name: z.string().min(2).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
  consentTerms: z.boolean(),          // aceite dos Termos de Uso
  consentHealthData: z.boolean(),     // aceite para tratamento de dados de saúde
  consentRepresentative: z.enum(["self", "legal_representative"]).optional(),
  familyName: z.string().min(2).max(100).optional(),
  // Quem chega por um link de convite entra na família de QUEM CONVIDOU —
  // sem isto, o cadastro criava uma família própria vazia por cima, e a
  // pessoa acabava entrando nela em vez de na família pra qual foi
  // convidada (ver lib/active-family.ts).
  inviteToken: z.string().min(1).optional(),
});

/**
 * Existe provedor de e-mail? Mesmo contrato de /auth/google/status.
 * A tela de cadastro usa isto para não oferecer um caminho que não conclui.
 */
router.get("/auth/email/status", (_req, res): void => {
  res.json({ configured: allowsDevelopmentShortcuts() || hasEmailProvider() });
});

router.post("/auth/register", registerLimiter, async (req, res): Promise<void> => {
  // Sem provedor de e-mail, cadastrar por e-mail e senha cria uma conta que
  // NUNCA poderá ser verificada: o login exige `emailVerified`, a
  // auto-verificação só roda em desenvolvimento, e o link nunca chega.
  // A pessoa ficava presa para sempre, sem sinal para ninguém.
  //
  // A recusa vem ANTES de qualquer escrita no banco — criar a conta e só
  // depois avisar deixaria um usuário órfão e um e-mail queimado, porque a
  // checagem de unicidade recusaria a segunda tentativa.
  if (!allowsDevelopmentShortcuts() && !hasEmailProvider()) {
    res.status(503).json({
      error: "O cadastro por e-mail e senha está indisponível no momento, porque não é possível enviar o e-mail de confirmação. Entre com o Google — é um toque, e a conta já vem confirmada.",
      code: "EMAIL_PROVIDER_UNAVAILABLE",
    });
    return;
  }

  const body = RegisterBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
  }

  if (!body.data.consentTerms) {
    res.status(400).json({ error: "É necessário aceitar os Termos de Uso para continuar" });
    return;
  }
  if (!body.data.consentHealthData) {
    res.status(400).json({ error: "É necessário consentir com o tratamento de dados de saúde" });
    return;
  }

  const strengthCheck = validatePasswordStrength(body.data.password);
  if (!strengthCheck.ok) {
    res.status(400).json({ error: strengthCheck.error });
    return;
  }

  // Verifica e-mail único
  const [existingUser] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, body.data.email.toLowerCase()))
    .limit(1);

  if (existingUser) {
    // ── Por que esta mensagem passou a ser clara — Issue #81 ─────────────
    //
    // Ela era genérica ("Não foi possível criar a conta com esses dados"), com
    // a justificativa de não confirmar que o e-mail existe. **A justificativa
    // não se sustentava**, e vale registrar o porquê para ninguém "consertar"
    // isto de volta:
    //
    // 1. Esta rota tem cinco respostas 400, e as outras quatro têm texto
    //    próprio (Zod, termos, consentimento de saúde, senha fraca). A
    //    mensagem genérica era **exclusiva** deste caso — não se confundia com
    //    nada. Quem sondasse com um corpo bem formado e senha forte lia
    //    exatamente "existe" naquele texto.
    //
    // 2. Mesmo com textos idênticos, **201 e 400 já se distinguem**. Cadastro
    //    ou cria a conta ou não cria; não há como esconder qual foi.
    //
    // Ou seja: custava clareza real e não comprava proteção nenhuma. Quem de
    // fato limita sondagem aqui é o `registerLimiter`, que continua no lugar.
    //
    // ATENÇÃO: isto NÃO vale para `/auth/password-reset/request`. Lá a resposta
    // é idêntica exista ou não a conta, e a generalidade funciona de verdade.
    res.status(400).json({
      error: "Este e-mail já tem uma conta no ZELO. Entre com ele, ou use “Recuperar” se esqueceu a senha.",
      code: "EMAIL_JA_CADASTRADO",
    });
    return;
  }

  const passwordHash = await hashPassword(body.data.password);
  const ip = req.ip ?? "unknown";

  // Convite válido = a pessoa entra na família de quem convidou, e NÃO
  // ganha uma família própria. Convite inválido/expirado não bloqueia o
  // cadastro (a conta é legítima de qualquer forma) — só cai no caminho
  // normal de criar a própria família.
  const invite = body.data.inviteToken
    ? (
        await db
          .select()
          .from(caregiverInvitesTable)
          .where(
            and(
              eq(caregiverInvitesTable.tokenHash, hashToken(body.data.inviteToken)),
              eq(caregiverInvitesTable.used, false),
              eq(caregiverInvitesTable.status, "pending"),
              gt(caregiverInvitesTable.expiresAt, Clock.now())
            )
          )
          .limit(1)
      )[0]
    : undefined;

  // Tudo em uma transação: usuário + família + cuidador + consentimentos
  const { userId, familyId, caregiverId } = await db.transaction(async (tx) => {
    // 1. Criar usuário
    const [newUser] = await tx
      .insert(usersTable)
      .values({
        email: body.data.email.toLowerCase(),
        name: body.data.name,
        passwordHash,
        emailVerified: false,
        status: "pending_verification",
      })
      .returning({ id: usersTable.id });

    // 2. Família: a do convite, quando veio por convite; senão, uma nova.
    let targetFamilyId: number;
    if (invite) {
      targetFamilyId = invite.familyId;
      await tx
        .update(caregiverInvitesTable)
        .set({ used: true, usedAt: Clock.now(), usedByUserId: newUser.id, status: "accepted" })
        .where(eq(caregiverInvitesTable.id, invite.id));
    } else {
      const familyName = body.data.familyName ?? `Família de ${body.data.name}`;
      const slug = familyName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .slice(0, 50) + `-${Date.now()}`; // clock-lint-ok: sufixo de unicidade do slug, nao e tempo de dominio
      const [newFamily] = await tx
        .insert(familiesTable)
        .values({ name: familyName, slug })
        .returning({ id: familiesTable.id });
      targetFamilyId = newFamily.id;
    }

    // 3. Criar cuidador vinculado ao usuário — com o papel do convite quando
    // houver: quem foi convidada como cuidadora contratada não vira dona da
    // família de quem convidou.
    const [newCaregiver] = await tx
      .insert(caregiversTable)
      .values({
        familyId: targetFamilyId,
        userId: newUser.id,
        name: body.data.name,
        email: body.data.email.toLowerCase(),
        role: invite ? invite.role : "primary_caregiver",
      })
      .returning({ id: caregiversTable.id });

    // A família da sessão já nasce resolvida (ver lib/active-family.ts).
    await tx.update(usersTable).set({ activeFamilyId: targetFamilyId }).where(eq(usersTable.id, newUser.id));

    // 4. Registrar consentimento dos Termos de Uso
    await tx.insert(consentRecordsTable).values({
      userId: newUser.id,
      consentType: "terms_of_service",
      consentGiven: "true",
      version: "v1.0",
      ipAddress: ip,
      userAgent: req.headers["user-agent"] ?? "",
    });

    // 5. Registrar consentimento de dados de saúde
    await tx.insert(consentRecordsTable).values({
      userId: newUser.id,
      consentType: "health_data_processing",
      consentGiven: "true",
      version: "v1.0",
      ipAddress: ip,
      userAgent: req.headers["user-agent"] ?? "",
      // Quem está consentindo: o titular ou um representante legal
    });

    return { userId: newUser.id, familyId: targetFamilyId, caregiverId: newCaregiver.id };
  });

  // 6. Código de verificação de e-mail — Issue #77, era token de 64 hex num
  //    link e passou a ser 6 dígitos digitados na tela.
  const codigo = gerarCodigo();
  await db.insert(emailVerificationsTable).values({
    userId,
    tokenHash: hashDoCodigo(userId, codigo),
    expiresAt: expiraEm(Clock.now()),
  });

  // O envio pode falhar sem lançar (ver lib/email.ts: falha de envio virando
  // exceção transformaria a recuperação de senha num oráculo de enumeração).
  // Então a resposta precisa dizer a verdade em vez de prometer um e-mail que
  // não saiu — quem ficou sem código não tem como pedir outro hoje (Issue #75).
  let enviado = true;

  if (allowsDevelopmentShortcuts()) {
    // ── DEV ONLY: auto-verificação imediata ──────────────────────────────
    // Em produção este bloco não existe — o usuário DEVE digitar o código.
    // Em desenvolvimento não há provedor de e-mail real, então a conta é ativada
    // aqui mesmo e o código fica na tabela para uso manual se necessário.
    await db.transaction(async (tx) => {
      await tx.update(emailVerificationsTable)
        .set({ used: true, usedAt: Clock.now() })
        .where(eq(emailVerificationsTable.userId, userId));
      await tx.update(usersTable)
        .set({ emailVerified: true, status: "active" })
        .where(eq(usersTable.id, userId));
    });
    // O código NÃO vai pro log, nem em desenvolvimento: `safeLog` sanitiza o
    // CONTEXTO (1º argumento) mas não a MENSAGEM (2º), então interpolar um
    // segredo aqui contornava a proteção inteira. Quem precisar do código pra
    // testar o fluxo manual consulta a tabela email_verifications.
    safeLog.info(
      { action: "dev_auto_verify", familyId },
      "[DEV] Conta auto-verificada — codigo disponivel em email_verifications, se precisar testar o fluxo manual",
    );
  } else {
    // ── PRODUÇÃO: envio real de e-mail ───────────────────────────────────
    enviado = await sendVerificationEmail(body.data.email, codigo);
  }

  safeLog.info({ action: "register", userId, familyId, caregiverId }, "Novo usuário cadastrado");
  await audit({ familyId, entityType: "user", entityId: String(userId), action: "created", actorType: "system", ipAddress: ip });

  // `precisaDeCodigo` é o que a tela usa para decidir se leva a pessoa à tela
  // do código ou direto ao login — em vez de adivinhar pelo texto da mensagem.
  if (allowsDevelopmentShortcuts()) {
    res.status(201).json({
      // "Conta ativada automaticamente" não diz nada a quem não sabe o que é
      // ambiente de desenvolvimento — e ninguém deveria precisar saber para
      // entender uma tela (Issue #81).
      message: "Conta criada e já confirmada. Você já pode entrar com seu e-mail e senha.",
      precisaDeCodigo: false,
    });
    return;
  }

  if (!enviado) {
    // A conta existe e o e-mail está queimado pela unicidade: mandar "verifique
    // sua caixa" seria mentira, e a pessoa ficaria esperando para sempre.
    res.status(201).json({
      message:
        "Conta criada, mas não conseguimos enviar o código de confirmação agora. Entre com o Google, que já vem confirmado, ou fale com o suporte.",
      precisaDeCodigo: false,
      envioFalhou: true,
    });
    return;
  }

  res.status(201).json({
    message: "Conta criada. Enviamos um código de 6 dígitos para o seu e-mail.",
    precisaDeCodigo: true,
  });
});

// ── VERIFICAÇÃO DE E-MAIL ─────────────────────────────────────────────────

/**
 * Confirma a conta com o código de 6 dígitos — Issue #77.
 *
 * ── Uma resposta só para tudo que dá errado ───────────────────────────────
 *
 * Código errado, código expirado, código já usado, tentativas esgotadas e
 * e-mail que não existe respondem **a mesma coisa**. Distinguir qualquer um
 * deles entrega informação de graça: "este e-mail existe aqui" é o começo de
 * qualquer ataque dirigido, e num app de saúde a própria existência da conta
 * já é informação sensível.
 *
 * ── O limite de tentativas é a defesa, não o tamanho do código ────────────
 *
 * Seis dígitos são um milhão de combinações — minutos para uma máquina. Cinco
 * tentativas por código deixam a chance em 1 para 200.000. Ver a conta inteira
 * em `lib/codigo-de-verificacao.ts`.
 */
const RECUSA_GENERICA = "Código inválido ou expirado. Peça um código novo.";

/**
 * Resposta única do reenvio — Issue #75.
 *
 * A mesma para conta que existe, conta que não existe, conta já confirmada e
 * conta que estourou o teto de emissão. Se o teto tivesse recado próprio, ele
 * mesmo viraria o oráculo que a resposta genérica existe para fechar: "esta
 * conta existe, está pendente, e alguém andou pedindo código".
 */
const RESPOSTA_DO_REENVIO =
  "Se houver uma conta pendente com esse e-mail, enviamos um código novo. Confira sua caixa de entrada e o spam.";

router.post("/auth/verify-email", publicTokenLimiter, async (req, res): Promise<void> => {
  // Issue #84: toda resposta desta rota sai depois do mesmo tempo mínimo. Sem
  // isso, conta inexistente respondia mais rápido que conta existente — e o
  // relógio contava o que o corpo da resposta calava.
  const inicio = inicioDaMedicao();
  const recusar = async (): Promise<void> => {
    await esperarAtePiso(inicio);
    res.status(400).json({ error: RECUSA_GENERICA });
  };

  const email = String(req.body?.email ?? "").toLowerCase().trim();
  const codigo = normalizarCodigo(req.body?.codigo);

  if (!email || !codigo) {
    await recusar();
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  // Conta inexistente sai pela mesma porta que código errado.
  if (!user) {
    await recusar();
    return;
  }

  const [record] = await db
    .select()
    .from(emailVerificationsTable)
    .where(
      and(
        eq(emailVerificationsTable.userId, user.id),
        eq(emailVerificationsTable.used, false),
        gt(emailVerificationsTable.expiresAt, Clock.now())
      )
    )
    .orderBy(desc(emailVerificationsTable.id))
    .limit(1);

  if (!record || record.attempts >= MAX_TENTATIVAS) {
    await recusar();
    return;
  }

  if (!conferirHash(record.tokenHash, hashDoCodigo(user.id, codigo))) {
    // Gravar o erro é o que torna a força bruta inviável. Sem este UPDATE, o
    // resto desta rota é decoração.
    await db
      .update(emailVerificationsTable)
      .set({ attempts: record.attempts + 1 })
      .where(eq(emailVerificationsTable.id, record.id));

    safeLog.warn(
      { action: "verify_email_codigo_errado", outcome: String(record.attempts + 1) },
      "Codigo de verificacao incorreto",
    );
    await recusar();
    return;
  }

  await db.transaction(async (tx) => {
    await tx.update(emailVerificationsTable)
      .set({ used: true, usedAt: Clock.now() })
      .where(eq(emailVerificationsTable.id, record.id));
    await tx.update(usersTable)
      .set({ emailVerified: true, status: "active" })
      .where(eq(usersTable.id, record.userId));
  });

  safeLog.info({ action: "verify_email_ok" }, "Conta confirmada por codigo");
  await esperarAtePiso(inicio);
  res.json({ message: "E-mail confirmado. Faça login para continuar." });
});

/**
 * Reenviar o código de confirmação — Issue #75.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTA ROTA DEVOLVE TENTATIVAS AO ATACANTE. O TETO DE EMISSÃO ABAIXO NÃO É
 * ACABAMENTO — É O QUE IMPEDE O REENVIO DE VIRAR MÁQUINA DE ADIVINHAR.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Antes desta rota existir, o sistema tinha **um** código por conta, para
 * sempre: cinco tentativas e acabou, 1 chance em 200.000. Essa robustez era
 * acidental — vinha justamente da falta de um jeito de pedir outro código.
 *
 * Cada reenvio devolve cinco palpites. Sem teto, o número acima deixa de valer
 * e o limite passa a ser a paciência de quem ataca. Com o teto por conta:
 *
 *   5 códigos/hora × 5 tentativas = 25 palpites/hora em 1.000.000
 *
 * ── Por que a rota existe, apesar disso ───────────────────────────────────
 *
 * Sem ela, cinco erros de digitação **trancavam a pessoa para sempre**: o
 * e-mail fica queimado pela checagem de unicidade, e não havia como pedir outro
 * código. Num app de medicamento de idoso, cuidador trancado do lado de fora é
 * problema de segurança do paciente, não de conveniência.
 *
 * ── Uma resposta só, sempre ───────────────────────────────────────────────
 *
 * Existe, não existe, já confirmada, teto estourado: a mesma frase, o mesmo
 * status, o mesmo tempo. Ver `RESPOSTA_DO_REENVIO`.
 */
router.post("/auth/verify-email/resend", resendVerificationLimiter, async (req, res): Promise<void> => {
  const inicio = inicioDaMedicao();
  const responder = async (): Promise<void> => {
    await esperarAtePiso(inicio);
    res.json({ message: RESPOSTA_DO_REENVIO });
  };

  const email = String(req.body?.email ?? "").toLowerCase().trim();
  if (!email) {
    await responder();
    return;
  }

  // Sem provedor não há o que enviar. Responde igual mesmo assim: quem está
  // sondando não precisa saber que o envio está fora do ar.
  if (!allowsDevelopmentShortcuts() && !hasEmailProvider()) {
    await responder();
    return;
  }

  const [user] = await db
    .select({ id: usersTable.id, emailVerified: usersTable.emailVerified })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  // Conta inexistente e conta já confirmada saem pela mesma porta. A segunda
  // importa tanto quanto a primeira: reenviar código para conta confirmada não
  // faz sentido, e responder diferente entregaria o estado dela.
  if (!user || user.emailVerified) {
    await responder();
    return;
  }

  const umaHoraAtras = new Date(Clock.now().getTime() - 60 * 60 * 1000);
  const [emitidos] = await db
    .select({ total: count() })
    .from(emailVerificationsTable)
    .where(
      and(
        eq(emailVerificationsTable.userId, user.id),
        gte(emailVerificationsTable.createdAt, umaHoraAtras)
      )
    );

  if ((emitidos?.total ?? 0) >= MAX_CODIGOS_POR_HORA) {
    safeLog.warn(
      { action: "reenvio_acima_do_teto", outcome: String(emitidos?.total ?? 0) },
      "Teto de emissao de codigo atingido para uma conta",
    );
    await responder();
    return;
  }

  const codigo = gerarCodigo();
  await db.transaction(async (tx) => {
    // Aposenta os anteriores ANTES de emitir. Cada código vivo é mais cinco
    // tentativas oferecidas — deixar dois valendo dobraria a janela de graça.
    await tx
      .update(emailVerificationsTable)
      .set({ used: true, usedAt: Clock.now() })
      .where(
        and(
          eq(emailVerificationsTable.userId, user.id),
          eq(emailVerificationsTable.used, false)
        )
      );
    await tx.insert(emailVerificationsTable).values({
      userId: user.id,
      tokenHash: hashDoCodigo(user.id, codigo),
      expiresAt: expiraEm(Clock.now()),
    });
  });

  await sendVerificationEmail(email, codigo);

  safeLog.info({ action: "reenvio_de_codigo" }, "Codigo de confirmacao reenviado");
  await responder();
});

// ── LOGIN ────────────────────────────────────────────────────────────────

const LoginBody = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

router.post("/auth/login", loginByIpLimiter, loginByEmailLimiter, async (req, res): Promise<void> => {
  const body = LoginBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: "E-mail e senha são obrigatórios" });
    return;
  }

  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.email, body.data.email.toLowerCase()))
    .limit(1);

  // Conta criada via Google OAuth não tem senha — bloqueia antes de chamar verifyPassword
  if (user?.passwordHash === "!") {
    res.status(401).json({ error: "Esta conta usa login com Google. Clique em 'Entrar com Google'." });
    return;
  }

  // Timing-safe: mesmo que o usuário não exista, executa o verify para evitar timing attack
  const dummyHash = "$argon2id$v=19$m=65536,t=3,p=1$dummysalt1234567$dummyhash123456789012345678901234";
  const passwordOk = user?.passwordHash
    ? await verifyPassword(user.passwordHash, body.data.password)
    : await verifyPassword(dummyHash, body.data.password).then(() => false);

  if (!user || !passwordOk) {
    res.status(401).json({ error: "E-mail ou senha incorretos" });
    return;
  }

  if (!user.emailVerified) {
    res.status(403).json({ error: "Verifique seu e-mail antes de fazer login" });
    return;
  }

  if (user.status !== "active") {
    res.status(403).json({ error: "Conta suspensa ou inativa" });
    return;
  }

  // Com qual família a sessão abre — nunca "a primeira que vier", que é
  // indeterminado pra quem é cuidador em mais de uma (ver lib/active-family.ts).
  const caregiver = await resolveActiveCaregiver(user.id);

  if (!caregiver) {
    res.status(500).json({ error: "Conta sem vínculo familiar. Contate o suporte." });
    return;
  }

  const accessToken = generateAccessToken(user.id, caregiver.familyId, caregiver.id, caregiver.role);
  const { raw: refreshRaw, hash: refreshHash } = generateRefreshToken(user.id);

  const REFRESH_TTL_DAYS = 30;
  await db.insert(refreshTokensTable).values({
    userId: user.id,
    tokenHash: refreshHash,
    userAgent: req.headers["user-agent"] ?? null,
    ipAddress: req.ip ?? null,
    expiresAt: new Date(Clock.now().getTime() + REFRESH_TTL_DAYS * 24 * 60 * 60 * 1000),
  });

  safeLog.info({ action: "login", userId: user.id, caregiverId: caregiver.id }, "Login realizado");
  await audit({
    familyId: caregiver.familyId,
    entityType: "session",
    entityId: String(user.id),
    action: "created",
    actorId: String(caregiver.id),
    actorType: "caregiver",
    ipAddress: req.ip ?? undefined,
  });

  res.json({ accessToken, refreshToken: refreshRaw, expiresIn: 900 });
});

// ── RENOVAÇÃO DE TOKEN ────────────────────────────────────────────────────

router.post("/auth/refresh", refreshLimiter, async (req, res): Promise<void> => {
  const raw = String(req.body?.refreshToken ?? "");
  if (!raw) { res.status(401).json({ error: "Token de renovação obrigatório" }); return; }

  const tokenHash = hashToken(raw);

  const [existing] = await db
    .select()
    .from(refreshTokensTable)
    .where(
      and(
        eq(refreshTokensTable.tokenHash, tokenHash),
        eq(refreshTokensTable.revoked, false),
        gt(refreshTokensTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!existing) {
    // Token não encontrado como ativo: pode ter sido rotacionado (roubo de sessão)
    const stolenUserId = decodeRefreshTokenUserId(raw);
    if (stolenUserId !== null) {
      // SINAL DE ROUBO DE SESSÃO — revogar TODOS os tokens deste usuário
      await db.update(refreshTokensTable)
        .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "theft_detected" })
        .where(and(eq(refreshTokensTable.userId, stolenUserId), eq(refreshTokensTable.revoked, false)));
      revokeAllAccessTokensForUser(stolenUserId);
      safeLog.warn({ action: "theft_detected", userId: stolenUserId }, "Roubo de sessão detectado — todos os tokens revogados");
    }
    res.status(401).json({ error: "Sessão inválida. Faça login novamente." });
    return;
  }

  // Mesma resolução do login — o refresh acontece a cada 15min e não pode
  // trocar a família debaixo do usuário nem desfazer uma troca explícita.
  const caregiver = await resolveActiveCaregiver(existing.userId);

  if (!caregiver) {
    res.status(401).json({ error: "Sessão inválida" });
    return;
  }

  // Rotação: invalida o token antigo e gera um novo par
  const { raw: newRefreshRaw, hash: newRefreshHash } = generateRefreshToken(existing.userId);
  const newAccessToken = generateAccessToken(existing.userId, caregiver.familyId, caregiver.id, caregiver.role);

  await db.transaction(async (tx) => {
    await tx.update(refreshTokensTable)
      .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "rotated" })
      .where(eq(refreshTokensTable.id, existing.id));
    await tx.insert(refreshTokensTable).values({
      userId: existing.userId,
      tokenHash: newRefreshHash,
      userAgent: req.headers["user-agent"] ?? null,
      ipAddress: req.ip ?? null,
      expiresAt: new Date(Clock.now().getTime() + 30 * 24 * 60 * 60 * 1000),
    });
  });

  res.json({ accessToken: newAccessToken, refreshToken: newRefreshRaw, expiresIn: 900 });
});

// ── LOGOUT ───────────────────────────────────────────────────────────────

router.post("/auth/logout", requireAuth, async (req, res): Promise<void> => {
  const raw = String(req.body?.refreshToken ?? "");

  if (raw) {
    const tokenHash = hashToken(raw);
    await db.update(refreshTokensTable)
      .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "user_logout" })
      .where(
        and(
          eq(refreshTokensTable.tokenHash, tokenHash),
          eq(refreshTokensTable.userId, getAuth(req).userId)
        )
      );
  }

  // Revoga o access token atual via blacklist em memória
  revokeAccessToken(getAuth(req).jti);
  res.status(204).send();
});

// ── LOGOUT DE TODOS OS DISPOSITIVOS ──────────────────────────────────────

router.post("/auth/logout-all", requireAuth, async (req, res): Promise<void> => {
  await db.update(refreshTokensTable)
    .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "logout_all" })
    .where(
      and(
        eq(refreshTokensTable.userId, getAuth(req).userId),
        eq(refreshTokensTable.revoked, false)
      )
    );
  revokeAllAccessTokensForUser(getAuth(req).userId);

  safeLog.info({ action: "logout_all", userId: getAuth(req).userId }, "Logout de todos os dispositivos");
  await audit({
    familyId: getAuth(req).familyId,
    entityType: "session",
    entityId: String(getAuth(req).userId),
    action: "deleted",
    actorId: String(getAuth(req).caregiverId),
    actorType: "caregiver",
  });

  res.status(204).send();
});

// ── RECUPERAÇÃO DE SENHA — SOLICITAÇÃO ──────────────────────────────────

router.post("/auth/password-reset/request", passwordResetLimiter, async (req, res): Promise<void> => {
  // Mesmo motivo do cadastro: sem provedor, o link nunca chega, e a resposta
  // genérica de sempre ("se existir conta, enviamos") viraria mentira.
  if (!allowsDevelopmentShortcuts() && !hasEmailProvider()) {
    res.status(503).json({
      error: "Não é possível enviar o e-mail de recuperação no momento. Se você criou a conta com o Google, entre por lá — não há senha para recuperar.",
      code: "EMAIL_PROVIDER_UNAVAILABLE",
    });
    return;
  }

  const email = String(req.body?.email ?? "").toLowerCase();

  // Sempre retorna 200 — nunca confirma se o e-mail existe (antiEnumeração)
  const [user] = await db
    .select({ id: usersTable.id })
    .from(usersTable)
    .where(eq(usersTable.email, email))
    .limit(1);

  if (user) {
    const { raw, hash } = generateOneTimeToken();
    await db.insert(passwordResetsTable).values({
      userId: user.id,
      tokenHash: hash,
      expiresAt: new Date(Clock.now().getTime() + 60 * 60 * 1000), // 1 hora
      requestIp: req.ip ?? null,
    });
    await sendPasswordResetEmail(email, raw);
  }

  res.json({ message: "Se esse e-mail estiver cadastrado, você receberá um link de recuperação." });
});

// ── RECUPERAÇÃO DE SENHA — CONFIRMAÇÃO ───────────────────────────────────

const ResetConfirmBody = z.object({
  token: z.string().min(1),
  newPassword: z.string().min(8).max(128),
});

router.post("/auth/password-reset/confirm", publicTokenLimiter, async (req, res): Promise<void> => {
  const body = ResetConfirmBody.safeParse(req.body);
  if (!body.success) { res.status(400).json({ error: "Token e nova senha são obrigatórios" }); return; }

  const strengthCheck = validatePasswordStrength(body.data.newPassword);
  if (!strengthCheck.ok) { res.status(400).json({ error: strengthCheck.error }); return; }

  const tokenHash = hashToken(body.data.token);
  const [record] = await db
    .select()
    .from(passwordResetsTable)
    .where(
      and(
        eq(passwordResetsTable.tokenHash, tokenHash),
        eq(passwordResetsTable.used, false),
        gt(passwordResetsTable.expiresAt, Clock.now())
      )
    )
    .limit(1);

  if (!record) { res.status(400).json({ error: "Link inválido ou expirado" }); return; }

  const newHash = await hashPassword(body.data.newPassword);

  await db.transaction(async (tx) => {
    await tx.update(usersTable).set({ passwordHash: newHash }).where(eq(usersTable.id, record.userId));
    await tx.update(passwordResetsTable)
      .set({ used: true, usedAt: Clock.now() })
      .where(eq(passwordResetsTable.id, record.id));
    // Força logout em todos os dispositivos após troca de senha
    await tx.update(refreshTokensTable)
      .set({ revoked: true, revokedAt: Clock.now(), revokedReason: "password_changed" })
      .where(and(eq(refreshTokensTable.userId, record.userId), eq(refreshTokensTable.revoked, false)));
  });
  revokeAllAccessTokensForUser(record.userId);

  res.json({ message: "Senha alterada. Faça login novamente em todos os dispositivos." });
});

export default router;
