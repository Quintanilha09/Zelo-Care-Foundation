/**
 * Agenda de consultas e exames — ZELO (ZELO-36).
 *
 * preparationNotes é sempre o que o cuidador ANOTA que o médico disse
 * (jejum, suspender medicamento) — o app nunca sugere nem orienta preparo
 * por conta própria, só guarda o texto livre. Mesma disciplina em toda a
 * tela: nenhuma cópia própria de instrução médica.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { useToast } from "@/hooks/use-toast";
import { PlanPaywall } from "@/components/plan-paywall";
import { CampoLabel } from "@/components/campo-label";
import { SeletorEspecialidade } from "@/components/seletor-especialidade";
import { SeletorLocal } from "@/components/seletor-local";
import { useAuth } from "@/context/AuthContext";
import { appointmentsAllowed, appointmentsBlockedMessage } from "@/lib/plan-limits-client";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Paperclip, X, CalendarClock } from "lucide-react";

type AppointmentType = "consultation" | "exam" | "procedure";
type AppointmentStatus = "scheduled" | "completed" | "cancelled" | "rescheduled";

interface Appointment {
  id: number;
  type: AppointmentType;
  specialty: string;
  doctorName: string | null;
  location: string | null;
  scheduledAt: string;
  scheduledLocalDate: string;
  scheduledLocalTime: string;
  notes: string | null;
  preparationNotes: string | null;
  questionsForDoctor: string[];
  postAppointmentNotes: string | null;
  status: AppointmentStatus;
  hasAttachment: boolean;
}

const TYPE_LABELS: Record<AppointmentType, string> = { consultation: "Consulta", exam: "Exame", procedure: "Procedimento" };
const STATUS_LABELS: Record<AppointmentStatus, string> = { scheduled: "Agendada", completed: "Concluída", cancelled: "Cancelada", rescheduled: "Remarcada" };

async function fetchAppointments(patientId: string): Promise<Appointment[]> {
  const res = await authFetch(`/api/patients/${patientId}/appointments`);
  if (!res.ok) throw new Error("Erro ao carregar consultas");
  return res.json();
}

interface FormState {
  type: AppointmentType;
  specialty: string;
  doctorName: string;
  location: string;
  date: string;
  time: string;
  notes: string;
  preparationNotes: string;
}
const EMPTY_FORM: FormState = { type: "consultation", specialty: "", doctorName: "", location: "", date: "", time: "", notes: "", preparationNotes: "" };

function toFormState(a: Appointment): FormState {
  return {
    type: a.type, specialty: a.specialty, doctorName: a.doctorName ?? "", location: a.location ?? "",
    date: a.scheduledLocalDate, time: a.scheduledLocalTime,
    notes: a.notes ?? "", preparationNotes: a.preparationNotes ?? "",
  };
}

export default function AppointmentsPage({ params }: { params: { id: string } }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  // Limite de plano não é erro: é convite. Guardado à parte do toast de falha
  // justamente para não virar 'tente de novo' de algo que não muda tentando.
  const [paywallMessage, setPaywallMessage] = useState<string | null>(null);
  const { user } = useAuth();

  /**
   * Decide ANTES de abrir o formulário.
   *
   * Deixar a pessoa preencher tipo, especialidade, médico, local, data, hora,
   * observações e preparo — para só no botão final dizer que o plano não
   * permite — é desrespeito com o tempo dela. O paywall abre no clique, e o
   * formulário nem chega a aparecer.
   *
   * O 403 do servidor continua tratado no handleCreate: ele é a autoridade, e
   * se cliente e servidor divergirem, vale a resposta dele.
   */
  const handleNovaClick = () => {
    if (!appointmentsAllowed(user?.plan)) {
      setPaywallMessage(appointmentsBlockedMessage());
    }
    setCreateOpen(true);
  };
  const [detailId, setDetailId] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<FormState | null>(null);
  const [newQuestion, setNewQuestion] = useState("");

  const { data: appointments, isLoading } = useQuery({
    queryKey: ["appointments", params.id],
    queryFn: () => fetchAppointments(params.id),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["appointments", params.id] });

  const upcoming = (appointments ?? []).filter((a) => a.status === "scheduled").sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  const past = (appointments ?? []).filter((a) => a.status !== "scheduled").sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt));
  const detail = (appointments ?? []).find((a) => a.id === detailId) ?? null;

  const handleCreate = async () => {
    // Nada de `return` mudo: apertar Agendar e não acontecer nada é
    // indistinguível de app quebrado — lição que custou três rodadas no modo
    // idoso. Diz qual campo falta.
    const faltando = [
      !createForm.specialty && "especialidade",
      !createForm.date && "data",
      !createForm.time && "hora",
    ].filter(Boolean) as string[];

    if (faltando.length > 0) {
      toast({
        description:
          faltando.length === 1
            ? `Falta preencher a ${faltando[0]}.`
            : `Falta preencher: ${faltando.join(', ')}.`,
        variant: "destructive",
      });
      return;
    }
    setSaving(true);
    try {
      const res = await authFetch(`/api/patients/${params.id}/appointments`, {
        method: "POST",
        body: JSON.stringify({
          type: createForm.type, specialty: createForm.specialty,
          doctorName: createForm.doctorName || null, location: createForm.location || null,
          scheduledDate: createForm.date, scheduledTime: createForm.time,
          notes: createForm.notes || null, preparationNotes: createForm.preparationNotes || null,
        }),
      });
      if (!res.ok) {
        // O `catch {}` vazio que existia aqui descartava a resposta do servidor
        // sem ler. Quem estava no plano gratuito via 'tente de novo' para algo
        // que nunca funcionaria tentando de novo: a agenda de consultas é
        // bloqueada por inteiro no gratuito (appointments: false).
        const erro = (await res.json().catch(() => ({}))) as { error?: string; code?: string };
        if (erro.code === "PLAN_LIMIT" || erro.code === "PLAN_READ_ONLY") {
          setPaywallMessage(erro.error ?? "Este recurso é do plano Família.");
          return;
        }
        throw new Error(erro.error ?? "Não foi possível agendar.");
      }
      toast({ description: "Consulta agendada" });
      setCreateOpen(false);
      setCreateForm(EMPTY_FORM);
      invalidate();
    } catch (err) {
      toast({
        description: err instanceof Error ? err.message : "Não foi possível agendar.",
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };

  const openDetail = (a: Appointment) => { setDetailId(a.id); setEditForm(toFormState(a)); };
  const closeDetail = () => { setDetailId(null); setEditForm(null); setNewQuestion(""); };

  const patchAppointment = async (body: Record<string, unknown>) => {
    if (!detailId) return;
    const res = await authFetch(`/api/patients/${params.id}/appointments/${detailId}`, { method: "PATCH", body: JSON.stringify(body) });
    if (!res.ok) { toast({ description: "Não deu pra salvar agora.", variant: "destructive" }); return; }
    invalidate();
  };

  const handleSaveEdit = async () => {
    if (!editForm) return;
    setSaving(true);
    try {
      await patchAppointment({
        type: editForm.type, specialty: editForm.specialty,
        doctorName: editForm.doctorName || null, location: editForm.location || null,
        scheduledDate: editForm.date, scheduledTime: editForm.time,
        notes: editForm.notes || null, preparationNotes: editForm.preparationNotes || null,
      });
      toast({ description: "Consulta atualizada" });
    } finally {
      setSaving(false);
    }
  };

  const handleAddQuestion = async () => {
    if (!detail || !newQuestion.trim()) return;
    await patchAppointment({ questionsForDoctor: [...detail.questionsForDoctor, newQuestion.trim()] });
    setNewQuestion("");
  };
  const handleRemoveQuestion = async (q: string) => {
    if (!detail) return;
    await patchAppointment({ questionsForDoctor: detail.questionsForDoctor.filter((x) => x !== q) });
  };
  const handleSavePostNotes = async (text: string) => {
    await patchAppointment({ postAppointmentNotes: text });
  };
  const handleStatusChange = async (status: AppointmentStatus) => {
    await patchAppointment({ status });
    toast({ description: `Consulta marcada como ${STATUS_LABELS[status].toLowerCase()}` });
  };
  const handleAttachmentUpload = async (file: File) => {
    if (!detailId) return;
    const form = new FormData();
    form.append("file", file);
    const res = await authFetch(`/api/patients/${params.id}/appointments/${detailId}/attachment`, { method: "POST", body: form });
    if (!res.ok) { toast({ description: "Não deu pra anexar o arquivo.", variant: "destructive" }); return; }
    toast({ description: "Anexo salvo" });
    invalidate();
  };

  // Data de hoje no fuso de quem está olhando, no formato que o input espera.
  // `toISOString()` daria o dia UTC, que de madrugada no Brasil é o dia seguinte.
  const hojeISO = () => {
    const agora = new Date();
    const local = new Date(agora.getTime() - agora.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 10);
  };

  const renderForm = (form: FormState, setForm: (f: FormState) => void) => (
    <div className="space-y-3">
      <div>
        <Label>Tipo</Label>
        <Select value={form.type} onValueChange={(v) => setForm({ ...form, type: v as AppointmentType })}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            {Object.entries(TYPE_LABELS).map(([v, label]) => <SelectItem key={v} value={v}>{label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <div>
        <CampoLabel obrigatorio>Especialidade</CampoLabel>
        <SeletorEspecialidade value={form.specialty} onChange={(v) => setForm({ ...form, specialty: v })} />
      </div>
      <div>
        <Label>Médico(a)</Label>
        <Input value={form.doctorName} onChange={(e) => setForm({ ...form, doctorName: e.target.value })} placeholder="Dra. Fulana" />
      </div>
      <div>
        <Label>Local</Label>
        <SeletorLocal value={form.location} onChange={(v) => setForm({ ...form, location: v })} />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <CampoLabel obrigatorio>Data</CampoLabel>
          {/* min = hoje: não existe consulta no passado. O servidor recusa também
              (appointments.ts) — isto aqui só evita a viagem inútil. */}
          <Input type="date" min={hojeISO()} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} required />
        </div>
        <div>
          <CampoLabel obrigatorio>Hora</CampoLabel>
          <Input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} required />
        </div>
      </div>
      <div>
        <Label>Observações</Label>
        <Textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={2} />
      </div>
      <div>
        <Label>Preparo (o que o médico disse: jejum, suspender remédio etc.)</Label>
        <Textarea value={form.preparationNotes} onChange={(e) => setForm({ ...form, preparationNotes: e.target.value })} rows={2} placeholder="Ex: jejum de 8h, suspender anticoagulante 2 dias antes" />
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href={`/pacientes/${params.id}`}>
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Voltar
          </a>
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Consultas e exames</h2>
            <p className="text-muted-foreground text-[17px]">Lembretes em 1 semana, 1 dia e 2 horas antes.</p>
          </div>
          <Button onClick={handleNovaClick} className="gap-2"><Plus className="w-4 h-4" /> Nova</Button>
        </div>

        {isLoading && <EsqueletoDaAgenda />}

        {upcoming.length > 0 && (
          <div className="space-y-2 zelo-entra">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Próximas</p>
            {upcoming.map((a) => <AppointmentCard key={a.id} appointment={a} onClick={() => openDetail(a)} />)}
          </div>
        )}

        {upcoming.length === 0 && !isLoading && (
          <p className="text-sm text-muted-foreground">Nenhuma consulta agendada.</p>
        )}

        {past.length > 0 && (
          <div className="space-y-2 zelo-entra">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Anteriores</p>
            {past.map((a) => <AppointmentCard key={a.id} appointment={a} onClick={() => openDetail(a)} />)}
          </div>
        )}
      </main>

      <Dialog
        open={createOpen}
        onOpenChange={(aberto) => {
          setCreateOpen(aberto);
          if (!aberto) setPaywallMessage(null);
        }}
      >
        {/* max-h + overflow: o formulário é mais alto que a tela em celular, e sem
            isto o diálogo cortava os últimos campos sem deixar rolar. */}
        <DialogContent>
          {paywallMessage ? (
            <PlanPaywall
              title="Consultas e exames no mesmo lugar"
              message={paywallMessage}
              onDismiss={() => {
                setPaywallMessage(null);
                setCreateOpen(false);
              }}
            />
          ) : (
            <>
              <DialogHeader><DialogTitle>Nova consulta</DialogTitle></DialogHeader>
              {renderForm(createForm, setCreateForm)}
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)}>Cancelar</Button>
                <Button onClick={() => void handleCreate()} disabled={saving}>{saving ? "Salvando…" : "Agendar"}</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={!!detail} onOpenChange={(open) => !open && closeDetail()}>
        <DialogContent>
          <DialogHeader><DialogTitle>{detail && TYPE_LABELS[detail.type]} — {detail?.specialty}</DialogTitle></DialogHeader>
          {detail && editForm && (
            <div className="space-y-4">
              <div className="flex items-center gap-2">
                <Badge variant={detail.status === "scheduled" ? "default" : "secondary"}>{STATUS_LABELS[detail.status]}</Badge>
                {detail.status === "scheduled" && (
                  <div className="flex gap-2 ml-auto">
                    <Button size="sm" variant="outline" onClick={() => void handleStatusChange("completed")}>Marcar concluída</Button>
                    <Button size="sm" variant="outline" onClick={() => void handleStatusChange("cancelled")}>Cancelar</Button>
                  </div>
                )}
              </div>

              {renderForm(editForm, setEditForm)}
              <Button size="sm" onClick={() => void handleSaveEdit()} disabled={saving}>{saving ? "Salvando…" : "Salvar alterações"}</Button>

              <div className="space-y-2 pt-2 border-t">
                <Label>O que perguntar ao médico</Label>
                {detail.questionsForDoctor.map((q) => (
                  <div key={q} className="flex items-center gap-2 text-sm bg-muted rounded-md px-3 py-1.5">
                    {/* Issue #88: texto livre - `min-w-0` para o item poder
                        encolher, `break-words` para a palavra comprida
                        quebrar em vez de empurrar a pagina. */}
                    <span className="flex-1 min-w-0 break-words">{q}</span>
                    <button onClick={() => void handleRemoveQuestion(q)} aria-label="Remover pergunta"><X className="w-3.5 h-3.5 text-muted-foreground" /></button>
                  </div>
                ))}
                <div className="flex gap-2">
                  <Input value={newQuestion} onChange={(e) => setNewQuestion(e.target.value)} placeholder="Adicionar pergunta" onKeyDown={(e) => e.key === "Enter" && void handleAddQuestion()} />
                  <Button size="sm" variant="outline" onClick={() => void handleAddQuestion()}>Adicionar</Button>
                </div>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Label>Anotações depois da consulta</Label>
                <Textarea
                  defaultValue={detail.postAppointmentNotes ?? ""}
                  rows={3}
                  onBlur={(e) => void handleSavePostNotes(e.target.value)}
                  placeholder="O que o médico disse"
                />
                <Link href={`/pacientes/${params.id}`}>
                  <a className="text-sm text-primary hover:underline">Cadastrar ou ajustar tratamento →</a>
                </Link>
              </div>

              <div className="space-y-2 pt-2 border-t">
                <Label>Anexo (pedido de exame ou receita)</Label>
                {detail.hasAttachment ? (
                  <a href={`/api/patients/${params.id}/appointments/${detail.id}/attachment`} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" /> Ver anexo
                  </a>
                ) : (
                  <label className="text-sm text-muted-foreground flex items-center gap-1.5 cursor-pointer">
                    <Paperclip className="w-3.5 h-3.5" /> Anexar foto ou PDF
                    <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden"
                      onChange={(e) => e.target.files?.[0] && void handleAttachmentUpload(e.target.files[0])} />
                  </label>
                )}
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function formatLocalDate(dateISO: string): string {
  const [y, m, d] = dateISO.split("-");
  return `${d}/${m}/${y}`;
}

/**
 * Esqueleto da agenda — Issue #5.
 *
 * Reproduz o cartão de consulta: ícone à esquerda, especialidade e data no
 * meio, etiqueta de status à direita. Duas linhas sob o rótulo "Próximas",
 * que é o bloco que quase sempre existe.
 */
function EsqueletoDaAgenda() {
  return (
    <AreaCarregando rotulo="Carregando as consultas">
      <div className="space-y-2">
        <Esqueleto className="h-3 w-20" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-3 flex items-center gap-3">
            <Esqueleto className="w-4 h-4 rounded-sm shrink-0" />
            <div className="flex-1 space-y-2">
              <Esqueleto className="h-4 w-1/2" />
              <Esqueleto className="h-3 w-2/3" />
            </div>
            <Esqueleto className="h-5 w-16 rounded-full shrink-0" />
          </div>
        ))}
      </div>
    </AreaCarregando>
  );
}

function AppointmentCard({ appointment, onClick }: { appointment: Appointment; onClick: () => void }) {
  return (
    <button onClick={onClick} className="w-full text-left rounded-lg border p-3 hover:bg-muted/50 flex items-center gap-3">
      <CalendarClock className="w-4 h-4 text-muted-foreground shrink-0" />
      <div className="flex-1 min-w-0">
        <p className="font-medium text-sm">{appointment.specialty}{appointment.doctorName ? ` — ${appointment.doctorName}` : ""}</p>
        <p className="text-xs text-muted-foreground">
          {formatLocalDate(appointment.scheduledLocalDate)} às {appointment.scheduledLocalTime}
          {appointment.location ? ` · ${appointment.location}` : ""}
        </p>
      </div>
      <Badge variant={appointment.status === "scheduled" ? "default" : "secondary"}>{STATUS_LABELS[appointment.status]}</Badge>
    </button>
  );
}
