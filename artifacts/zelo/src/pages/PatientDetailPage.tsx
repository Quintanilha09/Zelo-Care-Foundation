import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { activateElderModeOnThisDevice } from "@/lib/elder-mode";
import { AppHeader } from "@/components/app-header";
import { TreatmentForm } from "@/components/treatment-form";
import { DoseCard } from "@/components/dose-card";
import { PushPermissionPrompt } from "@/components/push-permission-prompt";
import { NotificationPreferencesCard } from "@/components/notification-preferences-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pill, Package, Trash2 } from "lucide-react";

interface Patient {
  id: number;
  name: string;
  timezone: string;
  archived: boolean;
  elderModeEnabled: boolean;
}

interface Treatment {
  id: number;
  medicationName: string;
  dose: string | null;
  scheduleType: string;
  status: string;
  startDate: string;
  endDate: string | null;
}

interface ScheduledDose {
  id: number;
  treatmentId: number;
  scheduledAt: string;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  dose: string | null;
}

interface StockEntry {
  id: number;
  medicationId: number;
  medicationName: string;
  quantityRemaining: number;
  unit: string;
  prescriptionExpiresAt: string | null;
  effectiveDaysRemaining: number | null;
  isLow: boolean;
}

const SCHEDULE_LABELS: Record<string, string> = {
  times_per_day: "vezes ao dia",
  every_n_hours: "a cada X horas",
  specific_weekdays: "dias específicos da semana",
  alternate_days: "dias alternados",
  cycle_with_pause: "ciclo com pausa",
};

const STATUS_LABELS: Record<string, string> = {
  active: "Ativo",
  paused: "Pausado",
  finished: "Concluído",
  cancelled: "Cancelado",
};

async function fetchPatient(id: string): Promise<Patient> {
  const res = await authFetch(`/api/patients/${id}`);
  if (!res.ok) throw new Error("Paciente não encontrado");
  return res.json();
}

async function fetchTreatments(id: string): Promise<Treatment[]> {
  const res = await authFetch(`/api/patients/${id}/treatments`);
  if (!res.ok) throw new Error("Erro ao carregar tratamentos");
  return res.json();
}

async function fetchTodayDoses(id: string): Promise<ScheduledDose[]> {
  const res = await authFetch(`/api/patients/${id}/today-doses`);
  if (!res.ok) throw new Error("Erro ao carregar doses de hoje");
  const data = (await res.json()) as { doses: ScheduledDose[] };
  return data.doses;
}

async function fetchStock(id: string): Promise<StockEntry[]> {
  const res = await authFetch(`/api/patients/${id}/stock`);
  if (!res.ok) return [];
  return res.json();
}

