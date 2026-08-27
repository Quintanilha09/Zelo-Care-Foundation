/**
 * Histórico e calendário de adesão — ZELO (ZELO-33).
 *
 * "A decisão de tom mais importante do produto": verde calmo, âmbar,
 * cinza — nunca vermelho, nunca ícone agressivo. Todo texto fala em "sem
 * registro", nunca em "perdeu" — pular uma dose é uma decisão registrada
 * (conta como resolvida), só a AUSÊNCIA de registro é âmbar.
 */
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { ArrowLeft, ChevronLeft, ChevronRight, FileText, Copy, ExternalLink } from "lucide-react";

interface DayStatus { date: string; status: "green" | "amber" | "gray" }
interface CalendarResponse {
  from: string; to: string; planLimited: boolean;
  days: DayStatus[];
  summary: {
    totalScheduled: number; totalUnregistered: number; adherenceRate: number | null;
    byMedication: Array<{ medicationId: number; medicationName: string; totalScheduled: number; adherenceRate: number | null }>;
    byCaregiver: Array<{ caregiverId: number; caregiverName: string; registeredCount: number }>;
  };
}
interface DayDose {
  id: number; scheduledLocalTime: string; status: "pending" | "taken" | "skipped" | "late" | "postponed";
  medicationName: string; dose: string | null; outcome: string | null;
  registeredByCaregiverName: string | null;
}
interface DayDetailResponse { date: string; doses: DayDose[] }
interface Treatment { id: number; medicationName: string }
interface Caregiver { id: number; name: string }

const WEEKDAY_LABELS = ["D", "S", "T", "Q", "Q", "S", "S"];

const DOSE_STATUS_LABELS: Record<string, string> = {
  taken: "Tomada", skipped: "Pulada", postponed: "Adiada",
  pending: "Sem registro", late: "Sem registro (ainda dá pra registrar)",
};

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function addDays(dateISO: string, n: number): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function addMonths(dateISO: string, n: number): string {
  const [y, m] = dateISO.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
}
function startOfMonth(dateISO: string): string {
  return `${dateISO.slice(0, 7)}-01`;
}
function endOfMonth(dateISO: string): string {
  return addDays(addMonths(startOfMonth(dateISO), 1), -1);
}
function startOfWeek(dateISO: string): string {
  const d = new Date(`${dateISO}T00:00:00Z`);
  return addDays(dateISO, -d.getUTCDay());
}
function endOfWeek(dateISO: string): string {
  return addDays(startOfWeek(dateISO), 6);
}
function formatMonthLabel(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00Z`).toLocaleDateString("pt-BR", { month: "long", year: "numeric", timeZone: "UTC" });
}
function formatDayLabel(dateISO: string): string {
  return new Date(`${dateISO}T00:00:00Z`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" });
}

async function fetchCalendar(patientId: string, from: string, to: string, medicationId: string): Promise<CalendarResponse> {
  const params = new URLSearchParams({ from, to });
  if (medicationId) params.set("medicationId", medicationId);
  const res = await authFetch(`/api/patients/${patientId}/adherence-calendar?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar histórico");
  return res.json();
}
async function fetchDayDetail(patientId: string, date: string, caregiverId: string): Promise<DayDetailResponse> {
  const params = new URLSearchParams({ date });
  if (caregiverId) params.set("caregiverId", caregiverId);
  const res = await authFetch(`/api/patients/${patientId}/adherence-calendar/day?${params}`);
  if (!res.ok) throw new Error("Erro ao carregar o dia");
  return res.json();
}
async function fetchTreatments(patientId: string): Promise<Treatment[]> {
  const res = await authFetch(`/api/patients/${patientId}/treatments`);
  if (!res.ok) return [];
  return res.json();
}
async function fetchCaregivers(): Promise<Caregiver[]> {
  const res = await authFetch(`/api/caregivers`);
  if (!res.ok) return [];
  return res.json();
}

function StatusDot({ status }: { status: DayStatus["status"] }) {
  const cls = status === "green" ? "bg-zelo-green" : status === "amber" ? "bg-zelo-amber" : "bg-border";
  return <span className={`inline-block w-2 h-2 rounded-full ${cls}`} />;
}

interface ReportResult { reportId: number; downloadUrl: string; expiresAt: string }

