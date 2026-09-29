/**
 * Dados de semente — ZELO
 *
 * AVISO: Todo dado aqui é EXPLICITAMENTE FICTÍCIO.
 * - Família fictícia marcada como "Teste"
 * - Paciente: "Dona Maria Teste" — nome inventado
 * - Medicamentos com nomes inventados que não parecem remédios reais
 * - Nunca usar nomes de medicamentos reais, CIDs, ou dados clínicos reais
 *
 * IDEMPOTENTE: rodar duas vezes não duplica nada.
 * A verificação usa o slug único da família de demonstração.
 *
 * Executar: pnpm --filter @workspace/api-server run seed
 */

import { db } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  familiesTable,
  patientsTable,
  caregiversTable,
  medicationsTable,
  treatmentsTable,
  scheduledDosesTable,
  appointmentsTable,
  subscriptionsTable,
  notificationsTable,
  usersTable,
} from "@workspace/db";
import { IS_PRODUCTION } from "./lib/environment.ts";
import { hashPassword } from "./lib/password";

const SEED_FAMILY_SLUG = "familia-ficticia-teste";

/**
 * A conta que abre esta família — Issue #221.
 *
 * Até aqui a semente criava família, paciente, cuidadores e doses, e **nenhuma
 * conta**. Ninguém conseguia entrar para ver nada disso: o fundador tinha de se
 * cadastrar pelo app e recriar tudo à mão, toda vez que o banco era recriado.
 *
 * O endereço é `@zelo.test` de propósito. O TLD `.test` é reservado pela
 * RFC 2606 e nunca resolve na internet — se esta conta escapar para algum lugar
 * onde e-mail sai de verdade, nada é entregue a ninguém.
 */
const CONTA_DA_SEMENTE = {
  email: "joao.teste@zelo.test",
  senha: "zelo-local-123",
};

