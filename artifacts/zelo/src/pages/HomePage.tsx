/**
 * Tela inicial — "Hoje" (ZELO-22, Issue #178).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ELA RESPONDE UMA PERGUNTA: *"o que precisa de mim agora?"*
 *
 * Até 11/09/2026 respondia por **um** paciente — escolhido pelo app e
 * gravado. O fundador, que cuida de quatro: *"a tela inicial mostra que
 * estou cuidando somente de um paciente mas ao clicar na lista mostram os
 * outros"*.
 *
 * Com quatro pacientes, qualquer escolha automática está errada três vezes
 * em quatro. A resposta não era um seletor melhor — era **não escolher**.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Lista de AÇÕES, e não lista de pessoas ───────────────────────────────
 *
 * As doses vêm de todos os pacientes numa lista só, ordenadas por horário,
 * com o nome de quem é em cada cartão. Agrupar por pessoa faria ler quatro
 * blocos para achar as duas coisas que precisam de você.
 *
 * **Com um paciente só, o nome não aparece** e a tela fica idêntica à que
 * sempre foi. Quem está no plano Grátis não vê diferença nenhuma.
 *
 * ── O que esta tela NUNCA vai ter ────────────────────────────────────────
 *
 * Gráfico, percentual, streak, placar por paciente. Nada disso responde "o
 * que precisa de mim agora", e tudo isso transforma cuidado em competição.
 * Nenhum elemento vermelho em nenhum estado de dose: o pior estado é âmbar,
 * nunca punitivo — "uma dose ficou sem registro", jamais "você esqueceu".
 */
import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { subscribeToPatientEvents } from "@/lib/realtime-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { nomeCurto } from "@workspace/nomes";
import { CampoNumero } from "@/components/campo-numero";
import { estaAtrasada, textoDoAtraso } from "@/lib/atraso";
import { usePulsoDeMinuto } from "@/hooks/use-pulso-de-minuto";
import {
  usePulsoDeDesfazer, ultimoPrazoDeDesfazer, podeDesfazer,
} from "@/hooks/use-pode-desfazer";
import { DoseCard } from "@/components/dose-card";
import { AcoesDaDose, DialogosDaDose } from "@/components/acoes-da-dose";
import { SePrecisar, type SeNecessario } from "@/components/se-precisar";
import { useRegistrarDose } from "@/hooks/use-registrar-dose";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, AlertCircle, Package, CalendarClock, WifiOff, Pill, Plus, ChevronRight,
} from "lucide-react";

interface Patient { id: number; name: string; timezone: string; archived: boolean; }

interface DoseDoDia {
  id: number;
  patientId: number;
  patientName: string;
  scheduledAt: string;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late" | "partial";
  dose: string | null;
  medicationName: string;
  registeredAt: string | null;
  registeredByCaregiverName: string | null;
  recordId: number | null;
  desfazerAte: string | null;
  atrasadaApartirDe: string | null;
  correctedAt: string | null;
  correctedByName: string | null;
}

interface ResumoDoPaciente {
  patientId: number;
  patientName: string;
  totalDoses: number;
  missedDoses: number;
  dueNowDoses: number;
  upcomingDoses: number;
  takenDoses: number;
}

interface ODia {
  patients: ResumoDoPaciente[];
  doses: DoseDoDia[];
  /** Issue #154: as doses de amanhã até as 06:00, quando já é noite no fuso de cada paciente. */
  madrugada: DoseDoDia[];
  /**
   * Issue #169: os remédios "se precisar", de todos os pacientes.
   *
   * Fora de `doses` de propósito — eles não estão pendentes, não atrasam e
   * não entram em contagem nenhuma desta tela.
   */
  sePrecisar: SeNecessario[];
  lowStockItems: {
    patientId: number; patientName: string; medicationId: number; medicationName: string;
    quantityRemaining: number; unit: string; effectiveDaysRemaining: number | null;
  }[];
  nextAppointment: {
    patientId: number; patientName: string; specialty: string; doctorName: string | null;
    scheduledAt: string; localDate: string; localTime: string;
  } | null;
}

async function fetchPatients(): Promise<Patient[]> {
  const res = await authFetch("/api/patients");
  if (!res.ok) throw new Error("Erro ao carregar pacientes");
  return res.json();
}

async function fetchODia(): Promise<ODia> {
  const res = await authFetch("/api/dashboard/today-summary");
  if (!res.ok) throw new Error("Erro ao carregar o dia");
  return res.json();
}

