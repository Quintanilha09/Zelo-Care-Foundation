/**
 * Relatório de adesão em PDF — ZELO (ZELO-35).
 *
 * "A tela subestimada" (spec): o gatilho de conversão mais forte depois do
 * segundo cuidador, e a porta de entrada do B2B com operadoras. Duas regras
 * absolutas herdadas da ZELO-33 e reforçadas aqui, porque agora o documento
 * sai do app: SEM interpretação clínica nenhuma (sem faixa de referência,
 * sem cor de risco, sem sugestão) e SEMPRE com o rodapé que mantém o
 * produto fora do enquadramento de dispositivo médico.
 *
 * "Adiada" (outcome/status postponed) entra no balde "pulada" pro relatório
 * — a spec pede só 3 baldes (tomada/pulada/sem registro), e uma dose adiada
 * nunca vira "tomada" automaticamente neste produto (postponedTo é só
 * informativo, sem reagendamento real) — então, na prática, a dose
 * prescrita não foi tomada, mesma classificação de "pulada".
 */
import { eq, ne, and, gte, lte, desc } from "drizzle-orm";
import { db } from "@workspace/db";
import { Clock } from "./clock.ts";
import {
  patientsTable, treatmentsTable, medicationsTable, scheduledDosesTable,
  doseRecordsTable, healthMeasurementsTable,
} from "@workspace/db";
import { localDayBoundsUtc, toLocalDateTime } from "@workspace/scheduling";
import PDFDocument from "pdfkit";

export interface ActualVsPrescribed {
  prescribedTime: string;
  averageActualTime: string;
  averageDeltaMinutes: number;
  sampleSize: number;
}

/**
 * Uma dose e o trecho do período em que ela valeu — Issue #172.
 *
 * É o degrau do desmame visto de fora: o relatório não sabe (nem precisa
 * saber) que houve um desmame cadastrado. Ele olha o que as doses
 * agendadas dizem e descreve o que aconteceu.
 *
 * ── Primeiro e último dia, e não blocos contíguos ────────────────────
 *
 * Com dose por horário (#171), o mesmo dia tem legitimamente duas doses
 * diferentes — "1 comprimido de manhã e 2 à noite". Partir isso em blocos
 * contíguos faria a lista alternar linha a linha e não descreveria nada.
 * Primeiro e último dia de cada dose é verdade nos dois casos: no desmame
 * os trechos saem em sequência, e na dose por horário eles se sobrepõem —
 * que é exatamente o que houve.
 */
export interface DosePeriodRow {
  dose: string;
  /** Primeiro dia do período em que esta dose apareceu (YYYY-MM-DD). */
  from: string;
  /** Último dia (YYYY-MM-DD). */
  to: string;
}

/**
 * Um uso de remédio "se necessário" — Issue #169.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * FORA DA ADESÃO, E EM SEÇÃO PRÓPRIA.
 *
 * Adesão é sobre o que estava marcado. Um remédio que só devia ser tomado
 * quando precisasse não tem o que aderir — e contá-lo no percentual faria
 * o número que o relatório existe para levar virar ficção.
 *
 * Mas o uso em si é, muitas vezes, o dado MAIS importante da página:
 * quantas vezes a bombinha de resgate foi usada nesta semana é sinal
 * clínico. Por isso ele não some — ele muda de lugar.
 * ═══════════════════════════════════════════════════════════════════════
 */
export interface PrnUseRow {
  medicationName: string;
  dose: string | null;
  /** Dia civil do paciente, "YYYY-MM-DD". */
  localDate: string;
  /** "HH:mm" no relógio do paciente. */
  localTime: string;
  /** Por que precisou, se o cuidador escreveu. */
  justification: string | null;
}