async function seed() {
  // ═══════════════════════════════════════════════════════════════════════
  // PRODUÇÃO, NUNCA — Issue #221.
  //
  // Esta semente cria uma conta com SENHA CONHECIDA, escrita logo acima em
  // texto puro. Num banco de produção isso não é dado de demonstração: é uma
  // porta dos fundos, publicada no repositório.
  //
  // A guarda não existia antes da #221, e até então o pior caso era dado
  // fictício num banco real — chato, não perigoso. Com a conta, passou a ser.
  //
  // `IS_PRODUCTION` e não `NODE_ENV !== "production"`: a AUSÊNCIA de NODE_ENV
  // é produção neste código (ver lib/environment.ts). A forma ingênua deixaria
  // a semente rodar justamente no ambiente mal configurado, que é o mais
  // perigoso de todos.
  // ═══════════════════════════════════════════════════════════════════════
  if (IS_PRODUCTION) {
    console.error("✗ Recusado: a semente cria uma conta de senha conhecida e não roda em produção.");
    console.error("  Se este ambiente não é produção, defina NODE_ENV=development.");
    process.exit(1);
  }

  console.log("🌱 Iniciando seed de dados fictícios...");

  // Verificação de idempotência: usa o slug único da família de demonstração.
  // Se a família já existe, o seed foi executado antes — encerra sem duplicar.
  const [existing] = await db
    .select({ id: familiesTable.id, name: familiesTable.name })
    .from(familiesTable)
    .where(eq(familiesTable.slug, SEED_FAMILY_SLUG))
    .limit(1);

  if (existing) {
    console.log(`⚠️  Seed já executado (família id=${existing.id} existe). Nada a fazer.`);
    console.log("   Para re-sedar: DELETE FROM families WHERE slug = 'familia-ficticia-teste' CASCADE");
    return;
  }

  // ── Família fictícia ─────────────────────────────────────────────────────
  const [family] = await db
    .insert(familiesTable)
    .values({ name: "Família Fictícia Teste", slug: SEED_FAMILY_SLUG })
    .returning();

  console.log(`✓ Família criada: "${family.name}" (id=${family.id})`);

  // ── Paciente fictício ────────────────────────────────────────────────────
  const [patient] = await db
    .insert(patientsTable)
    .values({
      familyId: family.id,
      name: "Dona Maria Teste",
      birthDate: "1947-03-15",
      timezone: "America/Sao_Paulo",
      notes: "DADO FICTÍCIO — apenas para demonstração do sistema",
    })
    .returning();

  console.log(`✓ Paciente fictício: "${patient.name}"`);

  // ── Cuidadores fictícios ─────────────────────────────────────────────────
  const [caregiver1] = await db
    .insert(caregiversTable)
    .values({
      familyId: family.id,
      name: "João Teste",
      email: CONTA_DA_SEMENTE.email,
      role: "primary_caregiver",
    })
    .returning();

  const [caregiver2] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, name: "Ana Teste", role: "observer" })
    .returning();

  console.log(`✓ Cuidadores: "${caregiver1.name}" (principal), "${caregiver2.name}" (observadora)`);

  // ── A conta que entra como o João ────────────────────────────────────────
  //
  // Os três campos abaixo espelham o que `POST /api/auth/register` grava
  // quando a conta termina de se verificar (`auth.ts`, rotas de confirmação):
  // `emailVerified: true` e `status: "active"`. O login exige os dois — conta
  // criada sem eles existe e não entra, e o sintoma seria uma senha
  // "errada" que na verdade está certa.
  //
  // `activeFamilyId` também não é opcional: é ele que resolve em qual família
  // a sessão começa (ver lib/active-family.ts). Sem ele a tela abre vazia.
  const [user] = await db
    .insert(usersTable)
    .values({
      email: CONTA_DA_SEMENTE.email,
      name: "João Teste",
      passwordHash: await hashPassword(CONTA_DA_SEMENTE.senha),
      emailVerified: true,
      status: "active",
      activeFamilyId: family.id,
    })
    .returning();

  await db
    .update(caregiversTable)
    .set({ userId: user.id })
    .where(eq(caregiversTable.id, caregiver1.id));

  console.log(`✓ Conta de acesso: ${CONTA_DA_SEMENTE.email} / ${CONTA_DA_SEMENTE.senha}`);

  // ── Medicamentos fictícios ───────────────────────────────────────────────
  const [med1] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Cardiolex 25mg (fictício)", activeIngredient: "Principioactivus fictus", form: "tablet", strength: "25mg" })
    .returning();

  const [med2] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Prexoral 10mg (fictício)", activeIngredient: "Activus prexoralis fictus", form: "tablet", strength: "10mg" })
    .returning();

  const [med3] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Vitazan B (fictício)", form: "capsule", strength: "500mcg" })
    .returning();

  console.log(`✓ Medicamentos: "${med1.name}", "${med2.name}", "${med3.name}"`);

  // ── Tratamentos fictícios ────────────────────────────────────────────────
  const [t1] = await db.insert(treatmentsTable).values({
    patientId: patient.id, medicationId: med1.id, dose: "1 comprimido",
    scheduleType: "times_per_day", scheduleConfig: { timesPerDay: 1, times: ["08:00"] },
    startDate: "2025-01-01", instructions: "Tomar em jejum (fictício)",
  }).returning();

  const [t2] = await db.insert(treatmentsTable).values({
    patientId: patient.id, medicationId: med2.id, dose: "1 comprimido",
    scheduleType: "times_per_day", scheduleConfig: { timesPerDay: 2, times: ["08:00", "20:00"] },
    startDate: "2025-01-01",
  }).returning();

  const [t3] = await db.insert(treatmentsTable).values({
    patientId: patient.id, medicationId: med3.id, dose: "1 cápsula",
    scheduleType: "times_per_day", scheduleConfig: { timesPerDay: 1, times: ["12:00"] },
    startDate: "2025-01-01",
  }).returning();

  console.log(`✓ Tratamentos criados (ids: ${t1.id}, ${t2.id}, ${t3.id})`);

  // ── Doses agendadas para hoje ─────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);
  const doses = [
    { treatmentId: t1.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T11:00:00.000Z`), scheduledLocalDate: todayStr, scheduledLocalTime: "08:00", status: "taken" as const },
    { treatmentId: t2.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T11:00:00.000Z`), scheduledLocalDate: todayStr, scheduledLocalTime: "08:00", status: "taken" as const },
    { treatmentId: t2.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T23:00:00.000Z`), scheduledLocalDate: todayStr, scheduledLocalTime: "20:00", status: "pending" as const },
    { treatmentId: t3.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T15:00:00.000Z`), scheduledLocalDate: todayStr, scheduledLocalTime: "12:00", status: "pending" as const },
  ];
  for (const dose of doses) await db.insert(scheduledDosesTable).values(dose);
  console.log(`✓ ${doses.length} doses agendadas (2 tomadas ✓, 2 pendentes ○)`);

  // ── Consulta, assinatura e notificação ───────────────────────────────────
  await db.insert(appointmentsTable).values({
    patientId: patient.id, specialty: "Cardiologia (fictício)",
    doctorName: "Dr. Fictício da Silva", location: "Clínica Fictícia Teste",
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    notes: "Retorno — dado fictício",
  });

  await db.insert(subscriptionsTable).values({ familyId: family.id, plan: "free", status: "trialing" });

  await db.insert(notificationsTable).values({
    familyId: family.id, type: "system",
    title: "Bem-vindo ao ZELO (demonstração)",
    body: "Dado fictício de demonstração.",
    sentAt: new Date(),
  });

  console.log("\n✅  Seed completo!");
  console.log(`   Família: "${family.name}"`);
  console.log(`   Paciente: "${patient.name}" (FICTÍCIO)`);
  console.log(`   Medicamentos: Cardiolex, Prexoral, Vitazan B (todos fictícios)`);
  console.log(`   Doses hoje: 2 tomadas ✓, 2 pendentes ○`);
}

seed().catch((err) => {
  console.error("Erro no seed:", err);
  process.exit(1);
});
