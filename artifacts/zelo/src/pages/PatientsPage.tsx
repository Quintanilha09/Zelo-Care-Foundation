import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { PatientForm } from "@/components/patient-form";
import { PlanPaywall } from "@/components/plan-paywall";
import { patientLimitReached, patientLimitMessage } from "@/lib/plan-limits-client";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { cn } from "@/lib/utils";
import { nomeCurto } from "@workspace/nomes";
import { Plus, User, ChevronRight, UserX } from "lucide-react";

/**
 * Esqueleto da lista de pacientes — Issue #5.
 *
 * O formato imita a linha real: círculo do avatar à esquerda, nome e fuso à
 * direita. É por isso que a tela não pula quando os pacientes chegam — o
 * espaço já estava reservado no tamanho certo.
 *
 * Três linhas, não dez. Quase toda família cuida de uma ou duas pessoas, e um
 * esqueleto mais longo que a lista real promete conteúdo que não vem.
 */
function EsqueletoDaLista() {
  return (
    <AreaCarregando rotulo="Carregando os pacientes">
      <div className="space-y-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-xl border">
            <Esqueleto className="w-12 h-12 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Esqueleto className="h-5 w-1/2" />
              <Esqueleto className="h-3.5 w-1/3" />
            </div>
          </div>
        ))}
      </div>
    </AreaCarregando>
  );
}

interface Responsavel {
  id: number;
  name: string;
}

interface Patient {
  id: number;
  name: string;
  birthDate: string | null;
  timezone: string;
  archived: boolean;
  /**
   * Issue #122. Opcional de propósito: o app é uma PWA e o service worker
   * pode servir uma resposta gravada antes desta issue existir. Sem o `?`, o
   * TypeScript deixaria de exigir o `?? []`, e a primeira abertura offline
   * depois de atualizar quebraria em `.length` de `undefined`.
   */
  responsaveis?: Responsavel[];
}

/**
 * Paciente descoberto — Issue #122.
 *
 * ══════════════════════════════════════════════════════════════════════════
 * "SEM CUIDADOR" NÃO É "SEM ACESSO".
 *
 * Um paciente sem responsável continua visível e registrável por todo
 * cuidador da família, exatamente como antes. O destaque diz *"falta apontar
 * alguém"*, não *"este paciente está trancado"* — e nada nesta tela bloqueia
 * o que quer que seja por causa disso.
 * ══════════════════════════════════════════════════════════════════════════
 */
function semResponsavel(p: Patient): boolean {
  return (p.responsaveis ?? []).length === 0;
}

async function fetchPatients(): Promise<Patient[]> {
  const res = await authFetch("/api/patients");
  if (!res.ok) throw new Error("Erro ao carregar pacientes");
  return res.json();
}