export default function PatientDetailPage({ params }: { params: { id: string } }) {
  const { user } = useAuth();
  const [, setLocation] = useLocation();
  const isPrimaryCaregiver = user?.caregiver?.role === "primary_caregiver";
  const [elderModeSaving, setElderModeSaving] = useState(false);
  const [open, setOpen] = useState(false);

  // Excluir paciente (permanente) — só o dono da família, com confirmação
  // digitando o nome exato, mesmo padrão do GitHub pra excluir repositório.
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [deleteReason, setDeleteReason] = useState("");
  const [deleteConfirmName, setDeleteConfirmName] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [reactivatingId, setReactivatingId] = useState<number | null>(null);
  const [reactivateEndDate, setReactivateEndDate] = useState("");
  const [pushPromptTrigger, setPushPromptTrigger] = useState(0);
  const queryClient = useQueryClient();

  // ZELO-34: ajuste manual/reposição — um formulário mínimo por vez, não
  // uma tela própria (a lista de estoque já é curta o bastante pra caber
  // aqui direto na página do paciente).
  const [adjustingMedicationId, setAdjustingMedicationId] = useState<number | null>(null);
  const [adjustMode, setAdjustMode] = useState<"add" | "set">("add");
  const [adjustAmount, setAdjustAmount] = useState("");
  const [adjustReason, setAdjustReason] = useState("");

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => fetchPatient(params.id) });
  const { data: treatments, isLoading } = useQuery({ queryKey: ["treatments", params.id], queryFn: () => fetchTreatments(params.id) });
  const { data: todayDoses } = useQuery({ queryKey: ["today-doses", params.id], queryFn: () => fetchTodayDoses(params.id) });
  const { data: stock } = useQuery({ queryKey: ["stock", params.id], queryFn: () => fetchStock(params.id) });

  const medicationByTreatment = new Map((treatments ?? []).map((t) => [t.id, { name: t.medicationName, dose: t.dose }]));

  // ZELO-19: o horário exibido vem pronto do servidor (scheduledLocalTime,
  // já no fuso do paciente) — nunca reconvertido no navegador do cuidador,
  // que pode estar em outro fuso. Quando os dois fusos divergem, um aviso
  // discreto deixa claro de quem é aquele "8:00".
  const caregiverTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const showTzHint = !!patient && caregiverTz !== patient.timezone;

  const handleCreated = () => {
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["treatments", params.id] });
    void queryClient.invalidateQueries({ queryKey: ["today-doses", params.id] });
    void queryClient.invalidateQueries({ queryKey: ["stock", params.id] });
    // ZELO-26: nunca no primeiro segundo — só depois que o cuidador cadastra
    // um tratamento de verdade. O componente decide sozinho se já mostrou
    // antes ou se a permissão já foi respondida.
    setPushPromptTrigger((n) => n + 1);
  };

  const handleRegister = async (doseId: number, outcome: "taken" | "skipped") => {
    const res = await authFetch(`/api/patients/${params.id}/dose-records`, {
      method: "POST",
      body: JSON.stringify({ scheduledDoseId: doseId, takenAt: new Date().toISOString(), outcome }),
    });
    if (res.ok) {
      void queryClient.invalidateQueries({ queryKey: ["today-doses", params.id] });
      void queryClient.invalidateQueries({ queryKey: ["stock", params.id] }); // decremento automático (ZELO-34) pode ter mudado dias restantes
    }
  };

  const handleAdjustStock = async (medicationId: number) => {
    const amount = Number(adjustAmount);
    if (!amount && amount !== 0) return;
    const body = adjustMode === "add" ? { addQuantity: amount, reason: adjustReason || undefined } : { setQuantity: amount, reason: adjustReason || undefined };
    const res = await authFetch(`/api/patients/${params.id}/stock/${medicationId}`, { method: "PATCH", body: JSON.stringify(body) });
    if (res.ok) {
      setAdjustingMedicationId(null);
      setAdjustAmount("");
      setAdjustReason("");
      void queryClient.invalidateQueries({ queryKey: ["stock", params.id] });
    }
  };

  // ZELO-20: reativar sempre pede a data de fim de novo (ou deixa em branco
  // pra virar contínuo) — reativar sem isso só voltaria a fechar sozinho no
  // dia seguinte, já que a data antiga continuaria vencida.
  const handleReactivate = async (treatmentId: number) => {
    const res = await authFetch(`/api/treatments/${treatmentId}`, {
      method: "PATCH",
      body: JSON.stringify({ status: "active", endDate: reactivateEndDate || null }),
    });
    if (res.ok) {
      setReactivatingId(null);
      setReactivateEndDate("");
      void queryClient.invalidateQueries({ queryKey: ["treatments", params.id] });
    }
  };

  // ZELO-40: liga/desliga é só permissão ("este paciente PODE usar o modo
  // idoso") — ativar de fato num aparelho específico é uma ação separada,
  // feita fisicamente naquele dispositivo (ver lib/elder-mode.ts).
  const handleToggleElderMode = async (enabled: boolean) => {
    setElderModeSaving(true);
    const res = await authFetch(`/api/patients/${params.id}/elder-mode`, {
      method: "PATCH",
      body: JSON.stringify({ enabled }),
    });
    if (res.ok) void queryClient.invalidateQueries({ queryKey: ["patient", params.id] });
    setElderModeSaving(false);
  };

  const handleActivateElderModeOnDevice = () => {
    activateElderModeOnThisDevice(Number(params.id));
    window.location.href = "/";
  };

  const handleDeletePatient = async () => {
    if (!patient) return;
    setDeleting(true);
    setDeleteError("");
    try {
      const res = await authFetch(`/api/patients/${params.id}`, {
        method: "DELETE",
        body: JSON.stringify({ reason: deleteReason.trim(), confirmName: deleteConfirmName }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(data.error ?? "Erro ao excluir paciente");
      }
      setLocation("/pacientes");
    } catch (err) {
      setDeleteError(err instanceof Error ? err.message : "Erro");
    } finally {
      setDeleting(false);
    }
  };

  const activeTreatments = (treatments ?? []).filter((t) => t.status === "active" || t.status === "paused");
  const pastTreatments = (treatments ?? []).filter((t) => t.status === "finished" || t.status === "cancelled");

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href="/pacientes">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Todos os pacientes
          </a>
        </Link>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">{patient?.name ?? "…"}</h2>
            <p className="text-muted-foreground text-[15px]">{patient?.timezone}</p>
          </div>
          <div className="flex items-center gap-2">
            <Link href={`/pacientes/${params.id}/rotina`}>
              <Button variant="outline">Rotina</Button>
            </Link>
            <Link href={`/pacientes/${params.id}/consultas`}>
              <Button variant="outline">Consultas</Button>
            </Link>
            <Link href={`/pacientes/${params.id}/historico`}>
              <Button variant="outline">Histórico</Button>
            </Link>
            <Dialog open={open} onOpenChange={setOpen}>
              <Button onClick={() => setOpen(true)} className="gap-2">
                <Plus className="w-4 h-4" /> Tratamento
              </Button>
            <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
              <DialogHeader>
                <DialogTitle>Novo tratamento</DialogTitle>
                <DialogDescription>O que o médico prescreveu — o app registra, não opina.</DialogDescription>
              </DialogHeader>
              <TreatmentForm patientId={Number(params.id)} onCreated={handleCreated} onCancel={() => setOpen(false)} />
            </DialogContent>
            </Dialog>
          </div>
        </div>

        {todayDoses && todayDoses.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Hoje</h3>
            {todayDoses.map((d) => {
              const med = medicationByTreatment.get(d.treatmentId);
              const time = showTzHint ? `${d.scheduledLocalTime} (horário de ${patient!.name})` : d.scheduledLocalTime;
              return (
                <div key={d.id} className="space-y-2">
                  <DoseCard
                    medicationName={med?.name ?? "Medicamento"}
                    dosage={med?.dose ?? d.dose ?? ""}
                    time={time}
                    status={d.status === "taken" ? "taken" : "pending"}
                  />
                  {d.status === "pending" && (
                    <div className="flex gap-2 px-1">
                      <Button size="sm" className="flex-1" onClick={() => void handleRegister(d.id, "taken")}>
                        ✓ Tomou
                      </Button>
                      <Button size="sm" variant="secondary" className="flex-1" onClick={() => void handleRegister(d.id, "skipped")}>
                        Pular
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {isLoading && <p className="text-muted-foreground text-center py-12">Carregando…</p>}

        {!isLoading && treatments?.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium">Nenhum tratamento ainda</p>
            <p className="text-muted-foreground text-sm mt-1">Cadastre o primeiro medicamento.</p>
          </div>
        )}

        {activeTreatments.length > 0 && (
          <h3 className="text-sm font-medium text-muted-foreground">Tratamentos</h3>
        )}
        <div className="space-y-3">
          {activeTreatments.map((t) => (
            <div key={t.id} className="p-4 rounded-xl border bg-card shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[18px] font-semibold">{t.medicationName}</h3>
                  {t.dose && <p className="text-muted-foreground text-[15px]">{t.dose}</p>}
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground shrink-0">
                  {STATUS_LABELS[t.status] ?? t.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {SCHEDULE_LABELS[t.scheduleType] ?? t.scheduleType} · desde {new Date(t.startDate).toLocaleDateString("pt-BR")}
                {t.endDate ? ` até ${new Date(t.endDate).toLocaleDateString("pt-BR")}` : " · uso contínuo"}
              </p>
            </div>
          ))}
        </div>

        {pastTreatments.length > 0 && (
          <details className="pt-2">
            <summary className="text-sm font-medium text-muted-foreground cursor-pointer select-none">
              Tratamentos encerrados ({pastTreatments.length})
            </summary>
            <div className="space-y-3 mt-3">
              {pastTreatments.map((t) => (
                <div key={t.id} className="p-4 rounded-xl border bg-muted/30">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <h3 className="text-[18px] font-semibold text-muted-foreground">{t.medicationName}</h3>
                      {t.dose && <p className="text-muted-foreground text-[15px]">{t.dose}</p>}
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground shrink-0">
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {SCHEDULE_LABELS[t.scheduleType] ?? t.scheduleType} · desde {new Date(t.startDate).toLocaleDateString("pt-BR")}
                    {t.endDate && ` até ${new Date(t.endDate).toLocaleDateString("pt-BR")}`}
                  </p>

                  {t.status === "finished" && reactivatingId !== t.id && (
                    <Button size="sm" variant="secondary" className="mt-3" onClick={() => setReactivatingId(t.id)}>
                      Reativar
                    </Button>
                  )}
                  {t.status === "finished" && reactivatingId === t.id && (
                    <div className="mt-3 flex items-end gap-2">
                      <div className="space-y-1">
                        <Label htmlFor={`reactivate-end-${t.id}`} className="text-xs">Nova data de fim (vazio = contínuo)</Label>
                        <Input
                          id={`reactivate-end-${t.id}`}
                          type="date"
                          value={reactivateEndDate}
                          onChange={(e) => setReactivateEndDate(e.target.value)}
                          className="h-9"
                        />
                      </div>
                      <Button size="sm" onClick={() => void handleReactivate(t.id)}>Confirmar</Button>
                      <Button size="sm" variant="ghost" onClick={() => { setReactivatingId(null); setReactivateEndDate(""); }}>Cancelar</Button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </details>
        )}

        {stock && stock.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5" /> Estoque
            </h3>
            {stock.map((s) => (
              <div key={s.id} className={`p-4 rounded-xl border ${s.isLow ? "bg-zelo-amber-bg border-zelo-amber/30" : "bg-card"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">{s.medicationName}</p>
                    <p className="text-sm text-muted-foreground">
                      {s.quantityRemaining} {s.unit}
                      {s.effectiveDaysRemaining !== null && ` · cerca de ${Math.round(s.effectiveDaysRemaining)} dia(s) restantes`}
                    </p>
                    {s.prescriptionExpiresAt && (
                      <p className="text-xs text-muted-foreground">Receita válida até {new Date(`${s.prescriptionExpiresAt}T00:00:00`).toLocaleDateString("pt-BR")}</p>
                    )}
                  </div>
                  {adjustingMedicationId !== s.medicationId && (
                    <Button size="sm" variant="outline" onClick={() => { setAdjustingMedicationId(s.medicationId); setAdjustMode("add"); setAdjustAmount(""); setAdjustReason(""); }}>
                      Ajustar
                    </Button>
                  )}
                </div>

                {adjustingMedicationId === s.medicationId && (
                  <div className="mt-3 space-y-2 pt-3 border-t">
                    <div className="flex gap-2">
                      <Select value={adjustMode} onValueChange={(v) => setAdjustMode(v as "add" | "set")}>
                        <SelectTrigger className="w-40"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="add">Somar (repor)</SelectItem>
                          <SelectItem value="set">Corrigir para</SelectItem>
                        </SelectContent>
                      </Select>
                      <Input type="number" value={adjustAmount} onChange={(e) => setAdjustAmount(e.target.value)} placeholder={s.unit} className="flex-1" />
                    </div>
                    <Input value={adjustReason} onChange={(e) => setAdjustReason(e.target.value)} placeholder="Motivo (opcional)" />
                    <div className="flex gap-2">
                      <Button size="sm" onClick={() => void handleAdjustStock(s.medicationId)}>Salvar</Button>
                      <Button size="sm" variant="ghost" onClick={() => setAdjustingMedicationId(null)}>Cancelar</Button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        {isPrimaryCaregiver && (
          <div className="p-4 rounded-xl border bg-card space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-medium">Modo idoso</p>
                <p className="text-sm text-muted-foreground">
                  Uma tela simples, com letra grande, só para {patient?.name ?? "a pessoa"} confirmar que tomou o remédio.
                </p>
              </div>
              <Switch
                checked={!!patient?.elderModeEnabled}
                onCheckedChange={(checked) => void handleToggleElderMode(checked)}
                disabled={elderModeSaving}
              />
            </div>
            {patient?.elderModeEnabled && (
              <>
                <Button variant="outline" size="sm" onClick={handleActivateElderModeOnDevice}>
                  Ativar neste dispositivo agora
                </Button>
                <p className="text-xs text-muted-foreground">
                  Pra sair depois, toque em "Sair" (vermelho, canto inferior direito) e confirme com sua senha.
                </p>
              </>
            )}
          </div>
        )}

        <NotificationPreferencesCard patientId={Number(params.id)} />

        {isPrimaryCaregiver && patient && (
          <div className="p-4 rounded-xl border border-destructive/30 bg-destructive/5 space-y-3">
            <div>
              <p className="font-medium text-destructive">Excluir paciente</p>
              <p className="text-sm text-muted-foreground">
                Apaga {patient.name} e todo o histórico (tratamentos, doses, consultas, aferições) de forma permanente. Não é o mesmo que arquivar — não tem como desfazer.
              </p>
            </div>
            <Dialog
              open={deleteDialogOpen}
              onOpenChange={(o) => { setDeleteDialogOpen(o); if (!o) { setDeleteReason(""); setDeleteConfirmName(""); setDeleteError(""); } }}
            >
              <Button variant="destructive" size="sm" className="gap-2" onClick={() => setDeleteDialogOpen(true)}>
                <Trash2 className="w-4 h-4" /> Excluir paciente
              </Button>
              <DialogContent className="max-w-md">
                <DialogHeader>
                  <DialogTitle>Excluir {patient.name}</DialogTitle>
                  <DialogDescription>
                    Esta ação é permanente e apaga todo o histórico do paciente. Conte rapidamente o motivo e digite o nome completo pra confirmar.
                  </DialogDescription>
                </DialogHeader>
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="del-reason">Motivo</Label>
                    <Textarea
                      id="del-reason"
                      value={deleteReason}
                      onChange={(e) => setDeleteReason(e.target.value)}
                      placeholder="Ex: paciente cadastrado por engano, falecimento, etc."
                      rows={2}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="del-confirm">
                      Digite <span className="font-semibold">{patient.name}</span> pra confirmar
                    </Label>
                    <Input
                      id="del-confirm"
                      value={deleteConfirmName}
                      onChange={(e) => setDeleteConfirmName(e.target.value)}
                      autoComplete="off"
                    />
                  </div>
                  {deleteError && (
                    <Alert variant="destructive"><AlertDescription>{deleteError}</AlertDescription></Alert>
                  )}
                  <div className="flex gap-2 justify-end">
                    <Button variant="ghost" onClick={() => setDeleteDialogOpen(false)} disabled={deleting}>Cancelar</Button>
                    <Button
                      variant="destructive"
                      onClick={() => void handleDeletePatient()}
                      disabled={deleting || !deleteReason.trim() || deleteConfirmName !== patient.name}
                    >
                      {deleting ? "Excluindo…" : "Excluir permanentemente"}
                    </Button>
                  </div>
                </div>
              </DialogContent>
            </Dialog>
          </div>
        )}
      </main>
      <PushPermissionPrompt trigger={pushPromptTrigger} />
    </div>
  );
}
