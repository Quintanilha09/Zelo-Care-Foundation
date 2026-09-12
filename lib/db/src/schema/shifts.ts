import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  index,
} from "drizzle-orm/pg-core";
import { patientsTable } from "./patients";
import { caregiversTable } from "./caregivers";

/**
 * A escala de plantão — Issue #177.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELA RESPONDE "DE QUEM É A VEZ?", E NUNCA "QUEM PODE?".
 *
 * Numa família que reveza — que é exatamente o caso que o ZELO existe para
 * servir — a pergunta *"você vai dar o da noite ou eu vou?"* continua
 * acontecendo no WhatsApp. É nessa pergunta não respondida que a dose se
 * perde: os dois acham que o outro deu.
 *
 * ── A linha que não se cruza ─────────────────────────────────────────────
 *
 * NADA neste arquivo pode virar filtro de acesso. Ninguém perde paciente,
 * dose, tela ou capacidade por não estar de plantão. A regra é a mesma da
 * #120, e o motivo é concreto: se a escala filtrasse acesso, uma família
 * inteira perderia o app numa noite em que ninguém marcou plantão.
 *
 * O que a escala muda é UMA coisa — para quem vai o PRIMEIRO lembrete. O
 * escalonamento para a família inteira continua idêntico.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Recorrente e pontual na mesma tabela ─────────────────────────────────
 *
 * `weekday` preenchido = recorrência semanal ("terças e quintas é a Ana").
 * `onDate`  preenchido = troca pontual ("este sábado eu troco com você").
 * Exatamente um dos dois, nunca os dois.
 *
 * A troca pontual **vence** a recorrência naquele dia. Duas tabelas
 * separadas diriam a mesma coisa e obrigariam toda leitura a juntar as duas
 * — e a regra de precedência ficaria escrita em dois lugares.
 *
 * ── Por que o turno tem hora, e por que ela pode virar a noite ───────────
 *
 * "O da noite" é o exemplo canônico, e um turno das 22:00 às 06:00 atravessa
 * a meia-noite. Quem lê compara `startTime` e `endTime` sabendo disso (ver
 * `lib/plantao.ts`); guardar dois registros por turno de noite duplicaria a
 * escala e faria a tela mostrar a mesma pessoa duas vezes.
 *
 * Padrão 00:00–23:59: o dia inteiro, que é o que a maioria quer dizer com
 * "sábado é meu".
 */
export const shiftsTable = pgTable(
  "shifts",
  {
    id: serial("id").primaryKey(),
    patientId: integer("patient_id")
      .notNull()
      .references(() => patientsTable.id, { onDelete: "cascade" }),
    /**
     * Quem está de plantão.
     *
     * `cascade` porque um plantão de um cuidador que saiu da família não
     * descreve nada — e deixá-lo faria a tela dizer que a vez é de alguém
     * que não está mais lá.
     */
    caregiverId: integer("caregiver_id")
      .notNull()
      .references(() => caregiversTable.id, { onDelete: "cascade" }),
    /** 0=domingo .. 6=sábado — convenção JS `Date.getDay()`, como em treatments. */
    weekday: integer("weekday"),
    /** "YYYY-MM-DD" no fuso do PACIENTE. Troca pontual. */
    onDate: date("on_date", { mode: "string" }),
    /** "HH:mm" no relógio do paciente. */
    startTime: text("start_time").notNull().default("00:00"),
    /** "HH:mm". Menor que `startTime` significa turno que vira a noite. */
    endTime: text("end_time").notNull().default("23:59"),
    createdByCaregiverId: integer("created_by_caregiver_id").references(
      () => caregiversTable.id,
      { onDelete: "set null" },
    ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // A pergunta que o app faz o tempo todo é "quem está de plantão para
    // ESTE paciente agora" — e ela varre a escala inteira dele.
    index("idx_shifts_patient").on(t.patientId),
  ],
);

export type Shift = typeof shiftsTable.$inferSelect;
export type InsertShift = typeof shiftsTable.$inferInsert;
