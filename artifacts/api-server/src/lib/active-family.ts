/**
 * Qual família a sessão abre — ZELO.
 *
 * O JWT carrega UM familyId (ver lib/tokens.ts), mas um usuário pode ser
 * cuidador em várias famílias — cuidar da própria mãe E ser cuidadora
 * contratada de outra família é o caso real, não hipótese. O schema sempre
 * previu isso (comentário em users.ts), mas login e refresh escolhiam com
 * `.limit(1)` SEM ordenação: família arbitrária, e nenhuma forma de trocar.
 * Quem se cadastrava clicando num link de convite ganhava uma família
 * própria vazia e podia cair nela, sem ver paciente nenhum.
 *
 * Ordem de resolução, sempre determinística:
 * 1. users.activeFamilyId, se o vínculo com ela ainda existir;
 * 2. senão, o vínculo mais antigo (menor caregiverId) — e grava como ativa,
 *    pra que a próxima sessão não precise resolver de novo.
 */
import { eq, and, asc } from "drizzle-orm";
import { db } from "@workspace/db";
import { caregiversTable, usersTable } from "@workspace/db";
import type { CaregiverRole } from "./capabilities.ts";

export interface ResolvedCaregiver {
  id: number;
  familyId: number;
  role: CaregiverRole;
}

/** Todos os vínculos de cuidador do usuário, mais antigo primeiro. */
export async function listCaregiverLinks(userId: number): Promise<ResolvedCaregiver[]> {
  const rows = await db
    .select({ id: caregiversTable.id, familyId: caregiversTable.familyId, role: caregiversTable.role })
    .from(caregiversTable)
    .where(eq(caregiversTable.userId, userId))
    .orderBy(asc(caregiversTable.id));
  return rows.map((r) => ({ ...r, role: r.role as CaregiverRole }));
}

/**
 * Resolve com qual família (e papel) o usuário entra. Devolve null só
 * quando não há vínculo nenhum — conta órfã, tratada por quem chama.
 */
export async function resolveActiveCaregiver(userId: number): Promise<ResolvedCaregiver | null> {
  const links = await listCaregiverLinks(userId);
  if (links.length === 0) return null;

  const [user] = await db
    .select({ activeFamilyId: usersTable.activeFamilyId })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  const preferred = user?.activeFamilyId != null
    ? links.find((l) => l.familyId === user.activeFamilyId)
    : undefined;
  if (preferred) return preferred;

  // Sem preferência válida (nunca escolheu, ou a família escolhida sumiu):
  // fixa a mais antiga pra que a escolha pare de variar entre sessões.
  const fallback = links[0];
  await db.update(usersTable).set({ activeFamilyId: fallback.familyId }).where(eq(usersTable.id, userId));
  return fallback;
}

/**
 * Troca a família ativa. Devolve null se o usuário não for cuidador na
 * família pedida — nunca confia no id vindo do cliente.
 */
export async function switchActiveFamily(userId: number, familyId: number): Promise<ResolvedCaregiver | null> {
  const [link] = await db
    .select({ id: caregiversTable.id, familyId: caregiversTable.familyId, role: caregiversTable.role })
    .from(caregiversTable)
    .where(and(eq(caregiversTable.userId, userId), eq(caregiversTable.familyId, familyId)))
    .limit(1);
  if (!link) return null;

  await db.update(usersTable).set({ activeFamilyId: familyId }).where(eq(usersTable.id, userId));
  return { ...link, role: link.role as CaregiverRole };
}