export interface MedicationReportRow {
  medicationId: number;
  medicationName: string;
  dose: string | null;
  /**
   * Os degraus, em ordem cronológica — Issue #172.
   *
   * Vazio quando não houve dose nenhuma registrada no período. Com uma
   * dose só, tem um item — e aí o PDF continua imprimindo a frase de
   * sempre, sem data nenhuma.
   */
  dosePeriods: DosePeriodRow[];
  prescribedTimes: string[];
  totalScheduled: number;
  taken: number;
  skipped: number; // inclui "postponed" — ver nota no topo do arquivo
  /**
   * "Tomou em parte" — Issue #175.
   *
   * ══════════════════════════════════════════════════════════════════
   * NÃO SOMA COM TOMADA NEM COM PULADA, E ISSO É O PONTO.
   *
   * O app não sabe quanto de um comprimido cuspido foi absorvido — e
   * somar em qualquer dos dois lados seria ele decidindo uma coisa que
   * não sabe (invariante 4). O médico é quem interpreta; o relatório
   * mostra o número e a frase do cuidador, separados.
   * ══════════════════════════════════════════════════════════════════
   */
  partial: number;
  unregistered: number;
  adherenceRate: number | null;
  actualVsPrescribed: ActualVsPrescribed[];
}

export interface MeasurementRow {
  type: string;
  value: string | null;
  unit: string | null;
  measuredAt: Date;
  notes: string | null;
}

export interface AdherenceReportData {
  patientName: string;
  periodStart: string;
  periodEnd: string;
  generatedAt: Date;
  medications: MedicationReportRow[];
  /**
   * Os usos de "se necessário" no período — Issue #169.
   *
   * Do mais recente para o mais antigo, porque é assim que se lê um
   * histórico de resgate. Vazio quando o paciente não tem nenhum — e aí
   * a seção não é impressa.
   */
  prnUses: PrnUseRow[];
  measurements: MeasurementRow[];
}

/**
 * "2026-03-01" → "01/03/2026" — Issue #172.
 *
 * Troca de posição de texto, sem passar por Date: o valor já é um dia
 * civil do fuso do paciente, e construir uma data aqui só para formatá-la
 * é o caminho clássico de imprimir o dia anterior num documento clínico.
 */
function emPortugues(iso: string): string {
  return iso.split("-").reverse().join("/");
}

function timeToMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function averageTimeOfDay(times: string[]): { averageTime: string; averageMinutes: number } {
  const minutes = times.map(timeToMinutes);
  const rounded = Math.round(minutes.reduce((a, b) => a + b, 0) / minutes.length);
  const h = Math.floor(rounded / 60) % 24;
  const m = rounded % 60;
  return { averageTime: `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`, averageMinutes: rounded };
}

