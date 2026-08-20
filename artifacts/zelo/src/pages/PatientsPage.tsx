import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { AppHeader } from "@/components/app-header";
import { PatientForm } from "@/components/patient-form";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Plus, User, ChevronRight, Heart } from "lucide-react";

interface Patient {
  id: number;
  name: string;
  birthDate: string | null;
  timezone: string;
  archived: boolean;
}

async function fetchPatients(): Promise<Patient[]> {
  const res = await authFetch("/api/patients");
  if (!res.ok) throw new Error("Erro ao carregar pacientes");
  return res.json();
}

export default function PatientsPage() {
  const [open, setOpen] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState("");
  const queryClient = useQueryClient();
  const { data: patients, isLoading } = useQuery({ queryKey: ["patients"], queryFn: fetchPatients });

  const handleCreated = () => {
    setOpen(false);
    setPaywallMessage("");
    void queryClient.invalidateQueries({ queryKey: ["patients"] });
  };

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setPaywallMessage("");
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Quem você cuida</h2>
            <p className="text-muted-foreground text-[15px]">Escolha um paciente para ver os tratamentos.</p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <Button onClick={() => setOpen(true)} className="gap-2">
              <Plus className="w-4 h-4" />
              Adicionar
            </Button>
            <DialogContent className="max-w-lg">
              {paywallMessage ? (
                <>
                  <DialogHeader>
                    <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-zelo-green-bg flex items-center justify-center">
                      <Heart className="w-5 h-5 text-zelo-green-fg" />
                    </div>
                    <DialogTitle className="text-center">Cuidar junto é melhor</DialogTitle>
                    <DialogDescription className="text-center">{paywallMessage}</DialogDescription>
                  </DialogHeader>
                  <div className="flex justify-center gap-2 pt-2">
                    <Button variant="ghost" onClick={() => setOpen(false)}>Agora não</Button>
                    <Link href="/planos"><Button>Ver planos</Button></Link>
                  </div>
                </>
              ) : (
                <>
                  <DialogHeader>
                    <DialogTitle>Cadastrar paciente</DialogTitle>
                    <DialogDescription>Leva menos de um minuto.</DialogDescription>
                  </DialogHeader>
                  <PatientForm onCreated={handleCreated} onCancel={() => setOpen(false)} onPaywall={setPaywallMessage} />
                </>
              )}
            </DialogContent>
          </Dialog>
        </div>

        {isLoading && <p className="text-muted-foreground text-center py-12">Carregando…</p>}

        {!isLoading && patients?.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <User className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium">Nenhum paciente ainda</p>
            <p className="text-muted-foreground text-sm mt-1">Cadastre a primeira pessoa que você cuida.</p>
          </div>
        )}

        <div className="space-y-3">
          {patients?.filter((p) => !p.archived).map((patient) => (
            <Link key={patient.id} href={`/pacientes/${patient.id}`}>
              <a className="flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm hover:border-primary/40 transition-colors">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="flex-1">
                  <p className="text-[18px] font-medium">{patient.name}</p>
                  <p className="text-sm text-muted-foreground">{patient.timezone}</p>
                </div>
                <ChevronRight className="w-5 h-5 text-muted-foreground" />
              </a>
            </Link>
          ))}
        </div>
      </main>
    </div>
  );
}
