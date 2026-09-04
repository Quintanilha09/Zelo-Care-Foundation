/**
 * Rotina e aferições — ZELO (ZELO-37).
 *
 * "Esta é a tela onde é mais fácil cruzar a linha do dispositivo médico."
 * Sem cor por valor, sem zona colorida no gráfico, sem linha de "normal",
 * sem seta de tendência, sem nenhum texto que reage ao número registrado —
 * em lugar nenhum desta tela. O gráfico mostra só o valor no tempo. Se
 * algo parecer preocupante, o cuidador escreve na observação; a tela só
 * encaminha o contato de emergência já cadastrado, nunca avalia.
 */
import { useState, useMemo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from "recharts";
import { authFetch } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Activity as ActivityIcon, Phone, Trash2 } from "lucide-react";

type MeasurementType = "blood_pressure" | "blood_glucose" | "weight" | "temperature" | "oxygen_saturation" | "heart_rate" | "other";
type ActivityType = "physiotherapy" | "bath" | "feeding" | "walk" | "other";

interface Measurement { id: number; type: MeasurementType; value: string; unit: string | null; measuredAt: string; notes: string | null; }
interface RoutineActivity { id: number; type: ActivityType; occurredAt: string; done: boolean; notes: string | null; }
interface Patient { id: number; name: string; emergencyContactName: string | null; emergencyContactPhone: string | null; }

const MEASUREMENT_LABELS: Record<MeasurementType, string> = {
  blood_pressure: "Pressão arterial", blood_glucose: "Glicemia", weight: "Peso",
  temperature: "Temperatura", oxygen_saturation: "Saturação de O₂", heart_rate: "Frequência cardíaca", other: "Outro",
};
const MEASUREMENT_DEFAULT_UNIT: Record<MeasurementType, string> = {
  blood_pressure: "mmHg", blood_glucose: "mg/dL", weight: "kg", temperature: "°C", oxygen_saturation: "%", heart_rate: "bpm", other: "",
};
const ACTIVITY_LABELS: Record<ActivityType, string> = {
  physiotherapy: "Fisioterapia", bath: "Banho", feeding: "Alimentação", walk: "Caminhada", other: "Outra",
};
// Só os tipos numéricos puros entram no gráfico de linha — "120/80" (pressão)
// não é um único número, plotar quebraria a garantia de nunca inferir nada
// do dado (não vamos separar sistólica/diastólica sozinhos).
const CHARTABLE_TYPES: MeasurementType[] = ["blood_glucose", "weight", "temperature", "oxygen_saturation", "heart_rate"];

