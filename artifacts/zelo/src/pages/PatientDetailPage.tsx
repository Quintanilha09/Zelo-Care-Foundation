import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { activateElderModeOnThisDevice } from "@/lib/elder-mode";
import { AppHeader } from "@/components/app-header";
import { TreatmentForm } from "@/components/treatment-form";
import { Pencil } from "lucide-react";
import { CampoNumero } from "@/components/campo-numero";
import { DoseCard } from "@/components/dose-card";
import { PushPermissionPrompt } from "@/components/push-permission-prompt";
import { NotificationPreferencesCard } from "@/components/notification-preferences-card";
import { PatientAccessCard } from "@/components/patient-access-card";
import { MomentosCard } from "@/components/momentos-card";
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
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { ArrowLeft, Plus, Pill, Package, Trash2, Smartphone, Tablet } from "lucide-react";

/**
 * Esqueleto da lista de tratamentos — Issue #5.
 *
 * Imita o cartão real: nome do medicamento em destaque, dose logo abaixo,
 * etiqueta de status à direita e a linha de período no rodapé.
 *
 * Nenhum texto de exemplo aqui, e o motivo é sério: um esqueleto com nome de
 * medicamento inventado, mesmo cinza, num app de saúde é o tipo de coisa que
 * alguém lê rápido e acredita. Barra cinza não mente.
 */
function EsqueletoDeTratamentos() {
  return (
    <AreaCarregando rotulo="Carregando os tratamentos">
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="p-4 rounded-xl border space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div className="space-y-2 flex-1">
                <Esqueleto className="h-5 w-2/5" />
                <Esqueleto className="h-4 w-1/4" />
              </div>
              <Esqueleto className="h-6 w-20 rounded-full shrink-0" />
            </div>
            <Esqueleto className="h-3.5 w-3/5" />
          </div>
        ))}
      </div>
    </AreaCarregando>
  );
}

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
  // Campos que só a EDIÇÃO usa. A API já os devolvia; este tipo é que os
  // omitia, e por isso não dava para pré-preencher o formulário.
  scheduleConfig: unknown;
  instructions: string | null;
  escalationProfile: string | null;
}

interface ScheduledDose {
  id: number;
  treatmentId: number;
  scheduledAt: string;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  dose: string | null;
  // Issue #26 — a API sempre devolveu estes dois; era o TIPO que os omitia,
  // e por isso não dava para passá-los ao cartão sem erro de compilação. O
  // resultado na tela era "às  por", com as preposições sozinhas.
  //
  // `registeredByCaregiverName` já vem com o nome do PACIENTE quando o
  // registro veio do modo idoso (ZELO-40) — o servidor troca o rótulo, e a
  // tela só exibe.
  registeredAt: string | null;
  registeredByCaregiverName: string | null;
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

/**
 * A hora em que a dose foi registrada, no fuso DO PACIENTE — Issue #26.
 *
 * O servidor manda o instante em ISO; quem formata é a tela. E precisa ser o
 * fuso do paciente, não o de quem está olhando: um filho em Portugal vendo
 * "12:14" quando a mãe tomou o remédio às 08:14 em São Paulo é a tela
 * mentindo sobre o cuidado.
 *
 * Devolve `null` quando não há registro — e `frasePartida`, no cartão, sabe
 * montar a frase sem essa metade em vez de deixar um "às" sozinho.
 */
function horaDoRegistro(iso: string | null, timezone: string | undefined): string | null {
  if (!iso) return null;
  const instante = new Date(iso);
  if (Number.isNaN(instante.getTime())) return null;
  return new Intl.DateTimeFormat("pt-BR", {
    timeZone: timezone,
    hour: "2-digit",
    minute: "2-digit",
  }).format(instante);
}

/**
 * Uma data sem hora ("2026-08-27") em pt-BR, **sem perder um dia** — Issue #26.
 *
 * ── O defeito que isto conserta ───────────────────────────────────────────
 *
 * A tela chamava `toLocaleDateString("pt-BR")` direto sobre a data crua. O
 * navegador lê "2026-08-27" como **meia-noite UTC**, e depois imprime no fuso
 * de quem está olhando: no Brasil, três horas antes — ou seja, **26/08**.
 *
 * Um tratamento cadastrado hoje aparecia começando ontem. Foi visto num teste
 * de tela desta issue: a data dizia "desde 26/08/2026" numa linha criada em
 * 27/08.
 *
 * O `Z` explícito e o `timeZone: "UTC"` mantêm a data como ela foi escrita —
 * é o mesmo par que o calendário de adesão já usava e por isso nunca errou.
 */
function dataCurta(iso: string | null | undefined): string {
  if (!iso) return "";
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("pt-BR", { timeZone: "UTC" });
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
  /** Tratamento sendo editado. `null` = ninguém. */
  const [editandoTratamento, setEditandoTratamento] = useState<Treatment | null>(null);
  const [, setLocation] = useLocation();
  const isPrimaryCaregiver = user?.caregiver?.role === "primary_caregiver";
  const [elderModeSaving, setElderModeSaving] = useState(false);
  const [elderModeError, setElderModeError] = useState("");
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
      // Sem `takenAt`: "agora" é o relógio do servidor (ver dose-records.ts).
      body: JSON.stringify({ scheduledDoseId: doseId, outcome }),
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
    setElderModeError("");
    try {
      const res = await authFetch(`/api/patients/${params.id}/elder-mode`, {
        method: "PATCH",
        body: JSON.stringify({ enabled }),
      });
      if (!res.ok) {
        // Antes isto falhava em silêncio: o interruptor voltava sozinho e
        // ninguém sabia por quê (ex: 403 de quem não é cuidador principal).
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setElderModeError(data.error ?? "Não foi possível alterar o modo idoso.");
        return;
      }
      void queryClient.invalidateQueries({ queryKey: ["patient", params.id] });
    } catch {
      setElderModeError("Sem conexão agora. Tente de novo.");
    } finally {
      setElderModeSaving(false);
    }
  };

