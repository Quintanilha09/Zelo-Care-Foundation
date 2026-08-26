/**
 * Painel do dia — todos os pacientes numa tela — ZELO (ZELO-57).
 *
 * A tela inicial responde "está tudo em dia?" para UM paciente por vez.
 * Quem cuida de 8, 12 ou 15 pessoas teria que trocar de paciente uma a
 * uma pra descobrir o que precisa de atenção agora — e é justamente essa
 * pessoa que mais esquece alguém.
 *
 * A régua de tom é a mesma da tela inicial: nenhum elemento vermelho em
 * nenhum estado (o pior é âmbar), nenhum percentual de adesão por
 * paciente e nenhum ranking entre eles. A ordem é por URGÊNCIA — o que
 * precisa de olho agora — nunca por desempenho, senão a tela viraria um
 * placar de quem "está indo pior", o oposto do produto.
 *
 * Não registra dose daqui de propósito: com 15 pessoas na lista, um toque
 * é fácil demais de errar. O registro acontece na tela do paciente, onde
 * medicamento, dose e horário estão visíveis.
 */
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { AppHeader } from "@/components/app-header";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { CheckCircle2, AlertCircle, ChevronRight, Users, Clock } from "lucide-react";

interface PatientSummary {
  patientId: number;
  patientName: string;
  totalDoses: number;
  missedDoses: number;
  dueNowDoses: number;
  upcomingDoses: number;
  takenDoses: number;
  nextDose: { medicationName: string; scheduledLocalTime: string } | null;
}

async function fetchSummary(): Promise<{ patients: PatientSummary[] }> {
  const res = await authFetch("/api/dashboard/today-summary");
  if (!res.ok) throw new Error("Não foi possível carregar o painel do dia.");
  return res.json();
}

/** Uma frase por paciente, descrevendo o estado — nunca culpando alguém. */
function statusLine(p: PatientSummary): string {
  if (p.missedDoses > 0) {
    return p.missedDoses === 1 ? "Uma dose ficou sem registro" : `${p.missedDoses} doses ficaram sem registro`;
  }
  if (p.dueNowDoses > 0) {
    return p.dueNowDoses === 1 ? "Uma dose para agora" : `${p.dueNowDoses} doses para agora`;
  }
  if (p.totalDoses === 0) return "Nenhum remédio hoje";
  if (p.upcomingDoses > 0 && p.nextDose) {
    return `Próxima: ${p.nextDose.medicationName} às ${p.nextDose.scheduledLocalTime}`;
  }
  return "Tudo em dia hoje";
}

export default function TodaySummaryPage() {
  const { data, isLoading, isError, error } = useQuery({
    queryKey: ["today-summary"],
    queryFn: fetchSummary,
    refetchInterval: 60_000,
  });

  const patients = data?.patients ?? [];
  const precisamDeAtencao = patients.filter((p) => p.missedDoses > 0 || p.dueNowDoses > 0);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5">
        <div>
          <h2 className="text-2xl font-semibold">O dia de todos</h2>
          <p className="text-muted-foreground text-[17px]">
            Quem precisa de atenção agora aparece primeiro.
          </p>
        </div>

        {isLoading && (
          <AreaCarregando rotulo="Carregando o resumo do dia">
            <div className="space-y-3">
              <Esqueleto className="h-20" />
              <Esqueleto className="h-20" />
            </div>
          </AreaCarregando>
        )}

        {isError && (
          <div className="rounded-xl border px-4 py-3 text-[17px]">
            {error instanceof Error ? error.message : "Não foi possível carregar o painel do dia."}
          </div>
        )}

        {!isLoading && !isError && patients.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <Users className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium">Nenhum paciente ainda</p>
            <p className="text-muted-foreground text-sm mt-1">
              Cadastre quem você cuida pra ver o dia de todos aqui.
            </p>
          </div>
        )}

        {!isLoading && !isError && patients.length > 0 && (
          <>
            <div
              className={
                precisamDeAtencao.length > 0
                  ? "rounded-xl border border-zelo-amber/30 bg-zelo-amber-bg px-4 py-3 flex items-center gap-2"
                  : "rounded-xl border border-zelo-green/20 bg-zelo-green-bg px-4 py-3 flex items-center gap-2"
              }
            >
              {precisamDeAtencao.length > 0 ? (
                <>
                  <AlertCircle className="w-5 h-5 text-zelo-amber-fg shrink-0" />
                  <p className="text-zelo-amber-fg font-medium text-[17px]">
                    {precisamDeAtencao.length === 1
                      ? "Uma pessoa precisa de atenção agora."
                      : `${precisamDeAtencao.length} pessoas precisam de atenção agora.`}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-zelo-green-fg shrink-0" />
                  <p className="text-zelo-green-fg font-medium text-[17px]">Está tudo em dia hoje.</p>
                </>
              )}
            </div>

            <div className="space-y-3">
              {patients.map((p) => {
                const atencao = p.missedDoses > 0;
                const agora = !atencao && p.dueNowDoses > 0;
                return (
                  <Link key={p.patientId} href={`/?patient=${p.patientId}`}>
                    <a
                      className={`flex items-center gap-4 p-4 rounded-xl border shadow-sm hover:border-primary/40 transition-colors ${
                        atencao
                          ? "border-zelo-amber/30 bg-zelo-amber-bg/40"
                          : agora
                            ? "bg-card"
                            : "bg-card"
                      }`}
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-[17px] font-medium truncate">{p.patientName}</p>
                        <p className={`text-sm ${atencao ? "text-zelo-amber-fg" : "text-muted-foreground"}`}>
                          {statusLine(p)}
                        </p>
                      </div>
                      {agora && <Clock className="w-4 h-4 text-muted-foreground shrink-0" />}
                      <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                    </a>
                  </Link>
                );
              })}
            </div>
          </>
        )}
      </main>
    </div>
  );
}