async function fetchPatient(patientId: string): Promise<Patient> {
  const res = await authFetch(`/api/patients/${patientId}`);
  if (!res.ok) throw new Error("Erro ao carregar paciente");
  return res.json();
}
async function fetchMeasurements(patientId: string): Promise<Measurement[]> {
  const res = await authFetch(`/api/patients/${patientId}/health-measurements`);
  if (!res.ok) throw new Error("Erro ao carregar medições");
  return res.json();
}
async function fetchActivities(patientId: string): Promise<RoutineActivity[]> {
  const res = await authFetch(`/api/patients/${patientId}/activities`);
  if (!res.ok) throw new Error("Erro ao carregar atividades");
  return res.json();
}

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return `${d.toLocaleDateString("pt-BR")} ${d.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" })}`;
}
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export default function RoutinePage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [measurementDialogOpen, setMeasurementDialogOpen] = useState(false);
  const [mType, setMType] = useState<MeasurementType>("blood_pressure");
  const [mValue, setMValue] = useState("");
  const [mUnit, setMUnit] = useState(MEASUREMENT_DEFAULT_UNIT.blood_pressure);
  const [mWhen, setMWhen] = useState(toDatetimeLocalValue(new Date()));
  const [mNotes, setMNotes] = useState("");
  const [savingMeasurement, setSavingMeasurement] = useState(false);

  const [activityDialogOpen, setActivityDialogOpen] = useState(false);
  const [aType, setAType] = useState<ActivityType>("physiotherapy");
  const [aDone, setADone] = useState(true);
  const [aWhen, setAWhen] = useState(toDatetimeLocalValue(new Date()));
  const [aNotes, setANotes] = useState("");
  const [savingActivity, setSavingActivity] = useState(false);

  const [contactDialogOpen, setContactDialogOpen] = useState(false);
  const [contactName, setContactName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [savingContact, setSavingContact] = useState(false);

  const [chartType, setChartType] = useState<MeasurementType>("weight");

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => fetchPatient(params.id) });
  const { data: measurements } = useQuery({ queryKey: ["measurements", params.id], queryFn: () => fetchMeasurements(params.id) });
  const { data: activities } = useQuery({ queryKey: ["activities", params.id], queryFn: () => fetchActivities(params.id) });

  const chartData = useMemo(() => {
    return (measurements ?? [])
      .filter((m) => m.type === chartType)
      .map((m) => ({ date: new Date(m.measuredAt).toLocaleDateString("pt-BR"), value: Number(m.value) }))
      .filter((p) => !Number.isNaN(p.value))
      .reverse();
  }, [measurements, chartType]);

  const invalidateMeasurements = () => queryClient.invalidateQueries({ queryKey: ["measurements", params.id] });
  const invalidateActivities = () => queryClient.invalidateQueries({ queryKey: ["activities", params.id] });

  const handleSaveMeasurement = async () => {
    if (!mValue.trim()) return;
    setSavingMeasurement(true);
    try {
      const res = await authFetch(`/api/patients/${params.id}/health-measurements`, {
        method: "POST",
        body: JSON.stringify({
          type: mType, value: mValue.trim(), unit: mUnit || null,
          measuredAt: new Date(mWhen).toISOString(), notes: mNotes || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ description: "Medição registrada" });
      setMeasurementDialogOpen(false);
      setMValue(""); setMNotes("");
      invalidateMeasurements();
    } catch {
      toast({ description: "Não deu pra registrar agora.", variant: "destructive" });
    } finally {
      setSavingMeasurement(false);
    }
  };

  const handleDeleteMeasurement = async (id: number) => {
    const res = await authFetch(`/api/patients/${params.id}/health-measurements/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ description: "Medição removida" }); invalidateMeasurements(); }
  };

  const handleSaveActivity = async () => {
    setSavingActivity(true);
    try {
      const res = await authFetch(`/api/patients/${params.id}/activities`, {
        method: "POST",
        body: JSON.stringify({ type: aType, done: aDone, occurredAt: new Date(aWhen).toISOString(), notes: aNotes || null }),
      });
      if (!res.ok) throw new Error();
      toast({ description: "Atividade registrada" });
      setActivityDialogOpen(false);
      setANotes("");
      invalidateActivities();
    } catch {
      toast({ description: "Não deu pra registrar agora.", variant: "destructive" });
    } finally {
      setSavingActivity(false);
    }
  };

  const handleDeleteActivity = async (id: number) => {
    const res = await authFetch(`/api/patients/${params.id}/activities/${id}`, { method: "DELETE" });
    if (res.ok) { toast({ description: "Atividade removida" }); invalidateActivities(); }
  };

  const openContactDialog = () => {
    setContactName(patient?.emergencyContactName ?? "");
    setContactPhone(patient?.emergencyContactPhone ?? "");
    setContactDialogOpen(true);
  };
  const handleSaveContact = async () => {
    setSavingContact(true);
    try {
      const res = await authFetch(`/api/patients/${params.id}`, {
        method: "PATCH",
        body: JSON.stringify({ emergencyContactName: contactName || null, emergencyContactPhone: contactPhone || null }),
      });
      if (!res.ok) throw new Error();
      toast({ description: "Contato de emergência salvo" });
      setContactDialogOpen(false);
      void queryClient.invalidateQueries({ queryKey: ["patient", params.id] });
    } catch {
      toast({ description: "Não deu pra salvar agora.", variant: "destructive" });
    } finally {
      setSavingContact(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href={`/pacientes/${params.id}`}>
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </a>
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Rotina e medições</h2>

        </div>

        {patient?.emergencyContactName ? (
          <div className="flex items-center gap-2 text-sm bg-muted rounded-lg px-3 py-2">
            <Phone className="w-4 h-4 shrink-0 text-muted-foreground" />
            <a href={`tel:${patient.emergencyContactPhone ?? ""}`} className="flex-1 min-w-0 hover:underline">
              Algo parecendo preocupante? Contato de emergência: <strong>{patient.emergencyContactName}</strong>
              {patient.emergencyContactPhone ? ` — ${patient.emergencyContactPhone}` : ""}
            </a>
            <button onClick={openContactDialog} className="text-xs text-muted-foreground hover:text-foreground shrink-0">editar</button>
          </div>
        ) : (
          <button onClick={openContactDialog} className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2 hover:bg-muted/70 w-full text-left">
            <Phone className="w-4 h-4 shrink-0" /> Cadastrar contato de emergência (opcional)
          </button>
        )}

        {/* ── Medições ──────────────────────────────────────────────── */}
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="font-medium">Medições</h3>
            <Button size="sm" onClick={() => setMeasurementDialogOpen(true)} className="gap-2"><Plus className="w-4 h-4" /> Registrar</Button>
          </div>

          <div className="flex items-center gap-2">
            <Label className="text-xs text-muted-foreground shrink-0">Gráfico</Label>
            <Select value={chartType} onValueChange={(v) => setChartType(v as MeasurementType)}>
              <SelectTrigger className="w-56"><SelectValue /></SelectTrigger>
              <SelectContent>
                {CHARTABLE_TYPES.map((t) => <SelectItem key={t} value={t}>{MEASUREMENT_LABELS[t]}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>

          {chartData.length > 1 ? (
            <div className="h-48 rounded-lg border p-2">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={chartData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
                  <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                  <YAxis tick={{ fontSize: 11 }} domain={["auto", "auto"]} />
                  <Tooltip />
                  <Line type="monotone" dataKey="value" stroke="var(--zelo-green, #659A76)" dot strokeWidth={2} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground py-4 text-center border rounded-lg border-dashed">
              Registre pelo menos 2 medições de {MEASUREMENT_LABELS[chartType].toLowerCase()} pra ver o gráfico.
            </p>
          )}

          <div className="space-y-1.5">
            {(measurements ?? []).map((m) => (
              <div key={m.id} className="flex items-center justify-between text-sm border-b pb-1.5 last:border-0 border-l-4 border-l-zelo-measure pl-3 bg-zelo-measure-bg/40 rounded-r">
                <div>
                  <span className="font-medium">{MEASUREMENT_LABELS[m.type]}</span>
                  {": "}{m.value}{m.unit ? ` ${m.unit}` : ""}
                  <span className="text-muted-foreground"> · {formatDateTime(m.measuredAt)}</span>
                  {m.notes && <p className="text-muted-foreground text-xs mt-0.5">{m.notes}</p>}
                </div>
                <button onClick={() => void handleDeleteMeasurement(m.id)} aria-label="Remover" className="shrink-0">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
            {measurements?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma medição registrada ainda.</p>}
          </div>
        </div>

        {/* ── Atividades ─────────────────────────────────────────────── */}
        <div className="space-y-3 pt-2 border-t">
          <div className="flex items-center justify-between pt-3">
            <h3 className="font-medium">Atividades</h3>
            <Button size="sm" variant="outline" onClick={() => setActivityDialogOpen(true)} className="gap-2">
              <ActivityIcon className="w-4 h-4" /> Registrar
            </Button>
          </div>
          <div className="space-y-1.5">
            {(activities ?? []).map((a) => (
              <div key={a.id} className="flex items-center justify-between text-sm border-b pb-1.5 last:border-0 border-l-4 border-l-zelo-green pl-3 bg-zelo-green-bg/40 rounded-r">
                <div>
                  <span className="font-medium">{ACTIVITY_LABELS[a.type]}</span>
                  {": "}{a.done ? "feito" : "não feito"}
                  <span className="text-muted-foreground"> · {formatDateTime(a.occurredAt)}</span>
                  {a.notes && <p className="text-muted-foreground text-xs mt-0.5">{a.notes}</p>}
                </div>
                <button onClick={() => void handleDeleteActivity(a.id)} aria-label="Remover" className="shrink-0">
                  <Trash2 className="w-3.5 h-3.5 text-muted-foreground" />
                </button>
              </div>
            ))}
            {activities?.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma atividade registrada ainda.</p>}
          </div>
        </div>
      </main>

      <Dialog open={measurementDialogOpen} onOpenChange={setMeasurementDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar medição</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={mType} onValueChange={(v) => { const t = v as MeasurementType; setMType(t); setMUnit(MEASUREMENT_DEFAULT_UNIT[t]); }}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(MEASUREMENT_LABELS) as MeasurementType[]).map((t) => (
                    <SelectItem key={t} value={t}>{MEASUREMENT_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label>Valor</Label>
                <Input value={mValue} onChange={(e) => setMValue(e.target.value)} placeholder={mType === "blood_pressure" ? "120/80" : "0"} />
              </div>
              <div>
                <Label>Unidade</Label>
                <Input value={mUnit} onChange={(e) => setMUnit(e.target.value)} />
              </div>
            </div>
            <div>
              <Label>Quando</Label>
              <Input type="datetime-local" value={mWhen} onChange={(e) => setMWhen(e.target.value)} />
            </div>
            <div>
              <Label>Observação (opcional)</Label>
              <Textarea value={mNotes} onChange={(e) => setMNotes(e.target.value)} rows={2} placeholder="Livre — o que quiser anotar" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setMeasurementDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleSaveMeasurement()} disabled={savingMeasurement}>{savingMeasurement ? "Salvando…" : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={activityDialogOpen} onOpenChange={setActivityDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Registrar atividade</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Tipo</Label>
              <Select value={aType} onValueChange={(v) => setAType(v as ActivityType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {(Object.keys(ACTIVITY_LABELS) as ActivityType[]).map((t) => (
                    <SelectItem key={t} value={t}>{ACTIVITY_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <Checkbox id="activity-done" checked={aDone} onCheckedChange={(v) => setADone(v === true)} />
              <Label htmlFor="activity-done">Feito</Label>
            </div>
            <div>
              <Label>Quando</Label>
              <Input type="datetime-local" value={aWhen} onChange={(e) => setAWhen(e.target.value)} />
            </div>
            <div>
              <Label>Observação (opcional)</Label>
              <Textarea value={aNotes} onChange={(e) => setANotes(e.target.value)} rows={2} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setActivityDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleSaveActivity()} disabled={savingActivity}>{savingActivity ? "Salvando…" : "Registrar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={contactDialogOpen} onOpenChange={setContactDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Contato de emergência</DialogTitle></DialogHeader>
          <div className="space-y-3">
            <div>
              <Label>Nome</Label>
              <Input value={contactName} onChange={(e) => setContactName(e.target.value)} placeholder="Ex: Dra. Fulana, filho João" />
            </div>
            <div>
              <Label>Telefone</Label>
              <Input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="(11) 99999-9999" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setContactDialogOpen(false)}>Cancelar</Button>
            <Button onClick={() => void handleSaveContact()} disabled={savingContact}>{savingContact ? "Salvando…" : "Salvar"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
