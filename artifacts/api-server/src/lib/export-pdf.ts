/**
 * A exportação de dados, em PDF legível — Issue #49.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * O pacote da LGPD saía como JSON cru do banco. O que a pessoa recebia era
 * `medicationId: 267` em vez do nome do remédio, `scheduledDoseId: 7227` em
 * vez de "dose das 8h de 25/08", `"outcome": "skipped"` em inglês, e datas em
 * UTC quando o paciente vive em São Paulo — três horas de diferença que fazem
 * a dose da meia-noite parecer ter sido às 3 da manhã.
 *
 * A LGPD dá direito à portabilidade **e** à transparência. Um dump com chave
 * estrangeira atende a letra e falha o espírito: a pessoa não consegue ler o
 * que é dela.
 *
 * ── O JSON continua existindo ─────────────────────────────────────────────
 *
 * Portabilidade tem duas audiências: a pessoa, que quer ler, e outro sistema,
 * que quer importar. Trocar um pelo outro perderia a segunda. Os dois links
 * são oferecidos, cada um com seu token de uso único.
 *
 * ── O que este documento NÃO faz ──────────────────────────────────────────
 *
 * Não interpreta nada (invariante 4). Sem percentual de adesão, sem "bom" ou
 * "ruim", sem faixa de referência, sem cor de risco. Ele **apresenta o que foi
 * registrado** — quem lê é quem sabe.
 *
 * E nenhum vermelho (invariante 5): o PDF é preto sobre branco, e a situação
 * de cada dose sai por PALAVRA, nunca por cor. Um documento que pode ser
 * impresso em preto e branco não pode depender de cor para nada.
 */
import PDFDocument from "pdfkit";

/** O que `POST /export` grava no snapshot. Só o que o PDF precisa ler. */
interface Snapshot {
  exportDate?: string;
  conta?: { nome?: string; email?: string; criadaEm?: string } | null;
  familia?: { nome?: string; criadaEm?: string } | null;
  cuidadores?: Array<{ nome?: string; papel?: string; ehVoce?: boolean }>;
  consentimentos?: Array<{
    tipo?: string;
    concedido?: string;
    versao?: string;
    registradoEm?: string;
  }>;
  patients?: Array<{
    name?: string;
    birthDate?: string | null;
    timezone?: string;
    notes?: string | null;
    treatments?: Array<{
      medicationId?: number;
      dose?: string | null;
      scheduleType?: string;
      scheduleConfig?: { times?: string[]; intervalHours?: number; startTime?: string };
      startDate?: string | null;
      endDate?: string | null;
      status?: string;
    }>;
    scheduledDoses?: Array<{
      id?: number;
      scheduledLocalDate?: string;
      scheduledLocalTime?: string;
      status?: string;
      dose?: string | null;
    }>;
    doseRecords?: Array<{
      scheduledDoseId?: number;
      outcome?: string;
      justification?: string | null;
      notes?: string | null;
    }>;
    appointments?: Array<{
      specialty?: string | null;
      doctorName?: string | null;
      location?: string | null;
      scheduledAt?: string;
      status?: string;
    }>;
    healthMeasurements?: Array<{
      type?: string;
      value?: string | null;
      unit?: string | null;
      measuredAt?: string;
    }>;
    momentos?: Array<{ tipo?: string; legenda?: string | null; publicadoEm?: string }>;
  }>;
  medications?: Array<{ id?: number; name?: string; form?: string | null }>;
}

/** Inglês do banco → português de gente. O que não estiver aqui sai como veio. */
const SITUACAO_DA_DOSE: Record<string, string> = {
  taken: "Tomada",
  skipped: "Pulada",
  late: "Atrasada",
  pending: "Pendente",
  postponed: "Adiada",
};

const SITUACAO_DO_TRATAMENTO: Record<string, string> = {
  active: "Em andamento",
  paused: "Pausado",
  completed: "Concluído",
  cancelled: "Cancelado",
};

const SITUACAO_DA_CONSULTA: Record<string, string> = {
  scheduled: "Marcada",
  completed: "Realizada",
  cancelled: "Cancelada",
  missed: "Não compareceu",
};

const PAPEL: Record<string, string> = {
  primary_caregiver: "Cuidador principal",
  caregiver: "Cuidador",
  hired_caregiver: "Cuidador contratado",
  observer: "Observador",
};

const CONSENTIMENTO: Record<string, string> = {
  terms_of_service: "Termos de uso",
  privacy_policy: "Política de privacidade",
  health_data_processing: "Tratamento de dados de saúde",
  marketing: "Comunicações de marketing",
  data_sharing: "Compartilhamento com terceiros",
  image_capture: "Uso de imagem",
};

