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
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Alert, AlertDescription } from "@/components/ui/alert";
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

type ScheduleType = "times_per_day" | "every_n_hours" | "specific_weekdays" | "alternate_days" | "cycle_with_pause";

const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  times_per_day: "Vezes ao dia, em horários fixos",
  every_n_hours: "A cada X horas",
  specific_weekdays: "Dias específicos da semana",
  alternate_days: "Dias alternados",
  cycle_with_pause: "Ciclo com pausa",
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

function TimesList({ times, onChange }: { times: string[]; onChange: (t: string[]) => void }) {
  return (
    <div className="space-y-2">
      <Label>Horários</Label>
      {times.map((t, i) => (
        <div key={i} className="flex gap-2">
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
      ))}
      <Button type="button" variant="secondary" size="sm" className="gap-1" onClick={() => onChange([...times, "08:00"])}>
        <Plus className="w-3.5 h-3.5" /> Adicionar horário
      </Button>
    </div>
  );
}

interface TreatmentFormProps {
  patientId: number;
  onCreated: () => void;
  onCancel: () => void;
}

export function TreatmentForm({ patientId, onCreated, onCancel }: TreatmentFormProps) {
  const [medicationName, setMedicationName] = useState("");
  const [dose, setDose] = useState("");
  const [instructions, setInstructions] = useState("");
  const [scheduleType, setScheduleType] = useState<ScheduleType>("times_per_day");
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState("");
  const [escalationProfile, setEscalationProfile] = useState<EscalationProfile>("standard");

  const [times, setTimes] = useState(["08:00"]);
  const [intervalHours, setIntervalHours] = useState(8);
  const [everyNStartTime, setEveryNStartTime] = useState("08:00");
  const [weekdays, setWeekdays] = useState<number[]>([1, 3, 5]);
  const [onDays, setOnDays] = useState(21);
  const [offDays, setOffDays] = useState(7);

  const [preview, setPreview] = useState<string[] | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
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
    switch (scheduleType) {
      case "times_per_day":
        return { scheduleType, times };
      case "every_n_hours":
        return { scheduleType, intervalHours, startTime: everyNStartTime };
      case "specific_weekdays":
        return { scheduleType, weekdays, times };
      case "alternate_days":
        return { scheduleType, times, startDate };
      case "cycle_with_pause":
        return { scheduleType, onDays, offDays, times };
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

  const handlePreview = async () => {
    setPreviewLoading(true);
    setError("");
    setPreview(null);
    try {
      const res = await authFetch(`/api/patients/${patientId}/treatments/preview`, {
        method: "POST",
        body: JSON.stringify({ scheduleConfig: buildScheduleConfig(), startDate, endDate: endDate || undefined }),
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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!medicationName.trim()) return;
    setLoading(true);
    setError("");
    try {
      const medRes = await authFetch("/api/medications", {
        method: "POST",
        body: JSON.stringify({ name: medicationName.trim() }),
      });
      if (!medRes.ok) throw new Error("Erro ao registrar medicamento");
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
      <div className="rounded-lg border border-dashed p-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <Label htmlFor="tf-photo" className="flex items-center gap-2 cursor-pointer text-[15px] font-medium">
            <Camera className="w-4 h-4" /> Cadastrar por foto da caixa ou da receita (opcional)
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
            <div className="flex-1 space-y-2">
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

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2 col-span-2">
          <Label htmlFor="tf-med">Medicamento</Label>
          <Input id="tf-med" value={medicationName} onChange={(e) => setMedicationName(e.target.value)} required autoFocus />
          {lowConfidenceFields.has("name") && (
            <p className="text-xs text-zelo-amber-fg flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Não deu pra ler isso na foto com confiança — confira e preencha.</p>
          )}
        </div>
        <div className="space-y-2 col-span-2">
          <Label htmlFor="tf-dose">Dose (texto livre — "1 comprimido", "5ml"…)</Label>
          <Input id="tf-dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="1 comprimido" />
          {(lowConfidenceFields.has("concentration") || lowConfidenceFields.has("form")) && (
            <p className="text-xs text-zelo-amber-fg flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Não deu pra ler isso na foto com confiança — confira e preencha.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <Label>Padrão de posologia</Label>
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
        {scheduleType === "times_per_day" && <TimesList times={times} onChange={setTimes} />}

        {scheduleType === "every_n_hours" && (
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>A cada quantas horas</Label>
              <Input type="number" min={1} value={intervalHours} onChange={(e) => setIntervalHours(Number(e.target.value))} />
            </div>
            <div className="space-y-2">
              <Label>Primeira dose às</Label>
              <Input type="time" value={everyNStartTime} onChange={(e) => setEveryNStartTime(e.target.value)} />
            </div>
          </div>
        )}

        {scheduleType === "specific_weekdays" && (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Dias da semana</Label>
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
            <TimesList times={times} onChange={setTimes} />
          </div>
        )}

        {scheduleType === "alternate_days" && <TimesList times={times} onChange={setTimes} />}

        {scheduleType === "cycle_with_pause" && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Dias tomando</Label>
                <Input type="number" min={1} value={onDays} onChange={(e) => setOnDays(Number(e.target.value))} />
              </div>
              <div className="space-y-2">
                <Label>Dias de pausa</Label>
                <Input type="number" min={0} value={offDays} onChange={(e) => setOffDays(Number(e.target.value))} />
              </div>
            </div>
            <TimesList times={times} onChange={setTimes} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="tf-start">Início</Label>
          <Input id="tf-start" type="date" value={startDate} onChange={(e) => { setStartDate(e.target.value); setPreview(null); }} required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="tf-end">Fim (opcional — contínuo se vazio)</Label>
          <Input id="tf-end" type="date" value={endDate} onChange={(e) => { setEndDate(e.target.value); setPreview(null); }} />
        </div>
      </div>

      <div className="space-y-2">
        <Label htmlFor="tf-instructions">Instruções (opcional)</Label>
        <Textarea id="tf-instructions" value={instructions} onChange={(e) => setInstructions(e.target.value)} rows={2} placeholder="Tomar em jejum, por exemplo" />
      </div>

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

      <div className="space-y-3">
        <Button type="button" variant="outline" className="w-full gap-2" onClick={() => void handlePreview()} disabled={previewLoading}>
          <CalendarCheck className="w-4 h-4" />
          {previewLoading ? "Calculando…" : "Ver próximas doses"}
        </Button>
        {preview && (
          <div className="rounded-lg border bg-zelo-green-bg border-zelo-green/20 p-4 text-[15px]">
            <p className="font-medium mb-1">Próximas doses:</p>
            <p className="text-muted-foreground">{preview.join(", ")}</p>
          </div>
        )}
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>Cancelar</Button>
        <Button type="submit" disabled={loading || !medicationName.trim()}>
          {loading ? "Salvando…" : "Salvar tratamento"}
        </Button>
      </div>
    </form>
  );
}
