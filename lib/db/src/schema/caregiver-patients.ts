import {
  pgTable,
  serial,
  integer,
  timestamp,
  unique,
} from "drizzle-orm/pg-core";
import { caregiversTable } from "./caregivers";
import { patientsTable } from "./patients";

/**
 * Quem é responsável por quem — Issue #120.
 *
 * ── O buraco que isto tapa ────────────────────────────────────────────────
 *
 * Até 09/09/2026 **não existia nenhuma tabela ligando cuidador a paciente.**
 * O `caregiverId` aparecia em dez tabelas (`dose_records`, `activities`,
 * `media_assets`, …) sempre com o mesmo sentido: *quem fez a ação*. Nunca *de
 * quem essa pessoa cuida*.
 *
 * O modelo era: cuidador pertence a uma família, e vê todos os pacientes dela.
 * Numa família com pai e mãe — o exemplo do próprio spec — não havia como
 * dizer quem era responsável por quem.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ISTO É VÍNCULO, NÃO AUTORIZAÇÃO.
 *
 * Um cuidador **não** vinculado a um paciente **continua vendo e registrando
 * dose** daquele paciente, exatamente como antes. Nada aqui entra em
 * `capabilities.ts`, e o JWT continua carregando um `role` único por sessão.
 *
 * A pergunta que esta tabela responde é *"quem é o responsável?"*, não *"quem
 * pode ver?"*. Autorização por paciente é a fase 11.6, e continua adiada — o
 * que ela exige é mudar o modelo de autorização inteiro, e isso não cabia
 * junto.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que os dois lados são CASCADE ─────────────────────────────────────
 *
 * O vínculo não tem vida própria: ele só existe enquanto as duas pontas
 * existem. Sair da família ou excluir o paciente leva o vínculo junto, e uma
 * linha órfã aqui só produziria "responsável" apontando para ninguém.
 */
export const caregiverPatientsTable = pgTable(
  "caregiver_patients",
  {
    id: serial("id").primaryKey(),
    caregiverId: integer("caregiver_id")
      .notNull()
      .references(() => caregiversTable.id, { onDelete: "cascade" }),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    /**
     * Quem criou o vínculo. Só o cuidador principal vincula, e o audit_log
     * guarda o mesmo — esta coluna existe para a consulta não precisar do
     * audit para responder "quem pôs esta pessoa aqui".
     */
    createdByCaregiverId: integer("created_by_caregiver_id").references(
      () => caregiversTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    /**
     * Vincular duas vezes é o mesmo vínculo.
     *
     * Sem isto, dois toques rápidos no botão criariam duas linhas, e o
     * paciente apareceria duas vezes na lista de responsáveis. A rota usa
     * `onConflictDoNothing` em cima desta restrição: o estado final é o
     * mesmo, então repetir não é erro.
     */
    unicoPorPar: unique("caregiver_patients_par_unico").on(t.caregiverId, t.patientId),
  }),
);

export type CaregiverPatient = typeof caregiverPatientsTable.$inferSelect;
