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
import { eq, and, gte, lte } from "drizzle-orm";
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

export interface MedicationReportRow {
  medicationId: number;
  medicationName: string;
  dose: string | null;
  prescribedTimes: string[];
  totalScheduled: number;
  taken: number;
  skipped: number; // inclui "postponed" — ver nota no topo do arquivo
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
  measurements: MeasurementRow[];
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
      dose: treatmentsTable.dose,
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
      lte(scheduledDosesTable.scheduledAt, end)
    ));

  const byMedication = new Map<number, {
    medicationName: string; dose: string | null;
    prescribedTimes: Set<string>;
    total: number; taken: number; skipped: number; unregistered: number;
    actualByPrescribedTime: Map<string, string[]>; // prescribedTime -> lista de horários reais (HH:mm, tomadas)
  }>();

  for (const row of rows) {
    let entry = byMedication.get(row.medicationId);
    if (!entry) {
      entry = {
        medicationName: row.medicationName, dose: row.dose,
        prescribedTimes: new Set(), total: 0, taken: 0, skipped: 0, unregistered: 0,
        actualByPrescribedTime: new Map(),
      };
      byMedication.set(row.medicationId, entry);
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
    return {
      medicationId, medicationName: e.medicationName, dose: e.dose,
      prescribedTimes,
      totalScheduled: e.total, taken: e.taken, skipped: e.skipped, unregistered: e.unregistered,
      adherenceRate: e.total > 0 ? e.taken / e.total : null,
      actualVsPrescribed,
    };
  });
  medications.sort((a, b) => a.medicationId - b.medicationId);

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
      if (med.dose) doc.text(`Dose prescrita: ${med.dose}`);
      if (med.prescribedTimes.length > 0) doc.text(`Horários prescritos: ${med.prescribedTimes.join(", ")}`);
      const pct = med.adherenceRate !== null ? `${Math.round(med.adherenceRate * 100)}%` : "—";
      doc.text(`Adesão no período: ${pct}`);
      doc.text(`Tomadas: ${med.taken}  ·  Puladas: ${med.skipped}  ·  Sem registro: ${med.unregistered}  ·  Total agendado: ${med.totalScheduled}`);
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