export default function PatientsPage() {
  const [open, setOpen] = useState(false);
  const [paywallMessage, setPaywallMessage] = useState("");
  const [soDescobertos, setSoDescobertos] = useState(false);
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: patients, isLoading } = useQuery({ queryKey: ["patients"], queryFn: fetchPatients });

  const activePatients = (patients ?? []).filter((p) => !p.archived);
  const descobertos = activePatients.filter(semResponsavel);

  /**
   * O filtro só existe enquanto há o que filtrar — critério de aceite da
   * #122: nada de filtro que só devolve lista vazia.
   *
   * `filtrando` é derivado, e não um `useEffect` que desliga o estado. Se
   * alguém vincula um cuidador ao último paciente descoberto com o filtro
   * ligado, `descobertos` esvazia no mesmo render e a lista inteira volta —
   * sem tela vazia no meio do caminho, e sem um efeito para dar manutenção.
   */
  const filtroDisponivel = descobertos.length > 0;
  const filtrando = soDescobertos && filtroDisponivel;
  const visiveis = filtrando ? descobertos : activePatients;

  const handleCreated = () => {
    setOpen(false);
    setPaywallMessage("");
    void queryClient.invalidateQueries({ queryKey: ["patients"] });
  };

  const handleOpenChange = (o: boolean) => {
    setOpen(o);
    if (!o) setPaywallMessage("");
  };

  // Checar ANTES de abrir o formulário: preencher nome, data de nascimento e
  // consentimento pra só no "Salvar" ouvir que o plano não permite é um
  // desperdício do tempo de quem cuida. O 403 do servidor continua tratado
  // (é ele a autoridade) — isto só evita o caminho inútil.
  const handleAddClick = () => {
    if (patientLimitReached(user?.plan, activePatients.length)) {
      setPaywallMessage(patientLimitMessage(user?.plan));
    }
    setOpen(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Quem você cuida</h2>
            <p className="text-muted-foreground text-[17px]">Escolha um paciente para ver os tratamentos.</p>
          </div>
          <Dialog open={open} onOpenChange={handleOpenChange}>
            <Button onClick={handleAddClick} className="gap-2">
              <Plus className="w-4 h-4" />
              Adicionar
            </Button>
            <DialogContent className="max-w-lg">
              {paywallMessage ? (
                <PlanPaywall
                  title="Mais uma pessoa pra cuidar"
                  message={paywallMessage}
                  onDismiss={() => setOpen(false)}
                />
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

        {isLoading && <EsqueletoDaLista />}

        {/* ── Filtro "sem cuidador" — Issue #122 ─────────────────────────────

            SOBRE O NÚMERO NO BOTÃO, e por que ele não é o placar que o
            CON-012 proíbe.

            O CON-012 proíbe contagem em Momentos porque lá o número seria
            *de uma pessoa*: quantas fotos cada cuidador mandou vira ranking,
            e ranking transforma cuidar em competir.

            Este número não é de ninguém. Ele conta PACIENTES A QUEM FALTA
            ALGO, sem nome de cuidador em lugar nenhum, e o caminho dele é
            para zero — some da tela quando o trabalho acaba. É contagem de
            pendência, como a de uma caixa de entrada, e não saldo que alguém
            acumula. Numa instituição com quarenta pacientes, saber que são
            dois e não trinta é a diferença entre uma tarde e uma semana.

            Se um dia isto virar "cuidador X tem 5 descobertos", aí sim é o
            que o CON-012 proíbe — e a linha está escrita aqui para ser
            lembrada por quem for mexer. */}
        {!isLoading && filtroDisponivel && (
          <div className="flex items-center gap-3 flex-wrap">
            <Button
              type="button"
              variant={filtrando ? "default" : "outline"}
              size="sm"
              aria-pressed={filtrando}
              onClick={() => setSoDescobertos((v) => !v)}
              className="gap-2"
            >
              <UserX className="w-4 h-4" />
              Sem cuidador ({descobertos.length})
            </Button>
            {filtrando && (
              <p className="text-sm text-muted-foreground">
                Mostrando só quem ainda não tem responsável.
              </p>
            )}
          </div>
        )}

        {!isLoading && patients?.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <User className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium">Nenhum paciente ainda</p>
            <p className="text-muted-foreground text-sm mt-1">Cadastre a primeira pessoa que você cuida.</p>
          </div>
        )}

        <div className={`space-y-3 ${isLoading ? "" : "zelo-entra"}`}>
          {visiveis.map((patient) => {
            const descoberto = semResponsavel(patient);
            const responsaveis = patient.responsaveis ?? [];
            return (
              <Link key={patient.id} href={`/pacientes/${patient.id}`} asChild>
                {/* Âmbar, nunca vermelho — invariante 5. "Falta vincular
                    alguém" é pendência; vermelho neste produto é ação
                    destrutiva, e confundir os dois ensina a pessoa errada a
                    ter medo da tela. */}
                <a
                  data-descoberto={descoberto ? "sim" : "nao"}
                  className={cn(
                    "flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm transition-colors",
                    descoberto
                      ? "border-zelo-amber/40 bg-zelo-amber-bg hover:border-zelo-amber"
                      : "hover:border-primary/40",
                  )}
                >
                  <div
                    className={cn(
                      "w-12 h-12 rounded-full flex items-center justify-center shrink-0",
                      descoberto ? "bg-zelo-amber/20" : "bg-muted",
                    )}
                  >
                    <User
                      className={cn(
                        "w-6 h-6",
                        descoberto ? "text-zelo-amber-fg" : "text-muted-foreground",
                      )}
                    />
                  </div>
                  {/* Issue #88. Duas coisas, e as duas precisam existir:

                      `min-w-0` - sem ele este item de flex NAO ENCOLHE abaixo
                      da largura do proprio conteudo (`min-width: auto` e o
                      padrao), entao uma palavra comprida empurra a linha e a
                      pagina inteira ganha rolagem horizontal. `flex-1` nao
                      resolve: ele e `flex: 1 1 0%`, e o `min-width: auto`
                      vence a base zero.

                      `nomeCurto` - decisao do fundador: guardar completo,
                      mostrar curto. O nome inteiro fica no `title`, e continua
                      inteiro na ficha e na exportacao.

                      Issue #122: a linha de responsaveis mora dentro do mesmo
                      `min-w-0` e leva `truncate` por conta propria - quatro
                      nomes emendados sao mais compridos que qualquer nome de
                      paciente, e o celular e onde isso aparece primeiro. */}
                  <div className="flex-1 min-w-0">
                    <p className="text-[18px] font-medium" title={patient.name}>
                      {nomeCurto(patient.name)}
                    </p>
                    {descoberto ? (
                      <p className="text-sm text-zelo-amber-fg font-medium flex items-center gap-1.5">
                        <UserX className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        Ninguém é responsável ainda
                      </p>
                    ) : (
                      <p
                        className="text-sm text-muted-foreground truncate"
                        title={responsaveis.map((r) => r.name).join(", ")}
                      >
                        Responsável: {responsaveis.map((r) => nomeCurto(r.name)).join(", ")}
                      </p>
                    )}
                    <p className="text-sm text-muted-foreground">{patient.timezone}</p>
                  </div>
                  <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
                </a>
              </Link>
            );
          })}
        </div>
      </main>
    </div>
  );
}
