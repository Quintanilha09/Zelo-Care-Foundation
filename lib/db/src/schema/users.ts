import {
  pgTable,
  text,
  serial,
  integer,
  timestamp,
  pgEnum,
  boolean,
} from "drizzle-orm/pg-core";
import { familiesTable } from "./families";

// Conta de autenticação — identidade do cuidador no sistema.
// Separada de caregivers: um usuário pode ser cuidador em múltiplas
// famílias (múltiplas entradas em caregivers com userId preenchido).
// A coluna passwordHash é reservada — a mecânica de auth (magic link,
// OAuth, senha) é decisão da fase de autenticação.
export const userStatusEnum = pgEnum("user_status", [
  "active",
  "suspended",
  "pending_verification",
]);

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  // passwordHash reservado — preenchido apenas se a auth usar senha
  passwordHash: text("password_hash"),
  emailVerified: boolean("email_verified").notNull().default(false),
  /**
   * Endereço reserva, já confirmado — Issue #87.
   *
   * Nulo = a pessoa não cadastrou nenhum, e aceitou o risco disso (decisão do
   * fundador em 03/09/2026). O pendente, ainda não confirmado, mora em
   * `recovery_emails`; aqui só entra o que já provou ser controlado por
   * alguém.
   *
   * **O poder deste endereço é menor que o do `email` acima, de propósito.**
   * Ele recebe o código de aparelho novo (#79) e nada mais: não redefine
   * senha, não troca o e-mail principal, não entra sozinho. Isso não está
   * escrito como regra em lugar nenhum — é consequência de `login`,
   * `password-reset/request` e `account/email/change` procurarem por
   * `email` e nunca por esta coluna. Ver `recovery-emails.ts`.
   *
   * Sem `unique()`: duas pessoas da mesma família podem, legitimamente, usar
   * o mesmo endereço reserva — o do filho que cuida dos dois pais, por
   * exemplo. Unicidade aqui recusaria um caso real sem proteger nada.
   */
  recoveryEmail: text("recovery_email"),
  /** Quando o reserva foi confirmado. A tela mostra, e a auditoria usa. */
  recoveryEmailAt: timestamp("recovery_email_at", { withTimezone: true }),
  /**
   * Resgate pela família — Issue #87.
   *
   * Quando o cuidador principal restaura o acesso de alguém da própria
   * família, esta coluna guarda **até quando** a próxima entrada dessa pessoa
   * dispensa o segundo fator (#79). Nulo = nenhum resgate ativo.
   *
   * ── Por que isto não concede poder novo ──────────────────────────────────
   *
   * O cuidador principal **já vê e faz tudo naquela família**. Deixá-lo
   * restaurar o acesso de outro cuidador não acrescenta nada ao que ele já
   * podia — e é o caminho mais limpo que existe aqui, porque sai do modelo de
   * papéis que o produto já tem.
   *
   * ── O que ele custa, e como fica limitado ────────────────────────────────
   *
   * Um atacante que já tenha a SENHA de alguém e a cumplicidade (ou a conta
   * comprometida) de um cuidador principal de qualquer família dessa pessoa
   * ganha um caminho para pular o segundo fator. Não é hipotético, e não dá
   * para eliminar sem tirar o resgate — que é justamente o que impede a conta
   * de se perder. Três coisas limitam:
   *
   * 1. **Janela curta.** Quem pediu ajuda vai entrar logo; um resgate
   *    esquecido não pode ficar armado para sempre.
   * 2. **A pessoa resgatada é avisada por e-mail.** Se ela não pediu, é o que
   *    lhe dá a chance de reagir — mesmo papel do aviso da troca de e-mail.
   * 3. **Fica no registro de auditoria**: quem resgatou quem, e quando.
   *
   * ── Um resgate só, e some ao ser usado ───────────────────────────────────
   *
   * O login da #79 vai limpar esta coluna ao consumir o resgate. Guardar
   * "até quando" em vez de um booleano dá as duas garantias de uma vez: uso
   * único (o login apaga) e validade (o tempo apaga sozinho).
   */
  resgateLiberadoAte: timestamp("resgate_liberado_ate", { withTimezone: true }),
  status: userStatusEnum("status").notNull().default("pending_verification"),
  // Qual família a sessão abre. O JWT carrega UM familyId, mas o usuário
  // pode ser cuidador em várias (ver comentário acima) — sem isto, o login
  // escolhia uma arbitrária e quem tinha mais de uma podia cair na errada,
  // sem nenhuma forma de trocar. Nulo = ainda não escolheu; o login resolve
  // deterministicamente e grava. set null se a família for excluída — o
  // login resolve de novo na próxima vez, nunca fica apontando pra nada.
  activeFamilyId: integer("active_family_id").references(() => familiesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

export type User = typeof usersTable.$inferSelect;
export type InsertUser = typeof usersTable.$inferInsert;