export async function computeReportData(
  patientId: number,
  periodStart: string,
  periodEnd: string
): Promise<AdherenceReportData> {
  const [patient] = await db
    .select({ name: patientsTable.name, timezone: patientsTable.timezone })
    .from(patientsTable)
    .where(eq(patientsTable.id, patientId))
    .limit(1);
  if (!patient) throw new Error("Paciente não encontrado");

  const { start } = localDayBoundsUtc(periodStart, patient.timezone);
  const { end } = localDayBoundsUtc(periodEnd, patient.timezone);

  const rows = await db
    .select({
      medicationId: treatmentsTable.medicationId,
      medicationName: medicationsTable.name,
      /**
       * A dose DAQUELA dose, e não a do tratamento hoje — Issue #170.
       *
       * ═══════════════════════════════════════════════════════════════════
       * ERA `treatmentsTable.dose`, E ISSO REESCREVIA O PASSADO NO PDF.
       *
       * Num desmame — prednisona 40 → 20 → 10, ansiolítico sendo retirado,
       * anticoagulante ajustado por exame — o tratamento tem UMA dose, a de
       * agora. Lendo dali, o relatório de agosto imprimia a dose de
       * setembro: **"Dose prescrita: 10mg"** para doses que foram de 40mg.
       *
       * O documento que vai ao médico é exatamente o que não pode mentir.
       * ═══════════════════════════════════════════════════════════════════
       *
       * ── O valor certo já estava aqui ─────────────────────────────────
       *
       * `scheduled_doses.dose` é instantâneo desde a fundação — "cópia do
       * treatment.dose no momento do agendamento", e é `dose-generation.ts`
       * quem preenche. A consulta abaixo já parte desta tabela. Era só ler
       * a coluna certa.
       *
       * Por isso a tela sempre mostrou o histórico correto (`dashboard.ts`
       * lê `scheduledDosesTable.dose`) e só o PDF errava.
       */
      dose: scheduledDosesTable.dose,
      // O dia CIVIL do paciente, e não o instante: é ele que vira a data
      // impressa ao lado do degrau, e converter o instante de volta aqui
      // refaria uma conta de fuso que o agendamento já fez.
      scheduledLocalDate: scheduledDosesTable.scheduledLocalDate,
      scheduledLocalTime: scheduledDosesTable.scheduledLocalTime,
      status: scheduledDosesTable.status,
      takenAt: doseRecordsTable.takenAt,
      outcome: doseRecordsTable.outcome,
    })
    .from(scheduledDosesTable)
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .leftJoin(doseRecordsTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .where(and(
      eq(scheduledDosesTable.patientId, patientId),
      gte(scheduledDosesTable.scheduledAt, start),
      lte(scheduledDosesTable.scheduledAt, end),
      /**
       * O "se necessário" NÃO entra na adesão — Issue #169.
       *
       * Esta linha é o critério de aceite inteiro. Sem ela, o uso de
       * resgate entraria como dose tomada e inflaria o percentual; e o
       * contorno antigo (horário inventado + pulo diário) o afundava.
       * Nos dois casos o número que vai ao médico deixa de descrever o
       * tratamento.
       *
       * Os usos aparecem logo abaixo, em `prnUses`, com data, hora e
       * motivo.
       */
      ne(treatmentsTable.scheduleType, "se_necessario"),
    ));

  const byMedication = new Map<number, {
    medicationName: string;
    /**
     * TODAS as doses que valeram no período — Issue #170.
     *
     * Era um campo só, preenchido pela primeira linha vista. Com a leitura
     * certa (a dose de cada dose agendada), um desmame passa a trazer
     * valores diferentes no mesmo período — e guardar só o primeiro
     * esconderia os outros degraus do médico.
     *
     * Conjunto, e não lista: o caso comum é uma dose só, e aí a frase do
     * PDF sai exatamente como sempre saiu.
     */
    doses: Set<string>;
    /** dose → primeiro e último dia em que ela apareceu — Issue #172. */
    periodoDaDose: Map<string, { de: string; ate: string }>;
    prescribedTimes: Set<string>;
    total: number; taken: number; skipped: number; partial: number; unregistered: number;
    actualByPrescribedTime: Map<string, string[]>; // prescribedTime -> lista de horários reais (HH:mm, tomadas)
  }>();

  for (const row of rows) {
    let entry = byMedication.get(row.medicationId);
    if (!entry) {
      entry = {
        medicationName: row.medicationName, doses: new Set(), periodoDaDose: new Map(),
        prescribedTimes: new Set(), total: 0, taken: 0, skipped: 0, partial: 0, unregistered: 0,
        actualByPrescribedTime: new Map(),
      };
      byMedication.set(row.medicationId, entry);
    }
    if (row.dose) {
      entry.doses.add(row.dose);
      // Comparação de string em "YYYY-MM-DD" é comparação de data: o
      // formato é ordenável por natureza, e construir um Date aqui só
      // para comparar abriria a porta do fuso sem necessidade.
      const ja = entry.periodoDaDose.get(row.dose);
      if (!ja) {
        entry.periodoDaDose.set(row.dose, { de: row.scheduledLocalDate, ate: row.scheduledLocalDate });
      } else {
        if (row.scheduledLocalDate < ja.de) ja.de = row.scheduledLocalDate;
        if (row.scheduledLocalDate > ja.ate) ja.ate = row.scheduledLocalDate;
      }
    }
    entry.prescribedTimes.add(row.scheduledLocalTime);
    entry.total += 1;

    if (row.status === "taken") {
      entry.taken += 1;
      if (row.takenAt) {
        const { localTime } = toLocalDateTime(row.takenAt, patient.timezone);
        const list = entry.actualByPrescribedTime.get(row.scheduledLocalTime) ?? [];
        list.push(localTime);
        entry.actualByPrescribedTime.set(row.scheduledLocalTime, list);
      }
    } else if (row.status === "partial") {
      // Conta como TENTATIVA registrada, em balde próprio.
      entry.partial += 1;
    } else if (row.status === "skipped" || row.status === "postponed") {
      entry.skipped += 1;
    } else {
      entry.unregistered += 1; // pending, late
    }
  }

  const medications: MedicationReportRow[] = Array.from(byMedication.entries()).map(([medicationId, e]) => {
    const prescribedTimes = Array.from(e.prescribedTimes).sort();
    const actualVsPrescribed: ActualVsPrescribed[] = [];
    for (const prescribedTime of prescribedTimes) {
      const actuals = e.actualByPrescribedTime.get(prescribedTime);
      if (!actuals || actuals.length === 0) continue;
      const prescribedMinutes = timeToMinutes(prescribedTime);
      const { averageTime, averageMinutes } = averageTimeOfDay(actuals);
      actualVsPrescribed.push({
        prescribedTime,
        averageActualTime: averageTime,
        averageDeltaMinutes: averageMinutes - prescribedMinutes,
        sampleSize: actuals.length,
      });
    }
    const periodos: DosePeriodRow[] = Array.from(e.periodoDaDose.entries())
      .map(([dose, p]) => ({ dose, from: p.de, to: p.ate }))
      .sort((a, b) => (a.from === b.from ? a.dose.localeCompare(b.dose) : a.from.localeCompare(b.from)));

    return {
      medicationId, medicationName: e.medicationName,
      /**
       * Ordem CRONOLÓGICA — Issue #172, corrigindo a ordem alfabética que
       * a #170 havia deixado.
       *
       * Alfabética, um desmame saía "10mg, 20mg, 40mg" — a ordem exata do
       * contrário do que aconteceu, num documento que vai ao médico.
       * Empate no primeiro dia (dose por horário) desempata pelo texto,
       * para o PDF não mudar de ordem entre duas gerações do mesmo
       * período: documento clínico que muda sozinho perde a confiança de
       * quem o compara com o anterior.
       */
      dose: periodos.length > 0
        ? periodos.length === 1
          // Uma dose só: a frase sai exatamente como sempre saiu, sem
          // data. "Dose prescrita: 1 comprimido (01/03 a 31/03)" seria
          // ruído no caso que é a esmagadora maioria.
          ? periodos[0].dose
          : periodos.map((d) => `${d.dose} (${emPortugues(d.from)} a ${emPortugues(d.to)})`).join(", ")
        : null,
      dosePeriods: periodos,
      prescribedTimes,
      totalScheduled: e.total, taken: e.taken, skipped: e.skipped,
      partial: e.partial, unregistered: e.unregistered,
      adherenceRate: e.total > 0 ? e.taken / e.total : null,
      actualVsPrescribed,
    };
  });
  medications.sort((a, b) => a.medicationId - b.medicationId);

  /**
   * Os usos de "se necessário" no período — Issue #169.
   *
   * Consulta separada de propósito: ela pergunta pelo REGISTRO (quando o
   * cuidador diz que deu), enquanto a de adesão pergunta pela AGENDA
   * (quando estava marcado). Misturar as duas foi exatamente o que fez o
   * contorno antigo sujar o número.
   *
   * O recorte é por `takenAt`, e não por `scheduledAt`: num uso lançado
   * depois os dois são iguais por construção, mas se um dia alguém
   * corrigir o horário (#136) é o `takenAt` que vale — é ele que diz
   * quando a pessoa tomou.
   */
  const prnRows = await db
    .select({
      medicationName: medicationsTable.name,
      dose: scheduledDosesTable.dose,
      takenAt: doseRecordsTable.takenAt,
      justification: doseRecordsTable.justification,
    })
    .from(doseRecordsTable)
    .innerJoin(scheduledDosesTable, eq(doseRecordsTable.scheduledDoseId, scheduledDosesTable.id))
    .innerJoin(treatmentsTable, eq(scheduledDosesTable.treatmentId, treatmentsTable.id))
    .innerJoin(medicationsTable, eq(treatmentsTable.medicationId, medicationsTable.id))
    .where(and(
      eq(scheduledDosesTable.patientId, patientId),
      eq(treatmentsTable.scheduleType, "se_necessario"),
      gte(doseRecordsTable.takenAt, start),
      lte(doseRecordsTable.takenAt, end),
    ))
    .orderBy(desc(doseRecordsTable.takenAt));

  const prnUses: PrnUseRow[] = prnRows.map((u) => {
    const { localDate, localTime } = toLocalDateTime(u.takenAt, patient.timezone);
    return {
      medicationName: u.medicationName,
      dose: u.dose,
      localDate,
      localTime,
      justification: u.justification,
    };
  });

  const measurementRows = await db
    .select({
      type: healthMeasurementsTable.type, value: healthMeasurementsTable.value,
      unit: healthMeasurementsTable.unit, measuredAt: healthMeasurementsTable.measuredAt,
      notes: healthMeasurementsTable.notes,
    })
    .from(healthMeasurementsTable)
    .where(and(
      eq(healthMeasurementsTable.patientId, patientId),
      gte(healthMeasurementsTable.measuredAt, start),
      lte(healthMeasurementsTable.measuredAt, end)
    ))
    .orderBy(healthMeasurementsTable.measuredAt);

  return {
    patientName: patient.name,
    periodStart, periodEnd,
    generatedAt: Clock.now(),
    medications,
    prnUses,
    measurements: measurementRows,
  };
}

const MEASUREMENT_TYPE_LABELS: Record<string, string> = {
  blood_pressure: "Pressão arterial", blood_glucose: "Glicemia", weight: "Peso",
  temperature: "Temperatura", oxygen_saturation: "Saturação de O₂", heart_rate: "Frequência cardíaca",
  other: "Outro",
};

const DISCLAIMER = "Documento gerado por relato do cuidador. Não é prontuário nem substitui avaliação médica.";

/** Gera o PDF do relatório — legível em preto e branco, tipografia grande, sem nenhuma interpretação clínica. */
export function generateReportPdf(data: AdherenceReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    // compress:false de propósito — mantém o texto legível nos bytes crus
    // do PDF, sem precisar de um parser de PDF só pra testar que o rodapé
    // obrigatório e a ausência de linguagem clínica realmente foram pro
    // documento (arquivo maior, mas é um relatório de texto simples).
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const addFooter = () => {
      const bottom = doc.page.height - 40;
      doc.fontSize(8).font("Helvetica-Oblique").fillColor("black")
        .text(DISCLAIMER, 50, bottom, { width: doc.page.width - 100, align: "center" });
    };

    doc.fontSize(18).font("Helvetica-Bold").text("Relatório de adesão a tratamento", { align: "left" });
    doc.moveDown(0.3);
    doc.fontSize(12).font("Helvetica").text(`Paciente: ${data.patientName}`);
    doc.text(`Período: ${data.periodStart} a ${data.periodEnd}`);
    doc.text(`Gerado em: ${data.generatedAt.toISOString().slice(0, 10)}`);
    doc.moveDown(1);

    for (const med of data.medications) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.fontSize(14).font("Helvetica-Bold").text(med.medicationName);
      doc.fontSize(11).font("Helvetica");
      /**
       * Um degrau por linha quando houve mais de uma dose — Issue #172.
       *
       * Tudo numa linha só cabe para duas; um desmame de corticoide tem
       * quatro ou cinco, e a linha vira uma tira que o médico lê torto.
       * Com uma dose só, a frase continua sendo a de sempre.
       */
      if (med.dosePeriods.length > 1) {
        doc.text("Doses no período:");
        for (const d of med.dosePeriods) {
          doc.text(`  ${d.dose} — de ${emPortugues(d.from)} a ${emPortugues(d.to)}`);
        }
      } else if (med.dose) {
        doc.text(`Dose prescrita: ${med.dose}`);
      }
      if (med.prescribedTimes.length > 0) doc.text(`Horários prescritos: ${med.prescribedTimes.join(", ")}`);
      const pct = med.adherenceRate !== null ? `${Math.round(med.adherenceRate * 100)}%` : "—";
      doc.text(`Adesão no período: ${pct}`);
      // Issue #175: as parciais em coluna propria, e so quando existem — uma
      // linha dizendo "Em parte: 0" em todo relatorio seria ruido.
      const emParte = med.partial > 0 ? `  ·  Em parte: ${med.partial}` : "";
      doc.text(`Tomadas: ${med.taken}  ·  Puladas: ${med.skipped}${emParte}  ·  Sem registro: ${med.unregistered}  ·  Total agendado: ${med.totalScheduled}`);
      if (med.actualVsPrescribed.length > 0) {
        doc.font("Helvetica-Bold").text("Padrão de horário — prescrito vs. registrado:");
        doc.font("Helvetica");
        for (const avp of med.actualVsPrescribed) {
          const sign = avp.averageDeltaMinutes >= 0 ? "+" : "";
          doc.text(`  ${avp.prescribedTime} prescrito → ${avp.averageActualTime} em média (${sign}${avp.averageDeltaMinutes} min, n=${avp.sampleSize})`);
        }
      }
      doc.moveDown(0.8);
    }

    /**
     * ── "Se precisar" — Issue #169 ────────────────────────────────────
     *
     * Seção própria, depois dos medicamentos e antes das aferições. Cada
     * uso com data, hora e o motivo que o cuidador escreveu.
     *
     * Sem percentual, sem total por semana, sem média: a página traz os
     * fatos registrados e o médico interpreta. Uma frase como "3 usos em
     * 7 dias, acima do habitual" seria o app opinando (invariante 4).
     */
    if (data.prnUses.length > 0) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.fontSize(14).font("Helvetica-Bold").text("Remédios de uso \"se necessário\"");
      doc.fontSize(10).font("Helvetica").fillColor("#444")
        .text("Não entram no cálculo de adesão: não têm horário marcado.");
      doc.fillColor("#000").fontSize(11);
      for (const uso of data.prnUses) {
        if (doc.y > doc.page.height - 80) doc.addPage();
        const quando = `${emPortugues(uso.localDate)} às ${uso.localTime}`;
        const quanto = uso.dose ? ` — ${uso.dose}` : "";
        const porque = uso.justification ? ` — "${uso.justification}"` : "";
        doc.text(`  ${quando}: ${uso.medicationName}${quanto}${porque}`);
      }
      doc.moveDown(1);
    }

    if (data.measurements.length > 0) {
      if (doc.y > doc.page.height - 200) doc.addPage();
      doc.fontSize(14).font("Helvetica-Bold").text("Aferições registradas no período");
      doc.fontSize(10).font("Helvetica");
      doc.moveDown(0.3);
      for (const m of data.measurements) {
        if (doc.y > doc.page.height - 100) doc.addPage();
        const label = MEASUREMENT_TYPE_LABELS[m.type] ?? m.type;
        const date = m.measuredAt.toISOString().slice(0, 10);
        const value = m.value ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "—";
        doc.text(`${date} — ${label}: ${value}${m.notes ? ` (${m.notes})` : ""}`);
      }
    } else {
      doc.fontSize(11).font("Helvetica-Oblique").text("Nenhuma aferição registrada no período.");
    }

    const pageCount = doc.bufferedPageRange().count;
    for (let i = 0; i < pageCount; i++) {
      doc.switchToPage(i);
      addFooter();
    }

    doc.end();
  });
}
