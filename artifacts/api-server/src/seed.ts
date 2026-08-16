/**
 * Dados de semente — ZELO
 *
 * AVISO: Todo dado aqui é EXPLICITAMENTE FICTÍCIO.
 * - Família fictícia marcada como "Teste"
 * - Paciente: "Dona Maria Teste" — nome inventado, jamais confundir com dado clínico real
 * - Medicamentos com nomes inventados que não parecem remédios reais
 * - Nunca usar nomes de medicamentos reais, CIDs, ou dados clínicos reais aqui
 *
 * Executar: pnpm --filter @workspace/api-server run seed
 */

import { db } from "@workspace/db";
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
} from "@workspace/db";

async function seed() {
  console.log("🌱 Iniciando seed de dados fictícios...");

  // ── Família fictícia ─────────────────────────────────────────────────────
  const existing = await db.select().from(familiesTable).limit(1);
  if (existing.length > 0) {
    console.log("⚠️  Dados já existem, pulando seed.");
    return;
  }

  const [family] = await db
    .insert(familiesTable)
    .values({
      name: "Família Fictícia Teste",
      slug: "familia-ficticia-teste",
    })
    .returning();

  console.log(`✓ Família criada: "${family.name}" (id=${family.id})`);

  // ── Paciente fictício ────────────────────────────────────────────────────
  const [patient] = await db
    .insert(patientsTable)
    .values({
      familyId: family.id,
      name: "Dona Maria Teste",  // Nome explicitamente fictício
      birthDate: "1947-03-15",
      timezone: "America/Sao_Paulo",
      notes: "DADO FICTÍCIO — apenas para demonstração do sistema",
    })
    .returning();

  console.log(`✓ Paciente fictício criado: "${patient.name}"`);

  // ── Cuidadores fictícios ─────────────────────────────────────────────────
  const [caregiver1] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, name: "João Teste", role: "primary_caregiver" })
    .returning();

  const [caregiver2] = await db
    .insert(caregiversTable)
    .values({ familyId: family.id, name: "Ana Teste", role: "observer" })
    .returning();

  console.log(`✓ Cuidadores fictícios: "${caregiver1.name}" (principal), "${caregiver2.name}" (observadora)`);

  // ── Medicamentos fictícios — nomes inventados ────────────────────────────
  const [med1] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Cardiolex 25mg (fictício)", activeIngredient: "Principioativus fictus", form: "tablet", strength: "25mg" })
    .returning();

  const [med2] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Prexoral 10mg (fictício)", activeIngredient: "Activus prexoralis fictus", form: "tablet", strength: "10mg" })
    .returning();

  const [med3] = await db
    .insert(medicationsTable)
    .values({ familyId: family.id, name: "Vitazan B (fictício)", form: "capsule", strength: "500mcg" })
    .returning();

  console.log(`✓ Medicamentos fictícios: "${med1.name}", "${med2.name}", "${med3.name}"`);

  // ── Tratamentos fictícios ────────────────────────────────────────────────
  const [treatment1] = await db
    .insert(treatmentsTable)
    .values({
      patientId: patient.id,
      medicationId: med1.id,
      dose: "1 comprimido",
      scheduleType: "times_per_day",
      scheduleConfig: { timesPerDay: 1, times: ["08:00"] },
      startDate: "2025-01-01",
      instructions: "Tomar em jejum (dado fictício)",
    })
    .returning();

  const [treatment2] = await db
    .insert(treatmentsTable)
    .values({
      patientId: patient.id,
      medicationId: med2.id,
      dose: "1 comprimido",
      scheduleType: "times_per_day",
      scheduleConfig: { timesPerDay: 2, times: ["08:00", "20:00"] },
      startDate: "2025-01-01",
    })
    .returning();

  const [treatment3] = await db
    .insert(treatmentsTable)
    .values({
      patientId: patient.id,
      medicationId: med3.id,
      dose: "1 cápsula",
      scheduleType: "times_per_day",
      scheduleConfig: { timesPerDay: 1, times: ["12:00"] },
      startDate: "2025-01-01",
    })
    .returning();

  console.log(`✓ Tratamentos fictícios criados`);

  // ── Doses agendadas para hoje ─────────────────────────────────────────────
  const todayStr = new Date().toISOString().slice(0, 10);

  const doses = [
    { treatmentId: treatment1.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T11:00:00.000Z`), status: "taken" as const },
    { treatmentId: treatment2.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T11:00:00.000Z`), status: "taken" as const },
    { treatmentId: treatment2.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T23:00:00.000Z`), status: "pending" as const },
    { treatmentId: treatment3.id, patientId: patient.id, scheduledAt: new Date(`${todayStr}T15:00:00.000Z`), status: "pending" as const },
  ];

  for (const dose of doses) {
    await db.insert(scheduledDosesTable).values(dose);
  }

  console.log(`✓ ${doses.length} doses agendadas para hoje (2 tomadas ✓, 2 pendentes ○)`);

  // ── Consulta fictícia ────────────────────────────────────────────────────
  await db.insert(appointmentsTable).values({
    patientId: patient.id,
    specialty: "Cardiologia (fictício)",
    doctorName: "Dr. Fictício da Silva",
    location: "Clínica Fictícia Teste",
    scheduledAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    notes: "Retorno — dado fictício de demonstração",
  });

  // ── Assinatura e notificação ─────────────────────────────────────────────
  await db.insert(subscriptionsTable).values({ familyId: family.id, plan: "free", status: "trialing" });
  await db.insert(notificationsTable).values({
    familyId: family.id,
    type: "system",
    title: "Bem-vindo ao ZELO (demonstração)",
    body: "Este é um dado fictício de demonstração.",
    sentAt: new Date(),
  });

  console.log("\n✅ Seed completo!");
  console.log(`  Família: "${family.name}"`);
  console.log(`  Paciente: "${patient.name}" (FICTÍCIO)`);
  console.log(`  Cuidadores: João Teste (principal), Ana Teste (observadora)`);
  console.log(`  Medicamentos: Cardiolex, Prexoral, Vitazan B (todos fictícios)`);
  console.log(`  Doses hoje: 2 tomadas ✓, 2 pendentes ○`);
}

seed().catch((err) => {
  console.error("Erro no seed:", err);
  process.exit(1);
});
