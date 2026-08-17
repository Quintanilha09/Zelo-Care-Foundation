/**
 * Tela inicial — ZELO (ZELO-22).
 *
 * O produto inteiro em uma tela: responde UMA pergunta ("está tudo em dia
 * hoje?") e nada mais. Sem gráfico, sem percentual, sem streak — isso é o
 * oposto do produto. Nenhum elemento vermelho em nenhum estado; o pior
 * estado é âmbar, nunca punitivo ("uma dose ficou sem registro", nunca
 * "você esqueceu").
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { subscribeToPatientEvents } from "@/lib/realtime-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { DoseCard } from "@/components/dose-card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CheckCircle2, AlertCircle, Package, CalendarClock, WifiOff, Pill, Plus, Undo2, Clock as ClockIcon } from "lucide-react";

interface Patient { id: number; name: string; timezone: string; archived: boolean; }

interface HomeDose {
  id: number;
  scheduledAt: string;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  dose: string | null;
  medicationName: string;
  registeredAt: string | null;
  registeredByCaregiverName: string | null;
}

interface HomeData {
  date: string;
  patientTimezone: string;
  doses: HomeDose[];
  lateDoses: number;
  lowStockItems: { medicationName: string; quantityRemaining: number; unit: string }[];
  nextAppointment: { specialty: string; doctorName: string | null; scheduledAt: string } | null;
}

async function fetchPatients(): Promise<Patient[]> {
  const res = await authFetch("/api/patients");
  if (!res.ok) throw new Error("Erro ao carregar pacientes");
  return res.json();
}

async function fetchHome(patientId: number): Promise<HomeData> {
  const res = await authFetch(`/api/patients/${patientId}/today-doses`);
  if (!res.ok) throw new Error("Erro ao carregar o dia");
  return res.json();
}

/** "YYYY-MM-DDTHH:mm" no fuso local do navegador, formato exigido por <input type="datetime-local">. */
function toDatetimeLocalValue(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function HomeSkeleton() {
  return (
    <div className="space-y-4 animate-pulse">
      <div className="h-16 rounded-xl bg-muted" />
      <div className="h-24 rounded-xl bg-muted" />
      <div className="h-16 rounded-xl bg-muted" />
    </div>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isObserver = user?.caregiver?.role === "observer";

  const [selectedPatientId, setSelectedPatientId] = useState<number | null>(
    user?.caregiver?.selectedPatientId ?? null
  );
  const [isOnline, setIsOnline] = useState(navigator.onLine);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  const { data: patients } = useQuery({ queryKey: ["patients"], queryFn: fetchPatients });
  const activePatients = useMemo(() => (patients ?? []).filter((p) => !p.archived), [patients]);

  // Sem seleção salva ainda (primeira vez): usa o primeiro paciente ativo.
  useEffect(() => {
    if (selectedPatientId === null && activePatients.length > 0) {
      setSelectedPatientId(activePatients[0].id);
    }
  }, [selectedPatientId, activePatients]);

  const { data: home, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["home", selectedPatientId],
    queryFn: () => fetchHome(selectedPatientId!),
    enabled: selectedPatientId !== null,
    placeholderData: (prev) => prev, // mantém o último estado conhecido visível (offline/reconectando)
    // ZELO-25: degradação graciosa — o polling roda sempre, independente do
    // SSE estar conectado ou não. SSE só deixa a atualização mais rápida
    // (perto de instantânea) quando funciona; nunca é o único caminho.
    refetchInterval: 60_000,
  });

  // ZELO-25: assina o paciente atual — "o irmão registrou e você vê na
  // hora". onReconnect dispara na primeira conexão e em toda reconexão:
  // busca o estado atual em vez de confiar em eventos perdidos na queda.
  useEffect(() => {
    if (selectedPatientId === null) return;
    const unsubscribe = subscribeToPatientEvents(
      selectedPatientId,
      () => void queryClient.invalidateQueries({ queryKey: ["home", selectedPatientId] }),
      () => void queryClient.invalidateQueries({ queryKey: ["home", selectedPatientId] })
    );
    return unsubscribe;
  }, [selectedPatientId, queryClient]);

  const currentPatient = activePatients.find((p) => p.id === selectedPatientId);

  // Desfazer fica disponível por 60s depois de UM registro que a própria
  // requisição venceu — undoableRecordId aponta pra qual dose_record, não
  // pra dose agendada, já que desfazer é sobre o registro em si.
  const [undoableRecordId, setUndoableRecordId] = useState<number | null>(null);
  const [raceMessage, setRaceMessage] = useState<string | null>(null);

  // ZELO-24: registro retroativo — qual dose está com o horário aberto pra
  // edição, e (só aparece se o servidor pedir) a justificativa de quando
  // o registro cai fora da janela configurada da família.
  const [editingTimeForDose, setEditingTimeForDose] = useState<number | null>(null);
  const [retroTime, setRetroTime] = useState("");
  const [retroJustification, setRetroJustification] = useState("");
  const [justificationNeededFor, setJustificationNeededFor] = useState<number | null>(null);
  const [retroError, setRetroError] = useState<string | null>(null);

  const handleSwitchPatient = async (idStr: string) => {
    const id = Number(idStr);
    setSelectedPatientId(id);
    void authFetch("/api/account/selected-patient", { method: "PATCH", body: JSON.stringify({ patientId: id }) });
  };

  const handleRegister = async (
    doseId: number,
    outcome: "taken" | "skipped",
    opts?: { takenAt?: string; justification?: string }
  ) => {
    if (!selectedPatientId) return;
    setRaceMessage(null);
    setRetroError(null);
    // Otimista: a interface já reage antes da resposta do servidor voltar,
    // e reconcilia (ou se ajusta com uma mensagem simpática) quando ela chega.
    queryClient.setQueryData<HomeData | undefined>(["home", selectedPatientId], (prev) =>
      prev ? { ...prev, doses: prev.doses.map((d) => (d.id === doseId ? { ...d, status: outcome } : d)) } : prev
    );

    const res = await authFetch(`/api/patients/${selectedPatientId}/dose-records`, {
      method: "POST",
      body: JSON.stringify({
        scheduledDoseId: doseId,
        takenAt: opts?.takenAt ?? new Date().toISOString(),
        outcome,
        justification: opts?.justification || undefined,
      }),
    });
    const body = (await res.json().catch(() => null)) as
      | { id: number; wonRace: boolean; message?: string }
      | { error: string; code?: string }
      | null;
    void queryClient.invalidateQueries({ queryKey: ["home", selectedPatientId] });

    if (!res.ok) {
      // A invalidateQueries acima já reverteu o otimismo — o registro não aconteceu de verdade.
      const err = body as { error?: string; code?: string } | null;
      if (err?.code === "JUSTIFICATION_REQUIRED") {
        setJustificationNeededFor(doseId);
        setEditingTimeForDose(doseId);
      } else {
        setRetroError(err?.error ?? "Não foi possível registrar essa dose.");
      }
      return;
    }

    setEditingTimeForDose(null);
    setJustificationNeededFor(null);
    setRetroJustification("");

    const winBody = body as { id: number; wonRace: boolean; message?: string };
    if (winBody.wonRace) {
      setUndoableRecordId(winBody.id);
      setTimeout(() => setUndoableRecordId((cur) => (cur === winBody.id ? null : cur)), 60_000);
    } else {
      // Outro cuidador venceu a corrida — ajusta com mensagem simpática, não erro.
      setRaceMessage(winBody.message ?? "Essa dose já foi registrada por outra pessoa.");
    }
  };

  const openTimeEditor = (doseId: number, defaultDate: Date) => {
    setEditingTimeForDose(doseId);
    setJustificationNeededFor(null);
    setRetroError(null);
    setRetroTime(toDatetimeLocalValue(defaultDate));
    setRetroJustification("");
  };

  const handleUndo = async () => {
    if (!selectedPatientId || !undoableRecordId) return;
    const res = await authFetch(`/api/patients/${selectedPatientId}/dose-records/${undoableRecordId}/undo`, { method: "POST" });
    if (res.ok) {
      setUndoableRecordId(null);
      void queryClient.invalidateQueries({ queryKey: ["home", selectedPatientId] });
    }
  };

  const now = Date.now();
  const pending = (home?.doses ?? []).filter((d) => d.status === "pending");
  const agora = pending.filter((d) => new Date(d.scheduledAt).getTime() <= now);
  const maisTarde = pending.filter((d) => new Date(d.scheduledAt).getTime() > now);
  const jaFoi = (home?.doses ?? []).filter((d) => d.status === "taken" || d.status === "skipped");
  // ZELO-24: uma dose perdida não é sentença — continua registrável,
  // só que retroativamente (o horário real já passou).
  const perdidas = (home?.doses ?? []).filter((d) => d.status === "late");

  const bannerAmber = (home?.lateDoses ?? 0) > 0;

  // ZELO-24: formulário inline de horário real — abre com "Outro horário"
  // (dose de agora) ou automaticamente pra doses perdidas (sempre
  // retroativo). Justificativa só aparece se o servidor pedir.
  const renderTimeEditor = (doseId: number) => {
    if (editingTimeForDose !== doseId) return null;
    return (
      <div className="px-1 space-y-2 bg-muted/50 rounded-lg p-3">
        <label className="text-xs text-muted-foreground block">Horário real</label>
        <Input type="datetime-local" value={retroTime} max={toDatetimeLocalValue(new Date())} onChange={(e) => setRetroTime(e.target.value)} />
        {justificationNeededFor === doseId && (
          <>
            <label className="text-xs text-muted-foreground block">Esse registro é de um tempo atrás — pode contar rapidamente o que aconteceu?</label>
            <Textarea value={retroJustification} onChange={(e) => setRetroJustification(e.target.value)} rows={2} placeholder="Ex: só vi o comprimido em cima da mesa hoje de manhã" />
          </>
        )}
        {retroError && <p className="text-xs text-zelo-amber-fg">{retroError}</p>}
        <div className="flex gap-2">
          <Button
            size="sm"
            onClick={() => void handleRegister(doseId, "taken", { takenAt: new Date(retroTime).toISOString(), justification: retroJustification })}
          >
            Confirmar
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setEditingTimeForDose(null); setJustificationNeededFor(null); setRetroError(null); }}>Cancelar</Button>
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5">
        {!isOnline && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
            <WifiOff className="w-4 h-4 shrink-0" /> Sem conexão — mostrando o último estado conhecido.
          </div>
        )}

        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Cuidando de</p>
            <h2 className="text-2xl font-semibold">{currentPatient?.name ?? "…"}</h2>
          </div>
          {activePatients.length > 1 && (
            <Select value={selectedPatientId ? String(selectedPatientId) : undefined} onValueChange={handleSwitchPatient}>
              <SelectTrigger className="w-40"><SelectValue placeholder="Trocar paciente" /></SelectTrigger>
              <SelectContent>
                {activePatients.map((p) => (
                  <SelectItem key={p.id} value={String(p.id)}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>

        {isLoading && !isPlaceholderData && <HomeSkeleton />}

        {!isLoading && selectedPatientId && activePatients.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium">Nenhum paciente ainda</p>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Cadastre a primeira pessoa que você cuida.</p>
            <Link href="/pacientes"><Button className="gap-2"><Plus className="w-4 h-4" /> Cadastrar paciente</Button></Link>
          </div>
        )}

        {raceMessage && (
          <div className="flex items-center justify-between gap-2 text-sm bg-muted rounded-lg px-3 py-2">
            <span>{raceMessage}</span>
            <Button variant="ghost" size="sm" onClick={() => setRaceMessage(null)}>OK</Button>
          </div>
        )}

        {home && activePatients.length > 0 && (
          <>
            <div
              className={
                bannerAmber
                  ? "rounded-xl border border-zelo-amber/30 bg-zelo-amber-bg px-4 py-3 flex items-center gap-2"
                  : "rounded-xl border border-zelo-green/20 bg-zelo-green-bg px-4 py-3 flex items-center gap-2"
              }
            >
              {bannerAmber ? (
                <>
                  <AlertCircle className="w-5 h-5 text-zelo-amber-fg shrink-0" />
                  <p className="text-zelo-amber-fg font-medium text-[15px]">
                    {home.lateDoses === 1 ? "Uma dose de hoje ficou sem registro." : `${home.lateDoses} doses de hoje ficaram sem registro.`}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-zelo-green-fg shrink-0" />
                  <p className="text-zelo-green-fg font-medium text-[15px]">Tudo em dia hoje.</p>
                </>
              )}
            </div>

            {home.doses.length === 0 && (
              <div className="text-center py-16 border rounded-xl border-dashed">
                <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-foreground font-medium">Nenhum tratamento ativo</p>
                <p className="text-muted-foreground text-sm mt-1 mb-4">Cadastre o primeiro tratamento de {currentPatient?.name}.</p>
                <Link href={`/pacientes/${selectedPatientId}`}><Button className="gap-2"><Plus className="w-4 h-4" /> Cadastrar tratamento</Button></Link>
              </div>
            )}

            {agora.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">Agora</h3>
                <AnimatePresence initial={false}>
                  {agora.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 mb-2">
                      <DoseCard medicationName={d.medicationName} dosage={d.dose ?? ""} time={d.scheduledLocalTime} status="pending" />
                      {!isObserver && editingTimeForDose !== d.id && (
                        <div className="flex items-center gap-2 px-1">
                          <Button className="flex-1" onClick={() => void handleRegister(d.id, "taken")}>✓ Registrar</Button>
                          <Button variant="secondary" onClick={() => void handleRegister(d.id, "skipped")}>Pular</Button>
                          <Button variant="ghost" size="sm" className="gap-1 text-muted-foreground shrink-0" onClick={() => openTimeEditor(d.id, new Date(d.scheduledAt))}>
                            <ClockIcon className="w-3.5 h-3.5" /> Outro horário
                          </Button>
                        </div>
                      )}
                      {!isObserver && renderTimeEditor(d.id)}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {perdidas.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">Perdidas</h3>
                <AnimatePresence initial={false}>
                  {perdidas.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 mb-2">
                      <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-zelo-amber/20 bg-zelo-amber-bg/40 text-[15px]">
                        <span>{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</span>
                        <span className="text-muted-foreground">{d.scheduledLocalTime}</span>
                      </div>
                      {!isObserver && editingTimeForDose !== d.id && (
                        <Button variant="outline" size="sm" className="gap-1" onClick={() => openTimeEditor(d.id, new Date(d.scheduledAt))}>
                          <ClockIcon className="w-3.5 h-3.5" /> Registrar (não é tarde demais)
                        </Button>
                      )}
                      {!isObserver && renderTimeEditor(d.id)}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {maisTarde.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Mais tarde</h3>
                <AnimatePresence initial={false}>
                  {maisTarde.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-card text-[15px] mb-2">
                      <span>{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</span>
                      <span className="text-muted-foreground">{d.scheduledLocalTime}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {jaFoi.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-medium text-muted-foreground">Já foi</h3>
                  {!isObserver && undoableRecordId && (
                    <Button variant="ghost" size="sm" className="gap-1 h-auto py-1" onClick={() => void handleUndo()}>
                      <Undo2 className="w-3.5 h-3.5" /> Desfazer
                    </Button>
                  )}
                </div>
                <AnimatePresence initial={false}>
                  {jaFoi.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-zelo-green-bg/40 text-[15px] mb-2">
                      <span>✓ {d.medicationName} {d.scheduledLocalTime}</span>
                      <span className="text-muted-foreground">{d.registeredByCaregiverName ?? "—"}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {(home.lowStockItems.length > 0 || home.nextAppointment) && (
              <div className="pt-2 space-y-2">
                {home.lowStockItems.map((item, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-zelo-amber-fg bg-zelo-amber-bg rounded-lg px-3 py-2">
                    <Package className="w-4 h-4 shrink-0" /> Estoque baixo: {item.medicationName} ({item.quantityRemaining} {item.unit})
                  </div>
                ))}
                {home.nextAppointment && (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
                    <CalendarClock className="w-4 h-4 shrink-0" />
                    Próxima consulta: {home.nextAppointment.specialty} em {new Date(home.nextAppointment.scheduledAt).toLocaleDateString("pt-BR")}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
}
