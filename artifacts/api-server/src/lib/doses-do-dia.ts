/**
 * As doses do dia, com tudo que a tela precisa — Issue #178.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * POR QUE ISTO SAIU DE DENTRO DA ROTA.
 *
 * Duas rotas em `dashboard.ts` montavam "o dia":
 *
 *   `GET /patients/:id/today-doses`   — de UM paciente, com tudo
 *   `GET /dashboard/today-summary`    — de TODOS, mas só a contagem
 *
 * A segunda **já buscava as doses de todos os pacientes da família** — e
 * jogava fora, devolvendo números. A tela inicial, que precisava das doses,
 * pedia a primeira rota para um paciente só. Era por isso que ela mostrava um
 * paciente enquanto o cuidador tinha quatro.
 *
 * Passar a devolver as doses é abrir a mão que já estava cheia. Mas fazer
 * isso copiando a consulta criaria duas verdades sobre o mesmo dia — que é
 * exatamente o defeito que a #162 acabou de consertar um andar acima, na
 * tela. Então o dia tem um dono, e é este arquivo.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { eq, ne, and, gte, lte, inArray, desc } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db } from "@workspace/db";
import {
  scheduledDosesTable, treatmentsTable, medicationsTable,
  doseRecordsTable, caregiversTable,
} from "@workspace/db";
import { UNDO_WINDOW_MS } from "../routes/dose-records.ts";
import { LATE_GRACE_MINUTES } from "./dose-generation.ts";
import { Clock } from "./clock.ts";
import { localDayBoundsUtc, toLocalDateTime, tomorrowInTimezone } from "@workspace/scheduling";

/**
 * Segundo join na mesma tabela, com apelido: quem REGISTROU e quem CORRIGIU
 * são pessoas diferentes, e a tela mostra as duas. Sem o alias, o Drizzle
 * juntaria as duas pontas na mesma linha de `caregivers`.
 */
const quemCorrigiu = alias(caregiversTable, "quem_corrigiu");

export interface PacienteDoDia {
  id: number;
  name: string;
}

export interface DoseDoDia {
  id: number;
  treatmentId: number;
  patientId: number;
  /** O nome do paciente vem junto: a tela inicial mostra doses de várias pessoas. */
  patientName: string;
  scheduledAt: Date;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late" | "postponed" | "partial";
  dose: string | null;
  medicationName: string;
  registeredAt: Date | null;
  registeredByCaregiverName: string | null;
  recordId: number | null;
  /**
   * Até quando dá para desfazer — Issue #135.
   *
   * Um **instante**, e não um booleano: booleano envelhece na mão do cliente,
   * chega dizendo "sim" e continua dizendo "sim" um minuto depois.
   */
  desfazerAte: string | null;
  /** A partir de quando conta como atrasada — Issue #153. Mesmo motivo. */
  atrasadaApartirDe: string;
  correctedAt: Date | null;
  correctedByName: string | null;
}

/**
 * As doses de um conjunto de pacientes, numa janela de tempo.
 *
 * A janela é **uma só** para todos, e o recorte por paciente é de quem chama.
 * É de propósito: cada paciente pode ter fuso próprio (ZELO-19), então "hoje"
 * não é o mesmo intervalo para todos — e quem sabe qual recorte quer é a
 * rota, não esta função.
 */