const TIPO_DE_MOMENTO: Record<string, string> = {
  image: "Foto",
  video: "Vídeo",
  audio: "Recado em áudio",
};

const traduzir = (mapa: Record<string, string>, chave: string | undefined): string =>
  chave ? (mapa[chave] ?? chave) : "—";

/** ISO → "25/08/2026 às 08:00", no fuso DO PACIENTE. */
function dataHora(iso: string | undefined, timezone: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(d)
    .replace(", ", " às ");
}

/** "2026-08-25" → "25/08/2026". Data pura não tem fuso: não converter. */
function dataSimples(iso: string | null | undefined): string {
  if (!iso) return "—";
  const [ano, mes, dia] = iso.slice(0, 10).split("-");
  return dia && mes && ano ? `${dia}/${mes}/${ano}` : iso;
}

/** A posologia por extenso, a partir do `scheduleConfig`. */
function posologia(t: NonNullable<Snapshot["patients"]>[number]["treatments"] extends
  | Array<infer T>
  | undefined
  ? T
  : never): string {
  const cfg = t.scheduleConfig ?? {};
  if (t.scheduleType === "times_per_day" && cfg.times?.length) {
    return `todo dia às ${cfg.times.join(", ")}`;
  }
  if (t.scheduleType === "every_n_hours" && cfg.intervalHours) {
    const inicio = cfg.startTime ? `, a partir das ${cfg.startTime}` : "";
    return `a cada ${cfg.intervalHours} horas${inicio}`;
  }
  return t.scheduleType ?? "—";
}

const RODAPE =
  "Documento gerado pelo ZELO a pedido do titular dos dados (LGPD, art. 18). " +
  "Ele apresenta o que foi registrado no aplicativo, sem interpretação clínica.";

