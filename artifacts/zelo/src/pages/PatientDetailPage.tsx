import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { AppHeader } from "@/components/app-header";
import { TreatmentForm } from "@/components/treatment-form";
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

export default function PatientDetailPage({ params }: { params: { id: string } }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();

  const { data: patient } = useQuery({ queryKey: ["patient", params.id], queryFn: () => fetchPatient(params.id) });
  const { data: treatments, isLoading } = useQuery({ queryKey: ["treatments", params.id], queryFn: () => fetchTreatments(params.id) });

  const handleCreated = () => {
    setOpen(false);
    void queryClient.invalidateQueries({ queryKey: ["treatments", params.id] });
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

        {isLoading && <p className="text-muted-foreground text-center py-12">Carregando…</p>}

        {!isLoading && treatments?.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium">Nenhum tratamento ainda</p>
            <p className="text-muted-foreground text-sm mt-1">Cadastre o primeiro medicamento.</p>
          </div>
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