export default function AdherenceCalendarPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const [viewMode, setViewMode] = useState<"month" | "week">("month");
  const [anchor, setAnchor] = useState(todayISO());
  const [medicationFilter, setMedicationFilter] = useState("");
  const [caregiverFilter, setCaregiverFilter] = useState("");
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const [report, setReport] = useState<ReportResult | null>(null);
  const [reportError, setReportError] = useState<"paywall" | "erro" | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const from = viewMode === "month" ? startOfMonth(anchor) : startOfWeek(anchor);
  const to = viewMode === "month" ? endOfMonth(anchor) : endOfWeek(anchor);

  const { data: calendar, isLoading } = useQuery({
    queryKey: ["adherence-calendar", params.id, from, to, medicationFilter],
    queryFn: () => fetchCalendar(params.id, from, to, medicationFilter),
  });
  const { data: treatments } = useQuery({ queryKey: ["treatments", params.id], queryFn: () => fetchTreatments(params.id) });
  const { data: caregivers } = useQuery({ queryKey: ["caregivers"], queryFn: fetchCaregivers });
  const { data: dayDetail } = useQuery({
    queryKey: ["adherence-day", params.id, selectedDate, caregiverFilter],
    queryFn: () => fetchDayDetail(params.id, selectedDate!, caregiverFilter),
    enabled: !!selectedDate,
  });

  const medications = new Map<number, string>();
  for (const t of treatments ?? []) medications.set(t.id, t.medicationName);
  const _uniqueMedications = Array.from(new Set(medications.values()));

  const goPrev = () => { setAnchor(viewMode === "month" ? addMonths(anchor, -1) : addDays(anchor, -7)); setReport(null); setReportError(null); };
  const goNext = () => { setAnchor(viewMode === "month" ? addMonths(anchor, 1) : addDays(anchor, 7)); setReport(null); setReportError(null); };

  const handleGenerateReport = async () => {
    setGeneratingReport(true);
    setReportError(null);
    try {
      const res = await authFetch(`/api/patients/${params.id}/adherence-report`, {
        method: "POST",
        body: JSON.stringify({ from, to }),
      });
      if (res.status === 403) { setReportError("paywall"); return; }
      if (!res.ok) { setReportError("erro"); return; }
      const data = (await res.json()) as ReportResult;
      setReport(data);
    } catch {
      setReportError("erro");
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleCopyReportLink = () => {
    if (!report) return;
    void navigator.clipboard.writeText(`${window.location.origin}${report.downloadUrl}`);
    toast({ description: "Link copiado" });
  };

  const leadingBlanks = new Date(`${from}T00:00:00Z`).getUTCDay();
  const cells: Array<DayStatus | null> = [...Array(leadingBlanks).fill(null), ...(calendar?.days ?? [])];

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
          <h2 className="text-2xl font-semibold">Histórico</h2>
          <p className="text-muted-foreground text-[17px]">O que aconteceu, sem boletim de notas.</p>
        </div>

        {calendar?.planLimited && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm text-muted-foreground">
            Você está vendo os últimos 7 dias — período maior faz parte de um plano pago.
          </div>
        )}

        <div className="flex items-center justify-between gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <Button variant="ghost" size="icon" onClick={goPrev}><ChevronLeft className="w-4 h-4" /></Button>
            <span className="text-sm font-medium min-w-40 text-center capitalize">
              {viewMode === "month" ? formatMonthLabel(anchor) : `${from} – ${to}`}
            </span>
            <Button variant="ghost" size="icon" onClick={goNext}><ChevronRight className="w-4 h-4" /></Button>
          </div>
          <div className="flex gap-1">
            <Button size="sm" variant={viewMode === "week" ? "default" : "outline"} onClick={() => setViewMode("week")}>Semana</Button>
            <Button size="sm" variant={viewMode === "month" ? "default" : "outline"} onClick={() => setViewMode("month")}>Mês</Button>
          </div>
        </div>

        <div className="flex gap-2 flex-wrap">
          <Select value={medicationFilter || "all"} onValueChange={(v) => setMedicationFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Medicamento" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os medicamentos</SelectItem>
              {(treatments ?? []).map((t) => (
                <SelectItem key={t.id} value={String(t.id)}>{t.medicationName}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={caregiverFilter || "all"} onValueChange={(v) => setCaregiverFilter(v === "all" ? "" : v)}>
            <SelectTrigger className="w-44"><SelectValue placeholder="Cuidador" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Todos os cuidadores</SelectItem>
              {(caregivers ?? []).map((c) => (
                <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="rounded-lg border p-4">
          <div className="grid grid-cols-7 gap-1 mb-2">
            {WEEKDAY_LABELS.map((w, i) => (
              <div key={i} className="text-center text-xs text-muted-foreground">{w}</div>
            ))}
          </div>
          {isLoading ? (
            // Esqueleto no formato do MÊS, não uma linha de "Carregando…" —
            // Issue #5. A grade de sete colunas já ocupa a altura final, então
            // o resumo e o botão de relatório logo abaixo não saltam quando os
            // dias chegam.
            //
            // 35 quadrados: cinco semanas, que é o que quase todo mês ocupa
            // com os brancos do começo.
            <AreaCarregando rotulo="Carregando o calendário de adesão">
              <div className="grid grid-cols-7 gap-1">
                {Array.from({ length: 35 }).map((_, i) => (
                  <Esqueleto key={i} className="aspect-square rounded-md" />
                ))}
              </div>
            </AreaCarregando>
          ) : (
            <div className="grid grid-cols-7 gap-1 zelo-entra">
              {cells.map((cell, i) =>
                cell ? (
                  <button
                    key={cell.date}
                    onClick={() => setSelectedDate(cell.date)}
                    className="aspect-square rounded-md border hover:bg-muted/50 flex flex-col items-center justify-center gap-1"
                  >
                    <span className="text-xs">{Number(cell.date.slice(8, 10))}</span>
                    <StatusDot status={cell.status} />
                  </button>
                ) : (
                  <div key={`blank-${i}`} />
                )
              )}
            </div>
          )}
        </div>

        {calendar && (
          <div className="rounded-lg border p-4 space-y-3">
            <p className="text-[17px]">
              {calendar.summary.adherenceRate === null
                ? "Sem doses agendadas neste período."
                : `${Math.round(calendar.summary.adherenceRate * 100)}% de adesão no período — ${calendar.summary.totalUnregistered} dose(s) ficaram sem registro.`}
            </p>

            {calendar.summary.byMedication.length > 1 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Por medicamento</p>
                {calendar.summary.byMedication.map((m) => (
                  <p key={m.medicationId} className="text-sm">
                    {m.medicationName} — {m.adherenceRate === null ? "sem dose no período" : `${Math.round(m.adherenceRate * 100)}%`}
                  </p>
                ))}
              </div>
            )}

            {calendar.summary.byCaregiver.length > 0 && (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Quem registrou</p>
                {calendar.summary.byCaregiver.map((c) => (
                  <p key={c.caregiverId} className="text-sm">{c.caregiverName} — {c.registeredCount} dose(s) registradas</p>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="rounded-lg border p-4 space-y-3">
          <div className="flex items-center gap-2">
            <FileText className="w-4 h-4 text-muted-foreground" />
            <p className="text-[17px] font-medium">Relatório para o médico</p>
          </div>
          <p className="text-sm text-muted-foreground">
            PDF do período em exibição ({from} a {to}), pronto pra imprimir ou enviar por link. Nunca interpreta os dados — só mostra o que foi registrado.
          </p>

          {!report && (
            <Button size="sm" onClick={() => void handleGenerateReport()} disabled={generatingReport} className="gap-2">
              <FileText className="w-4 h-4" /> {generatingReport ? "Gerando…" : "Gerar relatório em PDF"}
            </Button>
          )}

          {reportError === "paywall" && (
            <p className="text-sm text-muted-foreground">
              Relatório em PDF é um recurso do plano pago — ainda não disponível na sua família.
            </p>
          )}
          {reportError === "erro" && (
            <p className="text-sm text-muted-foreground">Não deu pra gerar o relatório agora. Tente de novo em instantes.</p>
          )}

          {report && (
            <div className="space-y-2">
              <p className="text-sm">
                Relatório pronto — o link expira em {new Date(report.expiresAt).toLocaleDateString("pt-BR")}.
              </p>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="outline" onClick={handleCopyReportLink} className="gap-2">
                  <Copy className="w-4 h-4" /> Copiar link
                </Button>
                <a href={report.downloadUrl} target="_blank" rel="noreferrer">
                  <Button size="sm" variant="outline" className="gap-2">
                    <ExternalLink className="w-4 h-4" /> Abrir
                  </Button>
                </a>
                <Button size="sm" variant="ghost" onClick={() => setReport(null)}>Gerar outro</Button>
              </div>
            </div>
          )}
        </div>
      </main>

      <Dialog open={!!selectedDate} onOpenChange={(open) => !open && setSelectedDate(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="capitalize">{selectedDate && formatDayLabel(selectedDate)}</DialogTitle>
          </DialogHeader>
          <div className="space-y-2">
            {!dayDetail && (
              // Três linhas no formato da dose: medicamento e horário à
              // esquerda, situação à direita. Sem isso a janela abria vazia e
              // crescia de repente quando o dia chegava.
              <AreaCarregando rotulo="Carregando as doses do dia">
                <div className="space-y-2">
                  {Array.from({ length: 3 }).map((_, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 border-b pb-2 last:border-0">
                      <div className="flex-1 space-y-1.5">
                        <Esqueleto className="h-4 w-2/5" />
                        <Esqueleto className="h-3 w-16" />
                      </div>
                      <Esqueleto className="h-4 w-20 shrink-0" />
                    </div>
                  ))}
                </div>
              </AreaCarregando>
            )}
            {dayDetail?.doses.length === 0 && <p className="text-sm text-muted-foreground">Nenhuma dose agendada neste dia.</p>}
            {dayDetail?.doses.map((d) => (
              <div key={d.id} className="flex items-center justify-between text-sm border-b pb-2 last:border-0">
                <div>
                  <p className="font-medium">{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</p>
                  <p className="text-muted-foreground">{d.scheduledLocalTime}</p>
                </div>
                <div className="text-right">
                  <p>{DOSE_STATUS_LABELS[d.outcome ?? d.status] ?? d.status}</p>
                  {d.registeredByCaregiverName && <p className="text-xs text-muted-foreground">{d.registeredByCaregiverName}</p>}
                </div>
              </div>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
