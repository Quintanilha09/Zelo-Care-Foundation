/**
 * Formulário de tratamento — ZELO.
 * Os 5 padrões de posologia da spec, mais a pré-visualização das próximas
 * doses antes de salvar — é a checagem que impede posologia errada virar
 * dose errada. Nenhum campo sugere, calcula ou valida quantidade de dose.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { CampoLabel } from "@/components/campo-label";
import { CampoNumero } from "@/components/campo-numero";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { authFetch } from "@/lib/auth-client";
import { X, Plus, CalendarCheck, Camera, AlertTriangle } from "lucide-react";

// Abaixo disso, o campo pré-preenchido pela foto some — a spec é clara:
// nunca preencher chute silenciosamente, confiança baixa força o cuidador
// a digitar (o campo fica vazio e destacado, não errado e escondido).
const CONFIDENCE_THRESHOLD = 0.6;

interface ScheduleGuess {
  type: "times_per_day" | "every_n_hours" | null;
  intervalHours: number | null;
  timesPerDay: number | null;
  durationDays: number | null;
}
interface ExtractedFields {
  name: string | null;
  concentration: string | null;
  form: string | null;
  posologyText: string | null;
  scheduleGuess: ScheduleGuess;
}
interface ExtractionConfidence {
  name: number; concentration: number; form: number; posologyText: number; scheduleGuess: number;
}

type ScheduleType = "times_per_day" | "every_n_hours" | "specific_weekdays" | "alternate_days" | "cycle_with_pause" | "se_necessario";

/**
 * O "se precisar" não tem agenda, e por isso some da metade do formulário.
 *
 * Issue #169. Quantidade de doses (#173), desmame (#172), pré-visualização
 * das próximas doses e escalonamento de lembrete são todos perguntas sobre
 * uma AGENDA. Mostrá-los para um remédio que não tem hora marcada seria
 * oferecer controles que não fazem nada — e o formulário de tratamento já
 * é a tela de maior atrito do app.
 */
function temAgenda(tipo: ScheduleType): boolean {
  return tipo !== "se_necessario";
}

const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  times_per_day: "Vezes ao dia, em horários fixos",
  every_n_hours: "A cada X horas",
  specific_weekdays: "Dias específicos da semana",
  alternate_days: "Dias alternados",
  cycle_with_pause: "Ciclo com pausa",
  // Issue #169: o sexto não responde "quando tomar" — responde "tomar
  // se". Por isso o rótulo diz "sem hora marcada" em vez de descrever um
  // padrão de relógio que ele não tem.
  se_necessario: "Se precisar (sem hora marcada)",
};

// ZELO-30: controla até onde vai a cascata de lembrete quando ninguém
// registra a dose (dose-reminders.ts) — "padrão" cobre a imensa maioria dos
// tratamentos, os outros dois são exceção deliberada.
type EscalationProfile = "silent" | "standard" | "critical";

const ESCALATION_PROFILE_LABELS: Record<EscalationProfile, string> = {
  silent: "Silencioso — só o cuidador principal, nunca chama mais gente",
  standard: "Padrão — chama os outros cuidadores se ninguém confirmar (não de madrugada)",
  critical: "Crítico — chama os outros cuidadores mesmo de madrugada",
};