export function gerarPdfDaExportacao(snapshotJson: string): Promise<Buffer> {
  const dados = JSON.parse(snapshotJson) as Snapshot;

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50, bufferPages: true, compress: false });
    const pedacos: Buffer[] = [];
    doc.on("data", (c: Buffer) => pedacos.push(c));
    doc.on("end", () => resolve(Buffer.concat(pedacos)));
    doc.on("error", reject);

    const titulo = (texto: string, tamanho = 14) => {
      if (doc.y > doc.page.height - 140) doc.addPage();
      doc.moveDown(0.6);
      doc.fontSize(tamanho).font("Helvetica-Bold").fillColor("black").text(texto);
      doc.moveDown(0.2);
      doc.fontSize(11).font("Helvetica");
    };

    const linha = (texto: string) => {
      if (doc.y > doc.page.height - 90) doc.addPage();
      doc.fontSize(11).font("Helvetica").text(texto);
    };

    // ── Capa ──────────────────────────────────────────────────────────────
    doc.fontSize(20).font("Helvetica-Bold").text("Seus dados no ZELO");
    doc.moveDown(0.3);
    doc.fontSize(11).font("Helvetica");
    doc.text(`Gerado em: ${dataHora(dados.exportDate, "America/Sao_Paulo")}`);
    if (dados.conta?.nome) doc.text(`Titular: ${dados.conta.nome}`);
    if (dados.conta?.email) doc.text(`E-mail: ${dados.conta.email}`);
    if (dados.familia?.nome) doc.text(`Família: ${dados.familia.nome}`);
    doc.moveDown(0.5);
    doc.fontSize(10).font("Helvetica-Oblique").text(
      "Este documento é a versão legível da sua exportação. O mesmo conteúdo " +
        "está disponível em JSON, para importar em outro sistema."
    );

    // ── Cuidadores ────────────────────────────────────────────────────────
    if (dados.cuidadores?.length) {
      titulo("Quem cuida junto");
      for (const c of dados.cuidadores) {
        linha(`• ${c.nome ?? "—"} — ${traduzir(PAPEL, c.papel)}${c.ehVoce ? " (você)" : ""}`);
      }
    }

    // ── Consentimentos ────────────────────────────────────────────────────
    if (dados.consentimentos?.length) {
      titulo("Consentimentos que você deu");
      for (const c of dados.consentimentos) {
        const quando = dataHora(c.registradoEm, "America/Sao_Paulo");
        const valor = c.concedido === "true" ? "concedido" : "recusado";
        linha(`• ${traduzir(CONSENTIMENTO, c.tipo)}: ${valor} em ${quando} (versão ${c.versao ?? "—"})`);
      }
    }

    // ── Por paciente ──────────────────────────────────────────────────────
    const remedioPorId = new Map<number, string>();
    for (const m of dados.medications ?? []) {
      if (typeof m.id === "number") remedioPorId.set(m.id, m.name ?? "—");
    }

    for (const p of dados.patients ?? []) {
      const tz = p.timezone ?? "America/Sao_Paulo";
      doc.addPage();
      doc.fontSize(17).font("Helvetica-Bold").text(p.name ?? "Paciente");
      doc.fontSize(11).font("Helvetica");
      if (p.birthDate) doc.text(`Nascimento: ${dataSimples(p.birthDate)}`);
      doc.text(`Fuso horário: ${tz}`);
      if (p.notes) doc.text(`Observações: ${p.notes}`);

      // Tratamentos
      titulo("Tratamentos");
      if (!p.treatments?.length) {
        linha("Nenhum tratamento registrado.");
      } else {
        for (const t of p.treatments) {
          const remedio =
            typeof t.medicationId === "number"
              ? (remedioPorId.get(t.medicationId) ?? `Medicamento ${t.medicationId}`)
              : "—";
          linha(`• ${remedio}${t.dose ? ` — ${t.dose}` : ""}`);
          linha(`    ${posologia(t)}`);
          const fim = t.endDate ? ` até ${dataSimples(t.endDate)}` : "";
          linha(
            `    de ${dataSimples(t.startDate)}${fim} · ${traduzir(SITUACAO_DO_TRATAMENTO, t.status)}`
          );
        }
      }

      // Doses — a parte que o JSON tornava ilegível
      titulo("Doses");
      const registroPorDose = new Map<number, { outcome?: string; justification?: string | null }>();
      for (const r of p.doseRecords ?? []) {
        if (typeof r.scheduledDoseId === "number") registroPorDose.set(r.scheduledDoseId, r);
      }

      if (!p.scheduledDoses?.length) {
        linha("Nenhuma dose registrada.");
      } else {
        // Do mais recente para o mais antigo: é o que se procura primeiro.
        const ordenadas = [...p.scheduledDoses].sort((a, b) =>
          `${b.scheduledLocalDate ?? ""}${b.scheduledLocalTime ?? ""}`.localeCompare(
            `${a.scheduledLocalDate ?? ""}${a.scheduledLocalTime ?? ""}`
          )
        );
        for (const d of ordenadas) {
          const reg = typeof d.id === "number" ? registroPorDose.get(d.id) : undefined;
          const situacao = traduzir(SITUACAO_DA_DOSE, reg?.outcome ?? d.status);
          const porque = reg?.justification ? ` — "${reg.justification}"` : "";
          linha(
            `${dataSimples(d.scheduledLocalDate)} às ${d.scheduledLocalTime ?? "—"} · ` +
              `${situacao}${d.dose ? ` · ${d.dose}` : ""}${porque}`
          );
        }
      }

      // Consultas
      titulo("Consultas");
      if (!p.appointments?.length) {
        linha("Nenhuma consulta registrada.");
      } else {
        for (const a of p.appointments) {
          linha(
            `${dataHora(a.scheduledAt, tz)} · ${a.specialty ?? "—"}` +
              `${a.doctorName ? ` com ${a.doctorName}` : ""} · ${traduzir(SITUACAO_DA_CONSULTA, a.status)}`
          );
          if (a.location) linha(`    ${a.location}`);
        }
      }

      // Aferições
      titulo("Aferições");
      if (!p.healthMeasurements?.length) {
        linha("Nenhuma aferição registrada.");
      } else {
        for (const m of p.healthMeasurements) {
          const valor = m.value ? `${m.value}${m.unit ? ` ${m.unit}` : ""}` : "—";
          linha(`${dataHora(m.measuredAt, tz)} · ${m.type ?? "—"}: ${valor}`);
        }
      }

      // Momentos
      titulo("Momentos");
      if (!p.momentos?.length) {
        linha("Nenhum momento registrado.");
      } else {
        linha(
          "As fotos e áudios não vão dentro deste documento — aqui está o registro " +
            "do que existe, com data e legenda."
        );
        doc.moveDown(0.2);
        for (const m of p.momentos) {
          linha(
            `${dataHora(m.publicadoEm, tz)} · ${traduzir(TIPO_DE_MOMENTO, m.tipo)}` +
              `${m.legenda ? ` — "${m.legenda}"` : ""}`
          );
        }
      }
    }

    // Rodapé em todas as páginas, e não só na última.
    const paginas = doc.bufferedPageRange().count;
    for (let i = 0; i < paginas; i++) {
      doc.switchToPage(i);
      doc
        .fontSize(8)
        .font("Helvetica-Oblique")
        .fillColor("black")
        .text(RODAPE, 50, doc.page.height - 40, {
          width: doc.page.width - 100,
          align: "center",
        });
    }

    doc.end();
  });
}
