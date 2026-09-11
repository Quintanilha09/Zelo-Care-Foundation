import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  date,
  boolean,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { familiesTable } from "./families";

// timezone é obrigatório: "08:00 do paciente" precisa ser 08:00 no relógio
// do paciente, independente do fuso de quem cuida.
export const patientsTable = pgTable("patients", {
  id: serial("id").primaryKey(),
  familyId: integer("family_id")
    .notNull()
    .references(() => familiesTable.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  birthDate: date("birth_date", { mode: "string" }),
  timezone: text("timezone").notNull(), // ex: "America/Sao_Paulo"
  notes: text("notes"),
  // ZELO-37: "se o cuidador quiser marcar algo como preocupante, ele
  // escreve na observação — a ação do app é oferecer o contato de
  // emergência já cadastrado, encaminhar, nunca avaliar." Vive no
  // paciente (não na família): quem chamar em uma emergência pode
  // depender de qual paciente, mesmo dentro da mesma família.
  emergencyContactName: text("emergency_contact_name"),
  emergencyContactPhone: text("emergency_contact_phone"),
  /**
   * ── Alergias e condições — Issue #176 ──────────────────────────────────
   *
   * ═══════════════════════════════════════════════════════════════════════
   * É O PRIMEIRO DADO QUE UM PRONTO-SOCORRO PERGUNTA.
   *
   * E o cuidador que chega com o idoso às três da manhã costuma não saber de
   * cor — ainda mais quando não é o cuidador principal.
   * ═══════════════════════════════════════════════════════════════════════
   *
   * ── Registrar não é interpretar ────────────────────────────────────────
   *
   * O invariante 4 proíbe o app de **verificar interação medicamentosa** e de
   * opinar. Guardar "alérgica a dipirona" e mostrar para quem cuida não é
   * nenhuma das duas coisas — é a mesma natureza do contato de emergência,
   * que já vive aqui ao lado.
   *
   * **A linha que não se cruza:** o app nunca cruza estes campos com o
   * medicamento cadastrado, nunca avisa, nunca impede. Ele mostra o que
   * alguém escreveu, para uma pessoa ler.
   *
   * ── Por que texto livre, e não lista fechada ───────────────────────────
   *
   * "Alérgica a AAS e a esparadrapo" é uma frase de gente. Obrigar a escolher
   * de um catálogo faz perder metade — e a metade perdida é justamente a que
   * ninguém previu.
   *
   * ── Dado de saúde, com o cuidado do resto ──────────────────────────────
   *
   * Não estão na allowlist do `safeLog`, então nunca entram em log
   * (invariante 3). Vivem no paciente, e por isso já entram no export e na
   * exclusão da LGPD junto com ele.
   */
  allergies: text("allergies"),
  conditions: text("conditions"),
  // ZELO-40: liga o modo idoso (tela única, letra grande, só "Tomei") pra
  // este paciente. Ativado pelo cuidador principal — não é uma conta
  // própria do paciente, é o dispositivo entrando num modo travado usando
  // a sessão do cuidador que o ativou (ver ElderModePage no frontend).
  elderModeEnabled: boolean("elder_mode_enabled").notNull().default(false),
  // Arquivar suspende doses futuras sem apagar histórico. Nunca DELETE aqui —
  // exclusão de verdade é o fluxo de LGPD (export-deletion), não este campo.
  archived: boolean("archived").notNull().default(false),
  /**
   * Desde quando este paciente está sem nenhum responsável — Issue #123.
   *
   * ── Quem escreve nestas duas colunas ──────────────────────────────────
   *
   * **Só o job diário** (`lib/paciente-sem-cuidador.ts`). Nenhuma rota mexe
   * aqui, e é de propósito: o vínculo também some por CASCATA — apagar o
   * cuidador leva as linhas de `caregiver_patients` junto, sem passar por
   * rota nenhuma. Se a rota de desvincular fosse a dona do relógio, esse
   * caminho deixaria o estado parado para sempre e o aviso nunca sairia.
   *
   * O job vê o estado real todo dia e reescreve: paciente coberto tem o
   * relógio zerado, paciente descoberto tem o relógio andando.
   *
   * ── O preço disso, medido e aceito ───────────────────────────────────
   *
   * O relógio de um paciente que PERDE o responsável começa na última vez
   * que o job o viu coberto — até 24h antes do desvínculo real. Então esse
   * caso avisa entre 1 e 2 dias, não exatos 2. O caso que o fundador
   * descreveu — paciente novo que ninguém vinculou — é exato, porque o
   * `defaultNow()` abaixo o marca no instante do cadastro.
   *
   * Fila diária não tem como ser mais preciso que um dia sem virar gatilho
   * em rota, que é justamente o que a cascata quebraria.
   */
  uncoveredSince: timestamp("uncovered_since", { withTimezone: true })
    .notNull()
    .defaultNow(),
  /**
   * Quando o aviso de "sem cuidador" foi enviado — Issue #123.
   *
   * `null` significa "ainda não avisamos por este período descoberto". O job
   * zera de volta assim que vê o paciente coberto, e é isso que faz o aviso
   * **não se repetir todo dia** e ao mesmo tempo **voltar a valer** se a
   * situação se repetir. Sem isso o e-mail viraria ruído diário, e ruído
   * diário acaba numa regra de filtro na caixa de entrada — que é o mesmo
   * que não avisar.
   */
  uncoveredAlertSentAt: timestamp("uncovered_alert_sent_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export const insertPatientSchema = createInsertSchema(patientsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
  // Issue #123: as duas colunas do aviso são do job, não de quem cadastra.
  // Hoje este schema não é usado por rota nenhuma; no dia em que for, aceitar
  // `uncoveredAlertSentAt` no corpo deixaria qualquer cliente desligar o aviso
  // do próprio paciente escrevendo uma data.
  uncoveredSince: true,
  uncoveredAlertSentAt: true,
});

export type InsertPatient = z.infer<typeof insertPatientSchema>;
export type Patient = typeof patientsTable.$inferSelect;