/** "quinta-feira, 11 de setembro" — o cabeçalho diz de que dia estamos falando. */
function hojePorExtenso(): string {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date());
}

/**
 * Esqueleto da tela inicial — Issue #5.
 *
 * `animate-pulse` pisca a opacidade em laço infinito, e num app usado por
 * gente com sensibilidade visual isso cansa. `.zelo-esqueleto` passa um
 * brilho, comunica a mesma coisa sem piscar, e para de se mover — sem sumir —
 * quando o sistema pede movimento reduzido.
 */
function HomeSkeleton() {
  return (
    <AreaCarregando rotulo="Carregando o dia de hoje">
      <div className="space-y-4">
        <Esqueleto className="h-16" />
        <Esqueleto className="h-24" />
        <Esqueleto className="h-16" />
      </div>
    </AreaCarregando>
  );
}

export default function HomePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isObserver = user?.caregiver?.role === "observer";

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

  const { data: dia, isLoading, isPlaceholderData } = useQuery({
    queryKey: ["o-dia"],
    queryFn: fetchODia,
    placeholderData: (prev) => prev, // mantém o último estado conhecido visível (offline/reconectando)
    // ZELO-25: degradação graciosa — o polling roda sempre, independente de o
    // SSE estar conectado. O SSE só deixa a atualização quase instantânea
    // quando funciona; nunca é o único caminho.
    refetchInterval: 60_000,
  });

  const invalidar = () => void queryClient.invalidateQueries({ queryKey: ["o-dia"] });

  /**
   * ZELO-25: "o irmão registrou e você vê na hora".
   *
   * Issue #178: assina TODOS os pacientes, e não só o escolhido. A tela
   * mostra o dia de todos, então um registro em qualquer um deles muda o que
   * está na frente de quem olha.
   *
   * `onReconnect` dispara na primeira conexão e em toda reconexão: busca o
   * estado atual em vez de confiar em eventos perdidos na queda.
   */
  const idsDosPacientes = activePatients.map((p) => p.id).join(",");
  useEffect(() => {
    if (!idsDosPacientes) return;
    const cancelar = idsDosPacientes
      .split(",")
      .map((id) => subscribeToPatientEvents(Number(id), invalidar, invalidar));
    return () => { for (const c of cancelar) c(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsDosPacientes, queryClient]);

  // Issue #135: um pulso só para a tela. Ele nem nasce se não houver dose
  // registrada com prazo aberto, e morre no segundo em que o último vence.
  const pulso = usePulsoDeDesfazer(ultimoPrazoDeDesfazer(dia?.doses ?? []));
  // Issue #153: pulso de minuto, para a dose virar atrasada sozinha na tela
  // de quem está com o app aberto esperando o horário chegar.
  const agoraEmMinutos = usePulsoDeMinuto();

  // Issue #162 — um dono só para registrar dose, e o paciente vem da DOSE.
  const dose = useRegistrarDose({
    aoMudar: invalidar,
    // A tela já reagia antes da resposta chegar, e isso continua: o `aoMudar`
    // reconcilia (ou desfaz) quando ela volta.
    otimista: (doseId, desfecho) =>
      queryClient.setQueryData<ODia | undefined>(["o-dia"], (prev) =>
        prev
          ? { ...prev, doses: prev.doses.map((d) => (d.id === doseId ? { ...d, status: desfecho } : d)) }
          : prev,
      ),
  });

  // ZELO-34: "já comprou?" — um toque abre um campo mínimo (quantidade), sem
  // navegar para outra tela. O alerta some sozinho quando os dias restantes
  // voltam a ficar acima do limite.
  const [restockingMedicationId, setRestockingMedicationId] = useState<number | null>(null);
  const [restockAmount, setRestockAmount] = useState("");

  const handleRestock = async (patientId: number, medicationId: number) => {
    const amount = Number(restockAmount);
    if (!amount || amount <= 0) return;
    const res = await authFetch(`/api/patients/${patientId}/stock/${medicationId}`, {
      method: "PATCH",
      body: JSON.stringify({ addQuantity: amount }),
    });
    if (res.ok) {
      setRestockingMedicationId(null);
      setRestockAmount("");
      invalidar();
    }
  };

  const agora = Date.now();
  const todas = dia?.doses ?? [];
  const pendentes = todas.filter((d) => d.status === "pending");
  const deAgora = pendentes.filter((d) => new Date(d.scheduledAt).getTime() <= agora);
  const maisTarde = pendentes.filter((d) => new Date(d.scheduledAt).getTime() > agora);
  // Issue #175: parcial é resolvida, e por isso mora em "Já foi" — deixá-la
  // fora faria a dose sumir da tela depois de registrada.
  const jaFoi = todas.filter((d) => d.status === "taken" || d.status === "skipped" || d.status === "partial");
  // ZELO-24: uma dose perdida não é sentença — continua registrável, só que
  // retroativamente, porque o horário real já passou.
  const perdidas = todas.filter((d) => d.status === "late");

  const semRegistro = (dia?.patients ?? []).reduce((n, p) => n + p.missedDoses, 0);
  const bannerAmber = semRegistro > 0;

  /**
   * O nome do paciente só aparece quando há mais de um.
   *
   * Com um paciente só, a tela inteira já é dele — repetir o nome em cada
   * cartão seria ruído, e ruído faz parar de ler.
   */
  const varios = activePatients.length > 1;
  const deQuem = (d: DoseDoDia) => (varios ? nomeCurto(d.patientName) : null);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-6 space-y-5">
        {!isOnline && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2">
            <WifiOff className="w-4 h-4 shrink-0" /> Sem conexão — mostrando o último estado conhecido.
          </div>
        )}

        {activePatients.length > 0 && (
          <div>
            {/* #178: era "Cuidando de {nome}", e com quatro pacientes isso
                era falso por omissão. O título passou a dizer o que a tela
                realmente mostra. */}
            <h2 className="text-2xl font-semibold">Hoje</h2>
            <p className="text-sm text-muted-foreground first-letter:uppercase">
              {hojePorExtenso()}
              {varios && ` · ${activePatients.length} pessoas`}
            </p>
          </div>
        )}

        {isLoading && !isPlaceholderData && <HomeSkeleton />}

        {/* Esta condição exigia um paciente selecionado, e por isso nunca
            aparecia para quem não tinha nenhum: a seleção automática só
            rodava quando JÁ existia paciente. Sintoma real, relatado: uma
            cuidadora nova via o cabeçalho e nada embaixo. */}
        {!patients ? null : activePatients.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium text-lg">Você ainda não está cuidando de ninguém</p>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Cadastre a primeira pessoa que você cuida pra começar.</p>
            <Link href="/pacientes"><Button className="gap-2"><Plus className="w-4 h-4" /> Cadastrar paciente</Button></Link>
          </div>
        )}

        {/* Issue #162: o aviso e o erro do registro, num lugar só. A corrida
            perdida ("outra pessoa registrou") é INFORMAÇÃO, e por isso é
            neutra; erro de verdade é âmbar, nunca vermelho. */}
        {dose.aviso && (
          <div className="flex items-center gap-2 text-sm bg-muted rounded-lg px-3 py-2">
            <span>{dose.aviso}</span>
          </div>
        )}
        {dose.erro && <p className="text-sm text-zelo-amber-fg px-1">{dose.erro}</p>}

        {dia && activePatients.length > 0 && (
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
                  <p className="text-zelo-amber-fg font-medium text-[17px]">
                    {semRegistro === 1
                      ? "Uma dose de hoje ficou sem registro."
                      : `${semRegistro} doses de hoje ficaram sem registro.`}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-zelo-green-fg shrink-0" />
                  <p className="text-zelo-green-fg font-medium text-[17px]">Tudo em dia hoje.</p>
                </>
              )}
            </div>

            {/* Issue #154: a tela vazia também olha a madrugada. Numa noite
                em que a única dose é às 03:00, `doses` chega vazio — é dia
                civil de amanhã — e sem isto a tela convidaria a cadastrar o
                primeiro tratamento logo abaixo do tratamento que existe. */}
            {todas.length === 0 && dia.madrugada.length === 0 && (
              <div className="text-center py-16 border rounded-xl border-dashed">
                <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-foreground font-medium">Nenhum tratamento ativo</p>
                <p className="text-muted-foreground text-sm mt-1 mb-4">
                  Cadastre o primeiro tratamento de quem você cuida.
                </p>
                <Link href="/pacientes"><Button className="gap-2"><Plus className="w-4 h-4" /> Ver pacientes</Button></Link>
              </div>
            )}

            {deAgora.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">Agora</h3>
                <AnimatePresence initial={false}>
                  {deAgora.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 mb-2">
                      <DoseCard
                        medicationName={d.medicationName}
                        dosage={d.dose ?? ""}
                        time={d.scheduledLocalTime}
                        status="pending"
                        paciente={deQuem(d)}
                        atrasada={estaAtrasada(d.atrasadaApartirDe, agoraEmMinutos)}
                        atrasadaHa={textoDoAtraso(d.scheduledAt, agoraEmMinutos)}
                      />
                      <AcoesDaDose
                        dose={d}
                        controlador={dose}
                        agora={pulso}
                        medicationName={d.medicationName}
                        somenteLeitura={isObserver}
                      />
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
                      <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-zelo-amber/20 bg-zelo-amber-bg/40 text-[17px]">
                        <span className="min-w-0">
                          {d.medicationName}{d.dose ? ` — ${d.dose}` : ""}
                          {deQuem(d) && <span className="text-muted-foreground"> · {deQuem(d)}</span>}
                        </span>
                        <span className="text-muted-foreground shrink-0">{d.scheduledLocalTime}</span>
                      </div>
                      <AcoesDaDose
                        dose={d}
                        controlador={dose}
                        agora={pulso}
                        medicationName={d.medicationName}
                        somenteLeitura={isObserver}
                      />
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
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 mb-2">
                      <div className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg border bg-card text-[17px]">
                        <span className="min-w-0">
                          {d.medicationName}{d.dose ? ` — ${d.dose}` : ""}
                          {deQuem(d) && <span className="text-muted-foreground"> · {deQuem(d)}</span>}
                        </span>
                        <span className="text-muted-foreground shrink-0">{d.scheduledLocalTime}</span>
                      </div>
                      {/* #162/#163: dose que ainda não chegou tem caminho — o
                          discreto "Já dei este remédio", que abre a pergunta
                          da #134 e deixa escolher o horário real. Antes esta
                          seção era só leitura, e registrar uma dose de mais
                          tarde pela tela inicial era impossível. */}
                      <AcoesDaDose
                        dose={d}
                        controlador={dose}
                        agora={pulso}
                        medicationName={d.medicationName}
                        somenteLeitura={isObserver}
                        compacto
                      />
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* Issue #154 — a madrugada seguinte, agora de todos.

                Sem botão de registrar, de propósito: é aviso, não ação.
                Quem decide que já é noite é o servidor, no fuso de CADA
                paciente. Durante o dia esta lista chega vazia. */}
            {dia.madrugada.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Madrugada</h3>
                <p className="text-sm text-muted-foreground -mt-1">Para você já se organizar hoje.</p>
                {dia.madrugada.map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-dashed bg-card text-[17px] mb-2"
                  >
                    <span className="min-w-0">
                      {d.medicationName}{d.dose ? ` — ${d.dose}` : ""}
                      {deQuem(d) && <span className="text-muted-foreground"> · {deQuem(d)}</span>}
                    </span>
                    {/* O dia entra AQUI e só aqui. Nos cartões de hoje seria
                        ruído — a tela já diz que é hoje. */}
                    <span className="text-muted-foreground shrink-0">Amanhã, {d.scheduledLocalTime}</span>
                  </div>
                ))}
              </div>
            )}

            {jaFoi.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Já foi</h3>
                <AnimatePresence initial={false}>
                  {jaFoi.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg border bg-zelo-green-bg/40 text-[17px] mb-2">
                      <span className="min-w-0">
                        ✓ {d.medicationName} {d.scheduledLocalTime}
                        {deQuem(d) && <span className="text-muted-foreground"> · {deQuem(d)}</span>}
                      </span>
                      {/* #135: o desfazer mora na LINHA da dose — com duas
                          registradas, um botão só no cabeçalho não diria qual
                          delas ele desfaria.

                          #164: passado o minuto, o que aparece é CORRIGIR. */}
                      <div className="flex items-center gap-2 shrink-0">
                        {d.correctedAt ? (
                          <span className="text-xs text-muted-foreground">
                            Corrigido{d.correctedByName ? ` por ${nomeCurto(d.correctedByName)}` : ""}
                          </span>
                        ) : (
                          !isObserver && d.recordId !== null && !podeDesfazer(d.desfazerAte, pulso) && (
                            <span className="text-muted-foreground text-sm">{d.registeredByCaregiverName ?? "—"}</span>
                          )
                        )}
                        <AcoesDaDose
                          dose={d}
                          controlador={dose}
                          agora={pulso}
                          medicationName={d.medicationName}
                          somenteLeitura={isObserver}
                          compacto
                        />
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* ── Issue #169: o que já precisou ────────────────────────────

                Depois do dia inteiro, e antes do mapa de quem se cuida. É a
                resposta a "o que já precisou", que só faz sentido depois de
                "o que falta fazer" — e nunca no meio dele. */}
            <SePrecisar
              itens={dia.sePrecisar ?? []}
              mostrarPaciente={varios}
              somenteLeitura={isObserver}
              aoRegistrar={() => void queryClient.invalidateQueries({ queryKey: ["o-dia"] })}
            />

            {/* ── Issue #178: quem você cuida, no RODAPÉ ───────────────────

                É o mapa depois da ação, não antes dela. Só existe com mais de
                uma pessoa: com uma só, a tela inteira já é dela.

                Sem percentual e sem nota — ranquear pacientes é o oposto
                deste produto. O que cada linha diz é o que falta fazer. */}
            {varios && (
              <div className="space-y-2 pt-2">
                <h3 className="text-sm font-medium text-muted-foreground">Quem você cuida</h3>
                {dia.patients.map((p) => {
                  const precisa = p.missedDoses > 0;
                  const agoraDele = p.dueNowDoses > 0;
                  const linha = precisa
                    ? p.missedDoses === 1 ? "1 sem registro" : `${p.missedDoses} sem registro`
                    : agoraDele
                      ? p.dueNowDoses === 1 ? "1 para agora" : `${p.dueNowDoses} para agora`
                      : p.totalDoses === 0
                        ? "sem tratamento hoje"
                        : "tudo em dia";
                  return (
                    <Link key={p.patientId} href={`/pacientes/${p.patientId}`} asChild>
                      <a className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border bg-card hover:border-primary/40 transition-colors">
                        <span className="min-w-0 truncate" title={p.patientName}>{nomeCurto(p.patientName)}</span>
                        <span className="flex items-center gap-2 shrink-0">
                          <span className={`text-sm ${precisa ? "text-zelo-amber-fg font-medium" : "text-muted-foreground"}`}>
                            {linha}
                          </span>
                          <ChevronRight className="w-4 h-4 text-muted-foreground" />
                        </span>
                      </a>
                    </Link>
                  );
                })}
              </div>
            )}

            {(dia.lowStockItems.length > 0 || dia.nextAppointment) && (
              <div className="pt-2 space-y-2">
                {dia.lowStockItems.map((item) => (
                  <div key={`${item.patientId}-${item.medicationId}`} className="text-sm text-zelo-amber-fg bg-zelo-amber-bg rounded-lg px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 shrink-0" />
                      {/* Issue #88: nome de medicamento também é texto do
                          usuário, e uma palavra comprida aqui empurra a
                          página igual a um nome de paciente. */}
                      <span className="flex-1 min-w-0">
                        Estoque baixo: {item.medicationName} ({item.quantityRemaining} {item.unit})
                        {varios && ` — ${nomeCurto(item.patientName)}`}
                        {item.effectiveDaysRemaining !== null && ` · cerca de ${Math.round(item.effectiveDaysRemaining)} dia(s)`}
                      </span>
                      {restockingMedicationId !== item.medicationId && (
                        <button
                          type="button"
                          className="underline shrink-0"
                          onClick={() => { setRestockingMedicationId(item.medicationId); setRestockAmount(""); }}
                        >
                          Já comprou?
                        </button>
                      )}
                    </div>
                    {restockingMedicationId === item.medicationId && (
                      <div className="flex items-center gap-2">
                        <CampoNumero
                          value={restockAmount}
                          onChange={setRestockAmount}
                          min={1}
                          placeholder={`Quantos ${item.unit}?`}
                          className="flex-1"
                        />
                        <Button size="sm" onClick={() => void handleRestock(item.patientId, item.medicationId)}>Registrar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRestockingMedicationId(null)}>Cancelar</Button>
                      </div>
                    )}
                  </div>
                ))}
                {dia.nextAppointment && (
                  <Link href={`/pacientes/${dia.nextAppointment.patientId}/consultas`} asChild>
                    <a className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2 hover:bg-muted/70">
                      <CalendarClock className="w-4 h-4 shrink-0" />
                      Próxima consulta: {dia.nextAppointment.specialty}
                      {varios && ` de ${nomeCurto(dia.nextAppointment.patientName)}`}
                      {" "}em {dia.nextAppointment.localDate.split("-").reverse().join("/")}
                    </a>
                  </Link>
                )}
              </div>
            )}
          </>
        )}

        {/* Issue #162 — os modais moram na tela, não no cartão: um por dose
            criaria dez instâncias da mesma caixa esperando para abrir. */}
        <DialogosDaDose controlador={dose} />
      </main>
    </div>
  );
}
