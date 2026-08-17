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
import { X, Plus, CalendarCheck } from "lucide-react";

type ScheduleType = "times_per_day" | "every_n_hours" | "specific_weekdays" | "alternate_days" | "cycle_with_pause";

const SCHEDULE_LABELS: Record<ScheduleType, string> = {
  times_per_day: "Vezes ao dia, em horários fixos",
  every_n_hours: "A cada X horas",
  specific_weekdays: "Dias específicos da semana",
  alternate_days: "Dias alternados",
  cycle_with_pause: "Ciclo com pausa",
};

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
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao cadastrar tratamento");
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
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2 col-span-2">
          <Label htmlFor="tf-med">Medicamento</Label>
          <Input id="tf-med" value={medicationName} onChange={(e) => setMedicationName(e.target.value)} required autoFocus />
        </div>
        <div className="space-y-2 col-span-2">
          <Label htmlFor="tf-dose">Dose (texto livre — "1 comprimido", "5ml"…)</Label>
          <Input id="tf-dose" value={dose} onChange={(e) => setDose(e.target.value)} placeholder="1 comprimido" />
        </div>
      </div>

      <div className="space-y-2">
        <Label>Padrão de posologia</Label>
        <Select value={scheduleType} onValueChange={(v) => { setScheduleType(v as ScheduleType); setPreview(null); }}>
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