// Só usado quando a foto diz "N vezes ao dia" sem os horários exatos do
// relógio (a receita raramente diz isso) — um ponto de partida razoável e
// facilmente ajustável, nunca uma dose ou intervalo inventado.
const DEFAULT_TIMES_BY_COUNT: Record<number, string[]> = {
  1: ["08:00"], 2: ["08:00", "20:00"], 3: ["08:00", "14:00", "20:00"], 4: ["06:00", "12:00", "18:00", "00:00"],
};
function defaultTimesForCount(n: number): string[] {
  if (DEFAULT_TIMES_BY_COUNT[n]) return DEFAULT_TIMES_BY_COUNT[n];
  const stepMin = (24 * 60) / n;
  return Array.from({ length: n }, (_, i) => {
    const total = Math.round((8 * 60 + i * stepMin) % (24 * 60));
    return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`;
  });
}
function addDaysToDate(dateISO: string, days: number): string {
  const d = new Date(`${dateISO}T00:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

const WEEKDAYS = [
  { value: 0, label: "Dom" }, { value: 1, label: "Seg" }, { value: 2, label: "Ter" },
  { value: 3, label: "Qua" }, { value: 4, label: "Qui" }, { value: 5, label: "Sex" }, { value: 6, label: "Sáb" },
];

/**
 * A lista de horários — e, quando a receita pede, a dose de cada um.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * "1 COMPRIMIDO DE MANHÃ E 2 À NOITE" — Issue #171.
 *
 * Não cabia: a dose era um texto só para o tratamento inteiro. O contorno
 * era cadastrar o mesmo remédio duas vezes, e aí a ficha mostrava dois
 * tratamentos para uma receita só.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── Fechado por padrão, e o motivo é medido em atrito ───────────────
 *
 * A maioria das receitas é uma dose só. Este formulário já é a tela de
 * maior atrito do app — um campo a mais por horário, sempre visível,
 * cobraria de todo mundo o preço de um caso que é minoria.
 */
function TimesList({
  times,
  onChange,
  dosePorHorario,
  onDoseChange,
}: {
  times: string[];
  onChange: (t: string[]) => void;
  dosePorHorario: Record<string, string>;
  onDoseChange: (mapa: Record<string, string>) => void;
}) {
  const [porHorario, setPorHorario] = useState(Object.keys(dosePorHorario).length > 0);

  return (
    <div className="space-y-2">
      <CampoLabel obrigatorio>Horários</CampoLabel>
      {times.map((t, i) => (
        <div key={i} className="space-y-1">
          <div className="flex gap-2">
            <Input
              type="time"
              value={t}
              onChange={(e) => onChange(times.map((x, j) => (j === i ? e.target.value : x)))}
            />
            {times.length > 1 && (
              <Button type="button" variant="ghost" size="icon" onClick={() => onChange(times.filter((_, j) => j !== i))}>
                <X className="w-4 h-4" />
              </Button>
            )}
          </div>
          {porHorario && (
            <Input
              aria-label={`Dose das ${t}`}
              placeholder="Dose deste horário (ex: 2 comprimidos)"
              value={dosePorHorario[t] ?? ""}
              maxLength={120}
              onChange={(e) => {
                const mapa = { ...dosePorHorario };
                // Campo vazio significa 'use a dose do tratamento', e não
                // 'a dose deste horário é vazia'. Por isso apaga a chave.
                if (e.target.value.trim()) mapa[t] = e.target.value;
                else delete mapa[t];
                onDoseChange(mapa);
              }}
            />
          )}
        </div>
      ))}
      {!porHorario ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={() => setPorHorario(true)}
        >
          A dose muda ao longo do dia
        </button>
      ) : (
        <p className="text-xs text-muted-foreground">
          Horário em branco usa a dose do tratamento.
        </p>
      )}
      <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => onChange([...times, "08:00"])}>
        <Plus className="w-3.5 h-3.5" /> Adicionar horário
      </Button>
    </div>
  );
}

/**
 * Tratamento vindo de `GET /patients/:id/treatments`, para o modo de edição.
 * Só os campos que o formulário sabe preencher — o resto da lista é ignorado.
 */
export interface TratamentoParaEditar {
  id: number;
  medicationName: string;
  dose: string | null;
  scheduleConfig: unknown;
  startDate: string;
  endDate: string | null;
  instructions: string | null;
  escalationProfile: string | null;
}

interface TreatmentFormProps {
  patientId: number;
  onCreated: () => void;
  onCancel: () => void;
  /** Presente = modo edição. Ausente = criação. */
  tratamento?: TratamentoParaEditar;
}

export function TreatmentForm({ patientId, onCreated, onCancel, tratamento }: TreatmentFormProps) {
  const editando = tratamento !== undefined;

  /**
   * Lê o scheduleConfig salvo, que vem do banco como JSON solto.
   * Cada padrão de posologia guarda campos diferentes, então o acesso é
   * defensivo: um tratamento antigo pode não ter tudo que a versão atual usa.
   */
  const cfg = (tratamento?.scheduleConfig ?? {}) as {
    scheduleType?: ScheduleType;
    times?: string[];
    intervalHours?: number;
    startTime?: string;
    weekdays?: number[];
    onDays?: number;
    offDays?: number;
    /** Issue #169: o que a receita diz do "se necessário". Só para mostrar. */
    intervaloMinimoHoras?: number;
    tetoDiario?: number;
    /** Issue #171: horário → dose. Ausente nos tratamentos anteriores a ela. */
    dosePorHorario?: Record<string, string>;
    /** Issue #172: os degraus de um desmame, em ordem. */
    degraus?: Array<{ dose: string; dias: number }>;
  };
  const [medicationName, setMedicationName] = useState(tratamento?.medicationName ?? "");
  const [dose, setDose] = useState(tratamento?.dose ?? "");
  const [instructions, setInstructions] = useState(tratamento?.instructions ?? "");
  const [scheduleType, setScheduleType] = useState<ScheduleType>(cfg.scheduleType ?? "times_per_day");
  const [startDate, setStartDate] = useState(tratamento?.startDate ?? (() => new Date().toISOString().slice(0, 10))());
  const [endDate, setEndDate] = useState(tratamento?.endDate ?? "");
  /**
   * Quantas doses ao todo — Issue #173.
   *
   * Boa parte da receita brasileira é por quantidade: *tomar os 21
   * comprimidos*, *1 caixa*. Quem cadastra fazia a conta de cabeça, e
   * errar por um dia significa uma dose a mais ou a menos no fim do
   * antibiótico.
   *
   * Isto NÃO vira um campo do tratamento: ele continua acabando por DATA.
   * O que muda é o caminho até ela — o app faz a conta, mostra o
   * resultado, e o que se salva é a data como sempre foi.
   */
  const [quantidadeDeDoses, setQuantidadeDeDoses] = useState("");
  const [porQuantidade, setPorQuantidade] = useState(false);
  const [calculandoFim, setCalculandoFim] = useState(false);
  const [erroDaQuantidade, setErroDaQuantidade] = useState("");
  const [escalationProfile, setEscalationProfile] = useState<EscalationProfile>((tratamento?.escalationProfile as EscalationProfile) ?? "standard");

  // ZELO-34: opcional de propósito — sem estoque informado, o app nunca
  // insiste; sem quantidade, não tenta calcular dias restantes de coisa nenhuma.
  const [trackStock, setTrackStock] = useState(false);
  const [stockQuantity, setStockQuantity] = useState("");
  const [stockUnit, setStockUnit] = useState("comprimidos");
  const [prescriptionExpiresAt, setPrescriptionExpiresAt] = useState("");

  const [times, setTimes] = useState(cfg.times ?? ["08:00"]);
  /**
   * A dose de cada horário — Issue #171.
   *
   * Mapa ao lado de `times`, e não dentro dele: `times` é lido pela
   * expansão de agenda do servidor, que não sabe nada de dose. Mexer na
   * forma dele obrigaria a mexer na peça mais delicada do app.
   *
   * Vazio = a dose do tratamento vale para todos os horários, como sempre.
   */
  const [dosePorHorario, setDosePorHorario] = useState<Record<string, string>>(
    cfg.dosePorHorario ?? {},
  );
  /**
   * Os degraus do desmame — Issue #172.
   *
   * "40mg por 5 dias, 20mg por 5, 10mg por 5, depois para." Antes disto
   * era preciso criar quatro tratamentos e encerrar cada um à mão, e
   * cada transição era uma chance de esquecer.
   *
   * Vazio = tratamento de dose única, que é a esmagadora maioria.
   */
  const [degraus, setDegraus] = useState<Array<{ dose: string; dias: number }>>(
    cfg.degraus ?? [],
  );
  const [intervalHours, setIntervalHours] = useState(cfg.intervalHours ?? 8);
  const [everyNStartTime, setEveryNStartTime] = useState(cfg.startTime ?? "08:00");
  const [weekdays, setWeekdays] = useState<number[]>(cfg.weekdays ?? [1, 3, 5]);
  const [onDays, setOnDays] = useState(cfg.onDays ?? 21);
  /**
   * O que a receita diz sobre o "se necessário" — Issue #169.
   *
   * ═══════════════════════════════════════════════════════════════════
   * OS DOIS SÃO PARA MOSTRAR, E NUNCA PARA DECIDIR.
   *
   * "A cada 6 h se precisar, no máximo 4 por dia" vem da receita e é
   * digitado aqui. Na hora de registrar, o app mostra isto ao lado de
   * "a última foi às 14:20" e "já foram 2 hoje" — e para por aí.
   *
   * O app não compara, não bloqueia e não diz "ainda não pode dar".
   * Isso seria prescrever, e o invariante 4 proíbe: quem interpreta é o
   * médico, com o cuidador ao lado da pessoa.
   * ═══════════════════════════════════════════════════════════════════
   */
  const [intervaloMinimoHoras, setIntervaloMinimoHoras] = useState(String(cfg.intervaloMinimoHoras ?? ""));
  const [tetoDiario, setTetoDiario] = useState(String(cfg.tetoDiario ?? ""));
  const [offDays, setOffDays] = useState(cfg.offDays ?? 7);

  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  /**
   * O aviso da Issue #174, aberto entre apertar Salvar e salvar de verdade.
   *
   * `null` = nada a avisar, e aí o salvamento segue direto. É o caso da
   * criação e o de toda edição que não mexe na agenda.
   */
  const [aviso, setAviso] = useState<{ canceladas: number; proximas: string[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Cadastro por foto (ZELO-21) — sempre opcional e aditivo: os campos
  // manuais acima continuam disponíveis e funcionam sozinhos, com ou sem foto.
  const [photoPreviewUrl, setPhotoPreviewUrl] = useState<string | null>(null);
  const [photoExtractionId, setPhotoExtractionId] = useState<number | null>(null);
  const [photoExtracting, setPhotoExtracting] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [lowConfidenceFields, setLowConfidenceFields] = useState<Set<string>>(new Set());
  const [posologyHint, setPosologyHint] = useState<string | null>(null);
  const [retainPhoto, setRetainPhoto] = useState(false);
  const [scheduleGuessApplied, setScheduleGuessApplied] = useState(false);

  function buildScheduleConfig() {
    /**
     * Só manda o mapa quando ele tem algo, e só para os tipos que têm
     * lista de horários — Issue #171.
     *
     * `every_n_hours` fica de fora: ali os horários são calculados a partir
     * de um intervalo, e não existem como lista para amarrar uma dose. Um
     * mapa lá seria um campo que nunca casa com nada.
     */
    const comDose = Object.keys(dosePorHorario).length > 0 ? { dosePorHorario } : {};
    /**
     * Um degrau só não é desmame — é um tratamento normal, e gravar isso
     * criaria uma estrutura que não descreve nada. Degrau com dose vazia
     * também fica de fora: dose em branco geraria dose em branco.
     */
    const comDegraus =
      degraus.length > 1 && degraus.every((d) => d.dose.trim() && d.dias > 0)
        ? { degraus: degraus.map((d) => ({ dose: d.dose.trim(), dias: d.dias })) }
        : {};
    switch (scheduleType) {
      case "times_per_day":
        return { scheduleType, times, ...comDose, ...comDegraus };
      case "every_n_hours":
        return { scheduleType, intervalHours, startTime: everyNStartTime };
      case "specific_weekdays":
        return { scheduleType, weekdays, times, ...comDose, ...comDegraus };
      case "alternate_days":
        return { scheduleType, times, startDate, ...comDose, ...comDegraus };
      case "cycle_with_pause":
        return { scheduleType, onDays, offDays, times, ...comDose, ...comDegraus };
      /**
       * Sem `times`, e isso é o ponto inteiro — Issue #169.
       *
       * Nada de dose por horário nem de degrau aqui: os dois falam de uma
       * agenda, e este tipo não tem uma. Mandá-los seria gravar um campo
       * que nada lê.
       *
       * Campo em branco vira ausência, e não zero: a receita que não diz
       * intervalo mínimo não tem intervalo mínimo, e um `0` ali seria o
       * app inventando um número que ninguém prescreveu.
       */
      case "se_necessario":
        return {
          scheduleType,
          ...(intervaloMinimoHoras ? { intervaloMinimoHoras: Number(intervaloMinimoHoras) } : {}),
          ...(tetoDiario ? { tetoDiario: Number(tetoDiario) } : {}),
        };
    }
  }

  const handlePhotoSelect = async (file: File) => {
    setPhotoError("");
    setPhotoPreviewUrl(URL.createObjectURL(file));
    setPhotoExtracting(true);
    setLowConfidenceFields(new Set());
    setPosologyHint(null);

    try {
      const formData = new FormData();
      formData.append("photo", file);
      const res = await authFetch("/api/medication-photos/extract", { method: "POST", body: formData });

      if (!res.ok) {
        // Foto ilegível ou falha de API: mensagem calma, formulário manual
        // continua do jeito que já estava — nada do que foi digitado se perde.
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setPhotoError(data.error ?? "Não conseguimos ler essa foto. Pode preencher manualmente.");
        setPhotoExtracting(false);
        return;
      }

      const data = (await res.json()) as { extractionId: number; fields: ExtractedFields; confidence: ExtractionConfidence };
      setPhotoExtractionId(data.extractionId);

      const lowConf = new Set<string>();
      if (data.confidence.name >= CONFIDENCE_THRESHOLD && data.fields.name) {
        setMedicationName(data.fields.name);
      } else if (data.fields.name || data.confidence.name < CONFIDENCE_THRESHOLD) {
        lowConf.add("name");
      }

      const doseParts = [data.confidence.concentration >= CONFIDENCE_THRESHOLD ? data.fields.concentration : null,
        data.confidence.form >= CONFIDENCE_THRESHOLD ? data.fields.form : null].filter(Boolean);
      if (doseParts.length > 0) setDose(doseParts.join(" "));
      if (data.confidence.concentration < CONFIDENCE_THRESHOLD) lowConf.add("concentration");
      if (data.confidence.form < CONFIDENCE_THRESHOLD) lowConf.add("form");

      setLowConfidenceFields(lowConf);
      if (data.fields.posologyText) setPosologyHint(data.fields.posologyText);

      // Quando a receita ESCREVE o intervalo/frequência/duração, isso já é
      // extração — pré-seleciona o padrão certo pra poupar o cuidador de
      // calcular horário na mão. Confiança baixa (ou nada escrito) deixa os
      // padrões manuais de sempre intactos, sem chute.
      const guess = data.fields.scheduleGuess;
      if (data.confidence.scheduleGuess >= CONFIDENCE_THRESHOLD && guess?.type) {
        if (guess.type === "every_n_hours" && guess.intervalHours) {
          setScheduleType("every_n_hours");
          setIntervalHours(guess.intervalHours);
        } else if (guess.type === "times_per_day" && guess.timesPerDay) {
          setScheduleType("times_per_day");
          setTimes(defaultTimesForCount(guess.timesPerDay));
        }
        if (guess.durationDays) {
          setEndDate(addDaysToDate(startDate, guess.durationDays - 1));
        }
        setScheduleGuessApplied(true);
      }
    } catch {
      setPhotoError("Não conseguimos ler essa foto. Pode preencher manualmente.");
    } finally {
      setPhotoExtracting(false);
    }
  };

  const handleRemovePhoto = () => {
    if (photoExtractionId) {
      void authFetch(`/api/medication-photos/${photoExtractionId}/discard`, { method: "POST" });
    }
    setPhotoPreviewUrl(null);
    setPhotoExtractionId(null);
    setPhotoError("");
    setLowConfidenceFields(new Set());
    setPosologyHint(null);
    setRetainPhoto(false);
    setScheduleGuessApplied(false);
  };

  /**
   * Pergunta ao servidor em que dia a última dose cai — Issue #173.
   *
   * Quem calcula é ele, com a MESMA expansão que gera as doses: ela
   * conhece dia alternado, ciclo com pausa e dia da semana. Refazer a
   * conta aqui criaria dois donos dela, e um dia a tela prometeria uma
   * data e o banco geraria outra.
   */
  const calcularOFim = async () => {
    const n = Number(quantidadeDeDoses);
    if (!n || n <= 0) return;
    setCalculandoFim(true);
    setErroDaQuantidade("");
    try {
      const res = await authFetch(`/api/patients/${patientId}/treatments/preview`, {
        method: "POST",
        body: JSON.stringify({
          scheduleConfig: buildScheduleConfig(),
          startDate,
          quantidadeDeDoses: n,
        }),
      });
      if (!res.ok) {
        const erro = (await res.json().catch(() => ({}))) as { error?: string };
        setErroDaQuantidade(erro.error ?? "Não deu para calcular agora.");
        return;
      }
      const dados = (await res.json()) as { fimPelaQuantidade: string | null };
      if (!dados.fimPelaQuantidade) {
        // A janela de dois anos não alcançou a última dose: a posologia é
        // esparsa demais para essa quantidade. Dizer isso é melhor que
        // preencher uma data errada.
        setErroDaQuantidade("Essa quantidade passa de dois anos com esta posologia. Prefira informar a data de fim.");
        return;
      }
      setEndDate(dados.fimPelaQuantidade);
      setPreview(null);
    } catch {
      setErroDaQuantidade("Sem conexão agora.");
    } finally {
      setCalculandoFim(false);
    }
  };

  const handlePreview = async () => {
    setPreviewLoading(true);
    setError("");
    setPreview(null);
    try {
      const res = await authFetch(`/api/patients/${patientId}/treatments/preview`, {
        method: "POST",
        body: JSON.stringify({
          scheduleConfig: buildScheduleConfig(),
          startDate,
          endDate: endDate || undefined,
          // #174: só na edição existe algo para cancelar.
          ...(editando ? { treatmentId: tratamento.id } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao gerar pré-visualização");
      }
      const data = (await res.json()) as { inPortuguese: string[] };
      setPreview(data.inPortuguese);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setPreviewLoading(false);
    }
  };

  /**
   * A edição mexeu na agenda? — Issue #174.
   *
   * Só a posologia e as datas fazem o servidor apagar e regerar doses (ver
   * o `scheduleChanged` do PATCH em `routes/treatments.ts`). Mudar
   * instruções, dose ou perfil de escalonamento não mexe em dose nenhuma —
   * e avisar ali seria assustar à toa.
   */
  /**
   * Quantos dias o desmame dura, e em que dia ele termina — Issue #172.
   *
   * Soma o que a pessoa digitou, e nada além disso. O app NÃO sugere o
   * desenho do desmame nem opina sobre ele: quem decide os degraus é o
   * médico, e aqui se transcreve (invariante 4). Somar dias é aritmética
   * do que já está na tela, não interpretação de receita.
   */
  const diasDoDesmame = degraus.reduce((total, d) => total + (d.dias || 0), 0);
  const fimDoDesmame = (): string => {
    // Data civil em UTC de propósito: `startDate` é "YYYY-MM-DD" sem hora,
    // e interpretá-la no fuso do navegador faria a conta pular um dia.
    const inicio = Date.parse(`${startDate}T00:00:00Z`);
    if (Number.isNaN(inicio) || diasDoDesmame < 1) return "";
    return new Date(inicio + (diasDoDesmame - 1) * 86_400_000).toISOString().slice(0, 10);
  };
  // "2026-09-30" → "30/09/2026". Troca de posição de texto, sem passar
  // por Date: construir uma data aqui só para formatá-la é o caminho
  // clássico de perder um dia na virada de fuso.
  const emPortugues = (iso: string) => iso.split("-").reverse().join("/");

  const mexeuNaAgenda = (): boolean => {
    if (!editando) return false;
    const antes = JSON.stringify(tratamento.scheduleConfig ?? {});
    const agora = JSON.stringify(buildScheduleConfig());
    return (
      antes !== agora ||
      startDate !== tratamento.startDate ||
      (endDate || null) !== (tratamento.endDate || null)
    );
  };

  /**
   * Pergunta ao servidor o que a mudança vai fazer, e abre o aviso.
   *
   * Quem conta é o servidor, com a MESMA consulta que o PATCH usa para
   * apagar. Contar aqui, no navegador, criaria dois donos do mesmo número —
   * e um dia eles discordariam, com o aviso dizendo um e o banco fazendo
   * outro. Aviso errado é pior que nenhum aviso.
   */
  const pedirOAviso = async (): Promise<boolean> => {
    try {
      const res = await authFetch(`/api/patients/${patientId}/treatments/preview`, {
        method: "POST",
        body: JSON.stringify({
          scheduleConfig: buildScheduleConfig(),
          startDate,
          endDate: endDate || undefined,
          treatmentId: tratamento!.id,
        }),
      });
      if (!res.ok) return false;
      const dados = (await res.json()) as {
        inPortuguese: string[];
        dosesQueSeraoCanceladas: number | null;
      };
      // Nada pendente para apagar: não há o que avisar, e uma caixa dizendo
      // "isto cancela 0 doses" só atrasaria quem está salvando.
      if (!dados.dosesQueSeraoCanceladas) return false;
      setAviso({ canceladas: dados.dosesQueSeraoCanceladas, proximas: dados.inPortuguese });
      return true;
    } catch {
      // Sem rede, o aviso não sai — mas salvar continua possível. Bloquear a
      // edição por causa de um aviso seria trocar um incômodo por um bloqueio.
      return false;
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicationName.trim()) {
      // Nada de `return` mudo: apertar Salvar e não acontecer nada é
      // indistinguível de app quebrado.
      setError("Informe o nome do medicamento.");
      return;
    }
    // #174: na edição que mexe na agenda, o aviso vem ANTES de salvar. Uma
    // vez só — com o aviso já aberto, apertar "Salvar assim" cai direto no
    // salvamento.
    if (editando && aviso === null && mexeuNaAgenda()) {
      setLoading(true);
      const perguntou = await pedirOAviso();
      setLoading(false);
      if (perguntou) return;
    }

    setLoading(true);
    setError("");
    try {
      // ── EDIÇÃO ───────────────────────────────────────────────────────
      // Só o que o cuidador pode corrigir: posologia, datas, instruções e
      // perfil de escalonamento. O MEDICAMENTO não muda aqui — trocar o
      // remédio de um tratamento em andamento não é edição, é outro
      // tratamento, e as doses já geradas ficariam órfãs do que foi tomado.
      if (editando) {
        const res = await authFetch(`/api/treatments/${tratamento.id}`, {
          method: "PATCH",
          body: JSON.stringify({
            dose: dose.trim() || null,
            scheduleConfig: buildScheduleConfig(),
            startDate,
            endDate: endDate || null,
            instructions: instructions.trim() || null,
            escalationProfile,
          }),
        });
        if (!res.ok) {
          const erro = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(erro.error ?? "Não foi possível salvar as mudanças.");
        }
        onCreated();
        return;
      }

      // ── CRIAÇÃO ──────────────────────────────────────────────────────
      const medRes = await authFetch("/api/medications", {
        method: "POST",
        body: JSON.stringify({ name: medicationName.trim() }),
      });
      if (!medRes.ok) {
        // A mensagem fixa que estava aqui descartava a resposta do servidor.
        // Quem batia no limite de 3 medicamentos do plano gratuito via
        // "Erro ao registrar medicamento" — sem saber que era limite de plano,
        // e sem nada a fazer a respeito.
        const erro = (await medRes.json().catch(() => ({}))) as { error?: string; code?: string };
        throw new Error(erro.error ?? "Não foi possível registrar o medicamento.");
      }
      const medication = (await medRes.json()) as { id: number };

      const res = await authFetch(`/api/patients/${patientId}/treatments`, {
        method: "POST",
        body: JSON.stringify({
          medicationId: medication.id,
          dose: dose.trim() || undefined,
          scheduleConfig: buildScheduleConfig(),
          startDate,
          endDate: endDate || undefined,
          instructions: instructions.trim() || undefined,
          escalationProfile,
          ...(trackStock && stockQuantity
            ? { initialStock: { quantity: Number(stockQuantity), unit: stockUnit, prescriptionExpiresAt: prescriptionExpiresAt || undefined } }
            : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao cadastrar tratamento");
      }

      // Registra o que o cuidador de fato manteve/corrigiu — só pra calibrar
      // a taxa de acerto por campo depois. Nunca cria nada por si só.
      if (photoExtractionId) {
        void authFetch(`/api/medication-photos/${photoExtractionId}/confirm`, {
          method: "POST",
          body: JSON.stringify({
            confirmedFields: {
              name: medicationName.trim(), concentration: null, form: null, posologyText: posologyHint,
              scheduleType,
              intervalHours: scheduleType === "every_n_hours" ? intervalHours : null,
              timesPerDay: scheduleType === "times_per_day" ? times.length : null,
              durationDays: endDate
                ? Math.round((new Date(`${endDate}T00:00:00`).getTime() - new Date(`${startDate}T00:00:00`).getTime()) / 86_400_000) + 1
                : null,
            },
            retainPhoto,
          }),
        });
      }

      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {/* Cadastro por foto só existe na CRIAÇÃO: reextrair a receita de um
          tratamento em andamento sobrescreveria o que o cuidador já corrigiu. */}
      {!editando && (
      <div className="rounded-lg border border-dashed p-4 space-y-3">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <Label htmlFor="tf-photo" className="flex items-center gap-2 cursor-pointer text-[17px] font-medium min-w-0">
            <Camera className="w-4 h-4 shrink-0" /> <span>Cadastrar por foto da caixa ou da receita (opcional)</span>
          </Label>
          <input
            id="tf-photo"
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void handlePhotoSelect(f); e.target.value = ""; }}
          />
          {!photoPreviewUrl && (
            <Button type="button" variant="outline" size="sm" onClick={() => document.getElementById("tf-photo")?.click()}>
              Escolher foto
            </Button>
          )}
        </div>

        {photoPreviewUrl && (
          <div className="flex items-start gap-3">
            <img src={photoPreviewUrl} alt="Foto do medicamento" className="w-24 h-24 object-cover rounded-lg border shrink-0" />
            {/* Issue #88: o texto lido da receita vem da foto e nao tem
                forma garantida - sem `min-w-0` ele empurra a miniatura. */}
            <div className="flex-1 min-w-0 space-y-2">
              {photoExtracting && <p className="text-sm text-muted-foreground">Lendo a foto…</p>}
              {!photoExtracting && posologyHint && (
                <p className="text-sm text-muted-foreground">Texto da receita: <span className="italic">"{posologyHint}"</span></p>
              )}
              <Button type="button" variant="ghost" size="sm" className="gap-1 h-auto p-0 text-muted-foreground" onClick={handleRemovePhoto}>
                <X className="w-3.5 h-3.5" /> Remover foto / prefiro digitar
              </Button>
              {!photoExtracting && photoExtractionId && (
                <label className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <Checkbox checked={retainPhoto} onCheckedChange={(c) => setRetainPhoto(c === true)} />
                  Guardar esta foto (por padrão, ela é descartada depois de salvar)
                </label>
              )}
            </div>
          </div>
        )}

        {photoError && (
          <p className="text-sm text-zelo-amber-fg flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> {photoError}</p>
        )}
      </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2 col-span-2">
          <CampoLabel htmlFor="tf-med" obrigatorio>Medicamento</CampoLabel>
          {/* Ao editar, o medicamento não muda: trocar o remédio de um
              tratamento em andamento não é edição, é outro tratamento — e as
              doses já registradas ficariam penduradas no remédio errado. */}
          <Input
            id="tf-med"
            value={medicationName}
            onChange={(e) => setMedicationName(e.target.value)}
            required
            autoFocus={!editando}
            readOnly={editando}
            className={editando ? "bg-muted text-muted-foreground" : undefined}
          />
          {editando && (
            <p className="text-xs text-muted-foreground">
              Para trocar o medicamento, encerre este tratamento e cadastre outro.
            </p>
          )}
          {lowConfidenceFields.has("name") && (
            <p className="text-xs text-zelo-amber-fg flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Não deu pra ler isso na foto com confiança — confira e preencha.</p>
          )}
        </div>
        <div className="space-y-2 col-span-2">
          <Label htmlFor="tf-dose">Dose (texto livre: "1 comprimido", "5ml"…)</Label>
          <Input id="tf-dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="1 comprimido" />
          {(lowConfidenceFields.has("concentration") || lowConfidenceFields.has("form")) && (
            <p className="text-xs text-zelo-amber-fg flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Não deu pra ler isso na foto com confiança — confira e preencha.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <CampoLabel obrigatorio>Padrão de posologia</CampoLabel>
        {scheduleGuessApplied && (
          <p className="text-xs text-zelo-green-fg">Preenchido a partir da receita — confira antes de salvar.</p>
        )}
        <Select value={scheduleType} onValueChange={(v) => { setScheduleType(v as ScheduleType); setPreview(null); setScheduleGuessApplied(false); }}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(SCHEDULE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="rounded-lg border p-4 bg-muted/30 space-y-4">
        {scheduleType === "times_per_day" && <TimesList times={times} onChange={setTimes} dosePorHorario={dosePorHorario} onDoseChange={setDosePorHorario} />}

        {scheduleType === "every_n_hours" && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <CampoLabel obrigatorio>A cada quantas horas</CampoLabel>
              <CampoNumero value={String(intervalHours)} onChange={(v) => setIntervalHours(v === "" ? 1 : Number(v))} min={1} max={24} sufixo="horas" />
            </div>
            <div className="space-y-2">
              <CampoLabel obrigatorio>Primeira dose às</CampoLabel>
              <Input type="time" value={everyNStartTime} onChange={(e) => setEveryNStartTime(e.target.value)} />
            </div>
          </div>
        )}

        {scheduleType === "specific_weekdays" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <CampoLabel obrigatorio>Dias da semana</CampoLabel>
              <div className="flex gap-3 flex-wrap">
                {WEEKDAYS.map((w) => (
                  <label key={w.value} className="flex items-center gap-1.5 cursor-pointer">
                    <Checkbox
                      checked={weekdays.includes(w.value)}
                      onCheckedChange={(checked) =>
                        setWeekdays(checked ? [...weekdays, w.value] : weekdays.filter((d) => d !== w.value))
                      }
                    />
                    <span className="text-sm">{w.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <TimesList times={times} onChange={setTimes} dosePorHorario={dosePorHorario} onDoseChange={setDosePorHorario} />
          </div>
        )}

        {scheduleType === "alternate_days" && <TimesList times={times} onChange={setTimes} dosePorHorario={dosePorHorario} onDoseChange={setDosePorHorario} />}

        {scheduleType === "cycle_with_pause" && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <CampoLabel obrigatorio>Dias tomando</CampoLabel>
                <CampoNumero value={String(onDays)} onChange={(v) => setOnDays(v === "" ? 1 : Number(v))} min={1} sufixo="dias" />
              </div>
              <div className="space-y-2">
                <CampoLabel obrigatorio>Dias de pausa</CampoLabel>
                <CampoNumero value={String(offDays)} onChange={(v) => setOffDays(v === "" ? 0 : Number(v))} min={0} sufixo="dias" />
              </div>
            </div>
            <TimesList times={times} onChange={setTimes} dosePorHorario={dosePorHorario} onDoseChange={setDosePorHorario} />
          </div>
        )}

        {/* ── Issue #169: o remédio sem hora marcada ────────────────────

            Não há lista de horários aqui, e é isso que define o tipo.
            Dipirona para dor, bombinha de resgate, remédio de enjoo.

            Os dois campos vêm da RECEITA e servem para o app MOSTRAR na
            hora de registrar. Ele não compara, não bloqueia e não diz
            "ainda não pode dar" — isso seria prescrever. */}
        {scheduleType === "se_necessario" && (
          <div className="space-y-4">
            <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
              <p className="text-sm">
                Este remédio não tem hora marcada. Ele não vai aparecer como
                dose pendente, não vai atrasar e não entra na conta de adesão —
                você registra quando precisar dar.
              </p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="tf-intervalo">Intervalo mínimo (opcional)</Label>
                  <CampoNumero
                    id="tf-intervalo"
                    value={intervaloMinimoHoras}
                    onChange={setIntervaloMinimoHoras}
                    min={1}
                    max={72}
                    placeholder="6"
                    sufixo="horas"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tf-teto">No máximo por dia (opcional)</Label>
                  <CampoNumero
                    id="tf-teto"
                    value={tetoDiario}
                    onChange={setTetoDiario}
                    min={1}
                    max={24}
                    placeholder="4"
                    sufixo="por dia"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                O que a receita disser. Na hora de registrar, o ZELO mostra isto
                junto com a última vez e quantas já foram hoje. Ele não decide
                se pode dar — quem decide é o médico.
              </p>
            </div>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <CampoLabel htmlFor="tf-start" obrigatorio>Início</CampoLabel>
          <Input id="tf-start" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPreview(null); }} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tf-end">Fim (opcional, contínuo se vazio)</Label>
          <Input id="tf-end" type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPreview(null); }} />
        </div>
      </div>

      {/* ── Issue #173: acabar por QUANTIDADE ─────────────────────────

          "Tomar os 21 comprimidos" é receita comum, e virava conta de
          cabeça. O tratamento continua acabando por data — o que muda é o
          caminho até ela.

          Fechado por padrão: a maioria informa a data, e quem não precisa
          disto não pode nem ver campo novo. O formulário de tratamento já
          é a tela de maior atrito do app. */}
      {temAgenda(scheduleType) && (!porQuantidade ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline"
          onClick={() => setPorQuantidade(true)}
        >
          A receita diz uma quantidade, não uma data
        </button>
      ) : (
        <div className="rounded-lg border bg-muted/40 p-3 space-y-2">
          <Label htmlFor="tf-qtd">Quantas doses ao todo</Label>
          <div className="flex items-center gap-2">
            <CampoNumero
              id="tf-qtd"
              value={quantidadeDeDoses}
              onChange={setQuantidadeDeDoses}
              min={1}
              placeholder="21"
              className="flex-1"
            />
            <Button
              type="button"
              size="sm"
              disabled={!quantidadeDeDoses || calculandoFim}
              onClick={() => void calcularOFim()}
            >
              {calculandoFim ? "Calculando…" : "Calcular o fim"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              onClick={() => { setPorQuantidade(false); setErroDaQuantidade(""); }}
            >
              Fechar
            </Button>
          </div>
          {/* A conta fica À VISTA, no campo de fim logo acima. Esconder
              faria a pessoa aceitar um número que ela não tem como
              conferir — e é a receita do médico que está sendo
              transcrita. */}
          {erroDaQuantidade ? (
            <p className="text-sm text-zelo-amber-fg">{erroDaQuantidade}</p>
          ) : (
            <p className="text-xs text-muted-foreground">
              O app preenche a data de fim acima. Confira antes de salvar.
            </p>
          )}
        </div>
      ))}

      {/* ── Issue #172: o desmame ─────────────────────────────────────

          "40mg por 5 dias, 20mg por 5, 10mg por 5, depois para." Receita
          comum de corticoide, e também de ansiolítico sendo retirado.

          Fechado por padrão, pelo mesmo motivo do bloco de quantidade: a
          maioria dos tratamentos tem dose única, e o formulário de
          tratamento já é a tela de maior atrito do app.

          Só aparece nos tipos que têm lista de horários. Em
          `every_n_hours` o `buildScheduleConfig` não manda os degraus — e
          um campo que a gente não salva é pior que campo nenhum. */}
      {scheduleType !== "every_n_hours" && temAgenda(scheduleType) && (degraus.length === 0 ? (
        <button
          type="button"
          className="text-sm text-muted-foreground underline text-left"
          onClick={() => setDegraus([{ dose, dias: 5 }, { dose: "", dias: 5 }])}
        >
          A dose vai diminuindo (desmame)
        </button>
      ) : (
        <div className="rounded-lg border bg-muted/40 p-3 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <Label>Como a dose vai diminuindo</Label>
            <Button type="button" size="sm" variant="ghost" onClick={() => setDegraus([])}>
              Fechar
            </Button>
          </div>
          {degraus.map((degrau, i) => (
            <div key={i} className="flex items-center gap-2">
              <Input
                aria-label={`Dose do ${i + 1}º degrau`}
                placeholder="40mg"
                value={degrau.dose}
                maxLength={120}
                className="flex-1 min-w-0"
                onChange={(e) => {
                  const texto = e.target.value;
                  setDegraus(degraus.map((d, j) => (j === i ? { ...d, dose: texto } : d)));
                  setPreview(null);
                }}
              />
              <CampoNumero
                aria-label={`Dias do ${i + 1}º degrau`}
                value={String(degrau.dias)}
                onChange={(v) => {
                  setDegraus(degraus.map((d, j) => (j === i ? { ...d, dias: v === "" ? 1 : Number(v) } : d)));
                  setPreview(null);
                }}
                min={1}
                max={365}
                sufixo="dias"
                className="w-40 shrink-0"
              />
              {/* Abaixo de dois degraus não é desmame, e o botão some para
                  não deixar a pessoa desmontar o que ela acabou de montar. */}
              {degraus.length > 2 && (
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label={`Remover o ${i + 1}º degrau`}
                  onClick={() => { setDegraus(degraus.filter((_, j) => j !== i)); setPreview(null); }}
                >
                  <X className="w-4 h-4" />
                </Button>
              )}
            </div>
          ))}
          <Button
            type="button"
            size="sm"
            variant="secondary"
            className="gap-1"
            onClick={() => { setDegraus([...degraus, { dose: "", dias: 5 }]); setPreview(null); }}
          >
            <Plus className="w-3.5 h-3.5" /> Mais um degrau
          </Button>
          {/* A conta fica À VISTA, como no bloco de quantidade: o desmame
              define quando o tratamento acaba, e a pessoa precisa conferir
              esse número contra a receita antes de salvar. */}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-muted-foreground">
              {diasDoDesmame} dias ao todo
              {fimDoDesmame() ? `, terminando em ${emPortugues(fimDoDesmame())}` : ""}.
            </p>
            {fimDoDesmame() && fimDoDesmame() !== endDate && (
              <Button
                type="button"
                size="sm"
                variant="outline"
                onClick={() => { setEndDate(fimDoDesmame()); setPreview(null); }}
              >
                Usar como data de fim
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">
            O ZELO avisa na véspera de cada troca. Ele não sugere o desenho do
            desmame — quem decide isso é o médico.
          </p>
        </div>
      ))}

      <div className="space-y-2">
        <Label htmlFor="tf-instructions">Instruções (opcional)</Label>
        <Textarea id="tf-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="Tomar em jejum, por exemplo" />
      </div>

      {/* Estoque só na criação: depois de criado, ele tem tela própria de
          ajuste (somar/corrigir com motivo), que registra o histórico. Reabrir
          aqui daria dois caminhos para o mesmo número. */}
      {!editando && (
      <div className="rounded-lg border p-4 space-y-3">
        <label className="flex items-center gap-2 cursor-pointer text-[17px] font-medium">
          <Checkbox checked={trackStock} onCheckedChange={(c) => setTrackStock(c === true)} />
          Acompanhar estoque (opcional)
        </label>
        {trackStock && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <CampoLabel htmlFor="tf-stock-qty" obrigatorio>Quantidade na caixa/cartela</CampoLabel>
              <CampoNumero id="tf-stock-qty" value={stockQuantity} onChange={setStockQuantity} min={0} placeholder="30" />
            </div>
            <div className="space-y-2">
              <CampoLabel htmlFor="tf-stock-unit" obrigatorio>Unidade</CampoLabel>
              <Input id="tf-stock-unit" value={stockUnit} onChange={(e) => setStockUnit(e.target.value)} placeholder="comprimidos" />
            </div>
            <div className="space-y-2 col-span-2">
              <Label htmlFor="tf-rx-expires">Validade da receita (opcional)</Label>
              <Input id="tf-rx-expires" type="date" value={prescriptionExpiresAt} onChange={(e) => setPrescriptionExpiresAt(e.target.value)} />
              <p className="text-xs text-muted-foreground">Se a receita vencer antes do estoque acabar, o aviso de reposição antecipa.</p>
            </div>
          </div>
        )}
      </div>
      )}

      {/* Issue #169: sem hora marcada não há "a tempo", e nenhum lembrete
          dispara para este tipo. Oferecer a cascata aqui prometeria um
          aviso que nunca vai sair. */}
      {temAgenda(scheduleType) && (
      <div className="space-y-2">
        <Label>Se ninguém registrar a tempo</Label>
        <Select value={escalationProfile} onValueChange={(v) => setEscalationProfile(v as EscalationProfile)}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(ESCALATION_PROFILE_LABELS).map(([value, label]) => (
              <SelectItem key={value} value={value}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      )}

      {/* Não há próximas doses a ver quando não há agenda. */}
      {temAgenda(scheduleType) && (
      <div className="space-y-3">
        <Button type="button" variant="outline" className="w-full gap-2" onClick={() => void handlePreview()} disabled={previewLoading}>
          <CalendarCheck className="w-4 h-4" />
          {previewLoading ? "Calculando…" : "Ver próximas doses"}
        </Button>
        {preview && (
          <div className="rounded-lg border bg-zelo-green-bg border-zelo-green/20 p-4 text-[17px]">
            <p className="font-medium mb-1">Próximas doses:</p>
            <p className="text-muted-foreground">{preview.join(", ")}</p>
          </div>
        )}
      </div>
      )}

      {/* ── Issue #174: o que esta mudança vai fazer ─────────────────────

          Editar horário ou data apaga as doses pendentes e gera outras. O
          comportamento é o certo; o que faltava era dizer.

          Âmbar, e não vermelho: é contexto de dose (invariante 5), e nada
          aqui é destrutivo de verdade — o histórico não é tocado, e a frase
          diz isso com todas as letras, porque é a primeira coisa que quem
          lê "cancela 3 doses" teme. */}
      <AlertDialog open={aviso !== null} onOpenChange={(aberto) => { if (!aberto) setAviso(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>O que esta mudança faz</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-left">
                <p>
                  Isto cancela{" "}
                  <strong>
                    {aviso?.canceladas === 1
                      ? "1 dose que ainda não chegou"
                      : `${aviso?.canceladas} doses que ainda não chegaram`}
                  </strong>{" "}
                  e cria outras no lugar.
                </p>
                {aviso && aviso.proximas.length > 0 && (
                  <p>As próximas passam a ser: {aviso.proximas.join(", ")}.</p>
                )}
                <p className="text-zelo-amber-fg font-medium">
                  As doses já registradas não mudam.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Voltar</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                // `handleSubmit` aqui é o desta renderização, e ele fecha
                // sobre o `aviso` AINDA preenchido — por isso a guarda de
                // duas etapas deixa passar e o salvamento acontece. O
                // `setAviso(null)` é só para a caixa sumir junto, e não
                // ficar por cima de um erro se o salvamento falhar.
                setAviso(null);
                void handleSubmit(e as unknown as React.FormEvent);
              }}
            >
              Salvar assim
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>Cancelar</Button>
        <Button type="submit" disabled={loading || !medicationName.trim()}>
          {loading ? "Salvando…" : editando ? "Salvar mudanças" : "Salvar tratamento"}
        </Button>
      </div>
    </form>
  );
}
