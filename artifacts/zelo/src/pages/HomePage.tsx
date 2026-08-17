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
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { DoseCard } from "@/components/dose-card";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Package, CalendarClock, WifiOff, Pill, Plus } from "lucide-react";

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
  });

  const currentPatient = activePatients.find((p) => p.id === selectedPatientId);

  const handleSwitchPatient = async (idStr: string) => {
    const id = Number(idStr);
    setSelectedPatientId(id);
    void authFetch("/api/account/selected-patient", { method: "PATCH", body: JSON.stringify({ patientId: id }) });
  };

  const handleRegister = async (doseId: number, outcome: "taken" | "skipped") => {
    if (!selectedPatientId) return;
    const res = await authFetch(`/api/patients/${selectedPatientId}/dose-records`, {
      method: "POST",
      body: JSON.stringify({ scheduledDoseId: doseId, takenAt: new Date().toISOString(), outcome }),
    });
    if (res.ok) void queryClient.invalidateQueries({ queryKey: ["home", selectedPatientId] });
  };

  const now = Date.now();
  const pending = (home?.doses ?? []).filter((d) => d.status === "pending");
  const agora = pending.filter((d) => new Date(d.scheduledAt).getTime() <= now);
  const maisTarde = pending.filter((d) => new Date(d.scheduledAt).getTime() > now);
  const jaFoi = (home?.doses ?? []).filter((d) => d.status === "taken" || d.status === "skipped");

  const bannerAmber = (home?.lateDoses ?? 0) > 0;

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
                {agora.map((d) => (
                  <div key={d.id} className="space-y-2">
                    <DoseCard medicationName={d.medicationName} dosage={d.dose ?? ""} time={d.scheduledLocalTime} status="pending" />
                    {!isObserver && (
                      <div className="flex gap-2 px-1">
                        <Button className="flex-1" onClick={() => void handleRegister(d.id, "taken")}>✓ Registrar</Button>
                        <Button variant="secondary" onClick={() => void handleRegister(d.id, "skipped")}>Pular</Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}

            {maisTarde.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Mais tarde</h3>
                {maisTarde.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-card text-[15px]">
                    <span>{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</span>
                    <span className="text-muted-foreground">{d.scheduledLocalTime}</span>
                  </div>
                ))}
              </div>
            )}

            {jaFoi.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Já foi</h3>
                {jaFoi.map((d) => (
                  <div key={d.id} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-zelo-green-bg/40 text-[15px]">
                    <span>✓ {d.medicationName} {d.scheduledLocalTime}</span>
                    <span className="text-muted-foreground">{d.registeredByCaregiverName ?? "—"}</span>
                  </div>
                ))}
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