  const handleActivateElderModeOnDevice = () => {
    activateElderModeOnThisDevice(Number(params.id));
    // Recarrega de fato (não navega pela SPA) pro gate do modo idoso em
    // App.tsx ser reavaliado do zero. BASE_URL respeita o subcaminho em que
    // o app está publicado — "/" fixo quebraria numa publicação aninhada.
    window.location.replace(import.meta.env.BASE_URL || "/");
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
            <p className="text-muted-foreground text-[17px]">{patient?.timezone}</p>
          </div>
          {/* `flex-wrap` — Issue #17.
              Sem ele, os quatro botoes ficavam numa linha so: no desktop
              cabiam, num celular nao. E o resultado nao era so apertado — o
              botao "Consultas" cobria o de "Tratamento" e interceptava o
              toque, alem de fazer a pagina inteira rolar na horizontal.
              Descoberto pelo Playwright no projeto `celular`, nao por
              relato. */}
          <div className="flex flex-wrap items-center gap-2">
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
            <DialogContent className="sm:max-w-xl">
              <DialogHeader>
                <DialogTitle>Novo tratamento</DialogTitle>
                <DialogDescription>O que o médico prescreveu.</DialogDescription>
              </DialogHeader>
              <TreatmentForm patientId={Number(params.id)} onCreated={handleCreated} onCancel={() => setOpen(false)} />
            </DialogContent>
            </Dialog>

            {/* Edição reusa o MESMO formulário, com `tratamento` preenchido.
                Um formulário só para os dois casos evita o que sempre acontece
                com formulários gêmeos: um ganha campo novo e o outro fica para trás. */}
            <Dialog
              open={editandoTratamento !== null}
              onOpenChange={(aberto) => { if (!aberto) setEditandoTratamento(null); }}
            >
              <DialogContent className="sm:max-w-xl">
                <DialogHeader>
                  <DialogTitle>Editar tratamento</DialogTitle>
                  <DialogDescription>
                    Corrija a posologia, as datas ou as instruções.
                  </DialogDescription>
                </DialogHeader>
                {editandoTratamento && (
                  <TreatmentForm
                    patientId={Number(params.id)}
                    tratamento={{
                      id: editandoTratamento.id,
                      medicationName: editandoTratamento.medicationName,
                      dose: editandoTratamento.dose,
                      scheduleConfig: editandoTratamento.scheduleConfig,
                      startDate: editandoTratamento.startDate,
                      endDate: editandoTratamento.endDate,
                      instructions: editandoTratamento.instructions,
                      escalationProfile: editandoTratamento.escalationProfile,
                    }}
                    onCreated={() => {
                      setEditandoTratamento(null);
                      void queryClient.invalidateQueries({ queryKey: ["treatments", params.id] });
                      // As doses futuras são regeradas quando a posologia muda,
                      // então a tela de hoje também precisa recarregar.
                      void queryClient.invalidateQueries({ queryKey: ["today-doses", params.id] });
                    }}
                    onCancel={() => setEditandoTratamento(null)}
                  />
                )}
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
                    // Issue #26 — `late` continua caindo em "pending" de
                    // propósito: dose atrasada AINDA PODE ser registrada, e
                    // é âmbar pelo invariante 5. `skipped` é que não podia
                    // continuar ali: já foi resolvida, e aparecia "Pendente"
                    // sem botão nenhum, como se a tela tivesse travado.
                    status={d.status === "taken" ? "taken" : d.status === "skipped" ? "skipped" : "pending"}
                    takenAt={horaDoRegistro(d.registeredAt, patient?.timezone)}
                    takenBy={d.registeredByCaregiverName}
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

        {isLoading && <EsqueletoDeTratamentos />}

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
        <div className={`space-y-3 ${isLoading ? "" : "zelo-entra"}`}>
          {activeTreatments.map((t) => (
            <div key={t.id} className="p-4 rounded-xl border bg-card shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[18px] font-semibold">{t.medicationName}</h3>
                  {t.dose && <p className="text-muted-foreground text-[17px]">{t.dose}</p>}
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground">
                    {STATUS_LABELS[t.status] ?? t.status}
                  </span>
                  <Button
                    size="sm"
                    variant="ghost"
                    className="gap-1.5 h-8"
                    onClick={() => setEditandoTratamento(t)}
                  >
                    <Pencil className="w-3.5 h-3.5" /> Editar
                  </Button>
                </div>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {SCHEDULE_LABELS[t.scheduleType] ?? t.scheduleType} · desde {dataCurta(t.startDate)}
                {t.endDate ? ` até ${dataCurta(t.endDate)}` : " · uso contínuo"}
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
                      {t.dose && <p className="text-muted-foreground text-[17px]">{t.dose}</p>}
                    </div>
                    <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground shrink-0">
                      {STATUS_LABELS[t.status] ?? t.status}
                    </span>
                  </div>
                  <p className="text-sm text-muted-foreground mt-2">
                    {SCHEDULE_LABELS[t.scheduleType] ?? t.scheduleType} · desde {dataCurta(t.startDate)}
                    {t.endDate && ` até ${dataCurta(t.endDate)}`}
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
                      <p className="text-xs text-muted-foreground">Receita válida até {dataCurta(s.prescriptionExpiresAt)}</p>
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
                      <CampoNumero value={adjustAmount} onChange={setAdjustAmount} min={0} placeholder={s.unit} className="flex-1" />
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
            {elderModeError && (
              <Alert variant="destructive"><AlertDescription>{elderModeError}</AlertDescription></Alert>
            )}
            {patient?.elderModeEnabled && (
              <div className="space-y-4 pt-1">
                {/* ZELO-58: os dois caminhos, separados e rotulados. O defeito
                    anterior não era existirem os dois — era a tela não dizer
                    qual servia pra quê, e o cuidador ativar no próprio
                    celular sem entender por que não adiantava nada. */}
                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Smartphone className="w-4 h-4 text-zelo-green-fg shrink-0" />
                    <p className="text-sm font-medium">No celular de {patient.name}</p>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-zelo-green-bg text-zelo-green-fg">recomendado</span>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Envie um link. {patient.name} abre no próprio celular e pronto — sem criar senha, sem preencher nada.
                    O aparelho dela não fica com o seu acesso de cuidador.
                  </p>
                  <PatientAccessCard patientId={Number(params.id)} patientName={patient.name} />
                </div>

                <div className="rounded-lg border p-3 space-y-2">
                  <div className="flex items-center gap-2">
                    <Tablet className="w-4 h-4 text-muted-foreground shrink-0" />
                    <p className="text-sm font-medium">Neste aparelho que você está usando agora</p>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Só faz sentido num tablet ou celular que fique com {patient.name} — por exemplo, um aparelho fixo na casa.
                    Ele vai usar a <strong>sua</strong> sessão, e sair exige a sua senha.
                  </p>
                  <Button variant="outline" size="sm" onClick={handleActivateElderModeOnDevice}>
                    Travar este aparelho no modo idoso
                  </Button>
                </div>

                <p className="text-xs text-muted-foreground">
                  Desligar o interruptor acima destrava qualquer aparelho, mesmo à distância.
                </p>
              </div>
            )}
          </div>
        )}

        {/* QUI-7: seção própria do paciente, ao lado de Rotina, Consultas e
            Histórico. Não cabe dentro de nenhuma delas — não é sobre um
            remédio nem sobre uma consulta, é sobre a pessoa. */}
        {patient && <MomentosCard patientId={Number(params.id)} patientName={patient.name} />}

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
