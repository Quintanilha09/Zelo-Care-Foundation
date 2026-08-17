import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { AppHeader } from "@/components/app-header";
import { TreatmentForm } from "@/components/treatment-form";
import { DoseCard } from "@/components/dose-card";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ArrowLeft, Plus, Pill } from "lucide-react";

interface Patient {
  id: number;
  name: string;
  timezone: string;
  archived: boolean;
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

const SCHEDULE_LABELS: Record<string, string> = {
  times_per_day: "vezes ao dia",
  every_n_hours: "a cada X horas",
  specific_weekdays: "dias específicos da semana",
  alternate_days: "dias alternados",
  cycle_with_pause: "ciclo com pausa",
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

export default function PatientDetailPage({ params }: { params: { id: string } }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => fetchPatient(params.id) });
  const { data: treatments, isLoading } = useQuery({ queryKey: ["treatments", params.id], queryFn: () => fetchTreatments(params.id) });
  const { data: todayDoses } = useQuery({ queryKey: ["today-doses", params.id], queryFn: () => fetchTodayDoses(params.id) });

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
  };

  const handleRegister = async (doseId: number, outcome: "taken" | "skipped") => {
    const res = await authFetch(`/api/patients/${params.id}/dose-records`, {
      method: "POST",
      body: JSON.stringify({ scheduledDoseId: doseId, takenAt: new Date().toISOString(), outcome }),
    });
    if (res.ok) void queryClient.invalidateQueries({ queryKey: ["today-doses", params.id] });
  };

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

        {treatments && treatments.length > 0 && (
          <h3 className="text-sm font-medium text-muted-foreground">Tratamentos</h3>
        )}
        <div className="space-y-3">
          {treatments?.map((t) => (
            <div key={t.id} className="p-4 rounded-xl border bg-card shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-[18px] font-semibold">{t.medicationName}</h3>
                  {t.dose && <p className="text-muted-foreground text-[15px]">{t.dose}</p>}
                </div>
                <span className="text-xs px-2.5 py-1 rounded-full bg-muted text-muted-foreground shrink-0">
                  {t.status === "active" ? "Ativo" : t.status}
                </span>
              </div>
              <p className="text-sm text-muted-foreground mt-2">
                {SCHEDULE_LABELS[t.scheduleType] ?? t.scheduleType} · desde {new Date(t.startDate).toLocaleDateString("pt-BR")}
                {t.endDate && ` até ${new Date(t.endDate).toLocaleDateString("pt-BR")}`}
              </p>
            </div>
          ))}
        </div>
      </main>
    </div>
  );
}