export async function dosesDoDia(
  pacientes: PacienteDoDia[],
  janela: { de: Date; ate: Date },
): Promise<DoseDoDia[]> {
  if (pacientes.length === 0) return [];

  const nomePorPaciente = new Map(pacientes.map((p) => [p.id, p.name]));

  const linhas = await db
    .select({
      id: scheduledDosesTable.id,
      treatmentId: scheduledDosesTable.treatmentId,
      patientId: scheduledDosesTable.patientId,
      scheduledAt: scheduledDosesTable.scheduledAt,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      status: scheduledDosesTable.status,
      // A dose DAQUELE dia, e não a do tratamento hoje — ver a #170. A
      // coluna é instantânea desde a fundação.
      dose: scheduledDosesTable.dose,
      medicationName: medicationsTable.name,
      registeredAt: doseRecordsTable.takenAt,
      registeredByCaregiverName: caregiversTable.name,
      registeredViaElderMode: doseRecordsTable.registeredViaElderMode,
      recordId: doseRecordsTable.id,
      /**
       * Quando o registro foi CRIADO, que é o que decide o prazo de desfazer.
       *
       * `takenAt` é quando a dose foi dada segundo o cuidador, e num registro
       * retroativo os dois são bem diferentes — usar o errado daria um minuto
       * para desfazer contado a partir de ontem.
       */
      recordCreatedAt: doseRecordsTable.createdAt,
      /**
       * Issue #136: registro corrigido sem marca visível é pior que registro
       * errado, porque quem lê passa a confiar no que não deve. Vem da
       * coluna, e não de uma consulta ao `audit_log` por dose.
       */
      correctedAt: doseRecordsTable.correctedAt,
      correctedByName: quemCorrigiu.name,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .leftJoin(doseRecordsTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .leftJoin(caregiversTable, eq(doseRecordsTable.caregiverId, caregiversTable.id))
    .leftJoin(quemCorrigiu, eq(doseRecordsTable.correctedByCaregiverId, quemCorrigiu.id))
    .where(and(
      inArray(scheduledDosesTable.patientId, pacientes.map((p) => p.id)),
      gte(scheduledDosesTable.scheduledAt, janela.de),
      lte(scheduledDosesTable.scheduledAt, janela.ate),
      /**
       * O "se necessário" fica FORA do dia — Issue #169.
       *
       * O uso dele vira uma dose agendada já tomada (é assim que ele
       * reaproveita desfazer, corrigir e o histórico), e sem esta linha
       * ele apareceria em "Já foi" no meio do que estava marcado.
       *
       * É outra pergunta. O dia responde *o que falta fazer*; o "se
       * necessário" responde *o que já precisou* — e por isso tem seção
       * própria, logo abaixo (`seNecessarioDoDia`).
       */
      ne(treatmentsTable.scheduleType, "se_necessario"),
    ))
    .orderBy(scheduledDosesTable.scheduledAt);

  return linhas.map((d) => {
    const patientName = nomePorPaciente.get(d.patientId) ?? "";
    return {
      id: d.id,
      treatmentId: d.treatmentId,
      patientId: d.patientId,
      patientName,
      scheduledAt: d.scheduledAt,
      scheduledLocalTime: d.scheduledLocalTime,
      status: d.status,
      dose: d.dose,
      medicationName: d.medicationName,
      registeredAt: d.registeredAt,
      /**
       * ZELO-40: quando o registro veio do modo idoso, o nome exibido é o do
       * PRÓPRIO paciente ("✓ 08:00 — Dona Maria"), não o do cuidador cuja
       * sessão o aparelho travado estava usando. O `caregiverId` real, que é
       * o da auditoria, não muda — só este rótulo.
       */
      registeredByCaregiverName: d.registeredViaElderMode ? patientName : d.registeredByCaregiverName,
      recordId: d.recordId,
      desfazerAte: d.recordCreatedAt
        ? new Date(d.recordCreatedAt.getTime() + UNDO_WINDOW_MS).toISOString()
        : null,
      /**
       * Issue #153 — o instante em que a dose passa a contar como atrasada.
       *
       * Vem para TODA dose, inclusive as que ainda vão acontecer: quem compara
       * é a tela, e um `null` a obrigaria a adivinhar no meio de uma decisão
       * que precisa ser binária.
       *
       * O `late` do banco continua valendo para a cascata de lembretes, o
       * relatório de adesão e o histórico. O que este campo muda é só a
       * EXIBIÇÃO, que passa a ser imediata em vez de esperar o cron.
       */
      atrasadaApartirDe: new Date(
        d.scheduledAt.getTime() + LATE_GRACE_MINUTES * 60_000,
      ).toISOString(),
      correctedAt: d.correctedAt,
      correctedByName: d.correctedByName,
    };
  });
}

// ── A janela do dia, por paciente ──────────────────────────────────────────

/**
 * A partir de que hora local a madrugada de amanhã aparece — Issue #154.
 *
 * ── Por que o SERVIDOR decide isto, e não a tela ─────────────────────────
 *
 * "Depois das 18:00" tem de ser 18:00 **no relógio do paciente**. Um filho em
 * Portugal olhando a mãe em São Paulo tem outro relógio no navegador — deixar
 * a tela decidir mostraria a madrugada na hora errada para ele. É a mesma
 * regra do ZELO-19, e o servidor é quem sabe o fuso.
 */
export const HORA_DE_MOSTRAR_A_MADRUGADA = 18;
/** Até que hora de amanhã ainda é "madrugada". */
export const FIM_DA_MADRUGADA = 6;

export interface JanelaDoDia {
  /** Começo do dia civil do paciente. */
  inicioDoDia: Date;
  /** Fim do dia civil do paciente — o corte entre "hoje" e "madrugada". */
  fimDoDia: Date;
  /** Até onde a consulta vai: o fim do dia, ou as 06:00 de amanhã à noite. */
  fimDaBusca: Date;
  ehNoite: boolean;
}

/**
 * O intervalo que a tela do dia precisa buscar, no fuso de um paciente.
 *
 * ── Por que a madrugada existe ───────────────────────────────────────────
 *
 * O fundador perguntou o que acontece com um remédio de madrugada. Não
 * acontecia nada: a tela recortava pelo dia civil, então **às 22:00 a dose
 * das 03:00 de amanhã não aparecia em lugar nenhum**. Quem ia dormir não
 * sabia que precisava acordar, e de manhã ela surgia como "Perdida" —
 * descoberta depois do fato, que é o que este produto existe para evitar.
 *
 * **Não é sobre o aviso.** O lembrete de madrugada já funciona: o silêncio
 * noturno só cala o broadcast de nível 2, nunca o primeiro aviso a quem é
 * responsável. O que faltava era saber **antes** — ajustar o despertador,
 * combinar quem acorda, separar o remédio.
 *
 * Durante o dia a busca continua sendo a de sempre: a tela responde "está
 * tudo em dia hoje?", e trazer amanhã sem mostrar seria carregar dado para
 * descartar.
 *
 * ── Issue #178: isto saiu de dentro da rota ──────────────────────────────
 *
 * Estava escrito dentro do `today-doses`. A `today-summary`, que passou a
 * servir a tela inicial de vários pacientes, precisa da mesma regra — e
 * copiá-la criaria duas respostas para "já é noite?".
 */
export function janelaDoDia(timezone: string, agora: Date): JanelaDoDia {
  const hoje = Clock.todayInTimezone(timezone);
  // ZELO-19: nunca `new Date(`${data}T00:00:00`)` — sem offset, isso é
  // interpretado no fuso do PROCESSO, não no do paciente.
  const { start: inicioDoDia, end: fimDoDia } = localDayBoundsUtc(hoje, timezone);

  const amanha = tomorrowInTimezone(agora, timezone);
  const { start: amanhaComeca } = localDayBoundsUtc(amanha, timezone);
  const fimDaMadrugada = new Date(amanhaComeca.getTime() + FIM_DA_MADRUGADA * 3_600_000);

  const horaLocal = Number(toLocalDateTime(agora, timezone).localTime.slice(0, 2));
  const ehNoite = horaLocal >= HORA_DE_MOSTRAR_A_MADRUGADA;

  return {
    inicioDoDia,
    fimDoDia,
    fimDaBusca: ehNoite ? fimDaMadrugada : fimDoDia,
    ehNoite,
  };
}
// ── O "se necessário" do dia — Issue #169 ─────────────────────────────────

/**
 * Um remédio "se necessário" e o que já se precisou dele hoje.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * OS DOIS NÚMEROS SÃO REGISTRO, E NUNCA VIRAM JULGAMENTO.
 *
 * `intervaloMinimoHoras` e `tetoDiario` vêm da RECEITA e são devolvidos crus,
 * do jeito que foram digitados. `ultimoUso` e `usosHoje` são fato registrado.
 *
 * O servidor NÃO compara os quatro, não conclui e não manda nada. A tela
 * mostra "a última foi às 14:20 · já foram 2 hoje · a receita diz a cada 6 h,
 * no máximo 4" e para por aí. Dizer "ainda não pode dar" seria prescrever, e
 * o invariante 4 proíbe — quem interpreta é o médico, com o cuidador ao lado
 * da pessoa.
 * ═══════════════════════════════════════════════════════════════════════════
 */
export interface SeNecessarioDoDia {
  treatmentId: number;
  patientId: number;
  patientName: string;
  medicationName: string;
  dose: string | null;
  /** Como a receita descreve o espaçamento. Só para mostrar. */
  intervaloMinimoHoras: number | null;
  /** Quantas por dia a receita permite. Só para mostrar. */
  tetoDiario: number | null;
  /** ISO do último uso REGISTRADO, de qualquer dia. Null se nunca foi usado. */
  ultimoUso: string | null;
  /** Quantos usos hoje, no fuso do paciente. */
  usosHoje: number;
  /** Os horários de hoje, em ordem, para a tela listar sem outra ida ao banco. */
  horariosDeHoje: string[];
}

/**
 * Os "se necessário" ativos dos pacientes, com o retrato de hoje.
 *
 * Uma consulta para os tratamentos e uma para os usos — não uma por
 * tratamento. A tela inicial de quem cuida de quatro pessoas abriria N+1
 * conexões para responder uma pergunta só.
 */
export async function seNecessarioDoDia(
  pacientes: PacienteDoDia[],
  janelasPorPaciente: Map<number, { inicioDoDia: Date; fimDoDia: Date }>,
): Promise<SeNecessarioDoDia[]> {
  if (pacientes.length === 0) return [];
  const nomePorPaciente = new Map(pacientes.map((p) => [p.id, p.name]));

  const tratamentos = await db
    .select({
      id: treatmentsTable.id,
      patientId: treatmentsTable.patientId,
      dose: treatmentsTable.dose,
      scheduleConfig: treatmentsTable.scheduleConfig,
      medicationName: medicationsTable.name,
    })
    .from(treatmentsTable)
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(and(
      inArray(treatmentsTable.patientId, pacientes.map((p) => p.id)),
      eq(treatmentsTable.scheduleType, "se_necessario"),
      eq(treatmentsTable.status, "active"),
    ))
    .orderBy(medicationsTable.name);

  if (tratamentos.length === 0) return [];

  // Todos os usos já registrados destes tratamentos, do mais recente para o
  // mais antigo. O recorte do dia de cada paciente é feito em memória, com a
  // janela dele — porque cada paciente pode ter fuso próprio (ZELO-19).
  const usos = await db
    .select({
      treatmentId: scheduledDosesTable.treatmentId,
      takenAt: doseRecordsTable.takenAt,
      localTime: scheduledDosesTable.scheduledLocalTime,
    })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .where(inArray(scheduledDosesTable.treatmentId, tratamentos.map((t) => t.id)))
    .orderBy(desc(doseRecordsTable.takenAt));

  return tratamentos.map((t) => {
    const receita = (t.scheduleConfig ?? {}) as {
      intervaloMinimoHoras?: number;
      tetoDiario?: number;
    };
    const janela = janelasPorPaciente.get(t.patientId);
    const meus = usos.filter((u) => u.treatmentId === t.id);
    const deHoje = janela
      ? meus.filter(
          (u) =>
            u.takenAt.getTime() >= janela.inicioDoDia.getTime() &&
            u.takenAt.getTime() <= janela.fimDoDia.getTime(),
        )
      : [];

    return {
      treatmentId: t.id,
      patientId: t.patientId,
      patientName: nomePorPaciente.get(t.patientId) ?? "",
      medicationName: t.medicationName,
      dose: t.dose,
      intervaloMinimoHoras: receita.intervaloMinimoHoras ?? null,
      tetoDiario: receita.tetoDiario ?? null,
      // O último de QUALQUER dia, e não só de hoje: às 00:30, "a última foi
      // às 23:40" é a informação que importa, e zerar na virada do dia
      // esconderia justamente o uso mais recente.
      ultimoUso: meus[0]?.takenAt.toISOString() ?? null,
      usosHoje: deHoje.length,
      // Em ordem crescente para a tela ler como uma linha do tempo.
      horariosDeHoje: deHoje.map((u) => u.localTime).reverse(),
    };
  });
}
