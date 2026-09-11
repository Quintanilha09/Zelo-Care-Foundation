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
import { useRegistrarDose } from "@/hooks/use-registrar-dose";
import { Button } from "@/components/ui/button";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { CheckCircle2, AlertCircle, Package, CalendarClock, WifiOff, Pill, Plus, LayoutList } from "lucide-react";

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
  // Issue #135: o id do registro e o instante ate quando ele pode ser
  // desfeito. Os dois vem do servidor; a tela nao conhece o prazo.
  recordId: number | null;
  desfazerAte: string | null;
  /** Issue #153: instante a partir do qual a dose conta como atrasada. */
  atrasadaApartirDe: string | null;
  /**
   * Issue #162 — a marca de que houve emenda.
   *
   * A API sempre devolveu os dois; era este TIPO que os omitia, e por isso a
   * tela inicial nao tinha como mostrar que um registro foi corrigido. A
   * ficha do paciente mostrava desde a #136.
   */
  correctedAt: string | null;
  correctedByName: string | null;
}

interface HomeData {
  date: string;
  patientTimezone: string;
  doses: HomeDose[];
  lateDoses: number;
  /**
   * Issue #154: as doses de amanha ate as 06:00.
   *
   * Vazio durante o dia. Quem decide que ja e noite e o SERVIDOR, porque
   * 18:00 tem de ser 18:00 no relogio do PACIENTE — um filho em Portugal
   * olhando a mae em Sao Paulo tem outro relogio no navegador.
   */
  madrugada: HomeDose[];
  lowStockItems: { medicationId: number; medicationName: string; quantityRemaining: number; unit: string; effectiveDaysRemaining: number | null }[];
  nextAppointment: { specialty: string; doctorName: string | null; scheduledAt: string; localDate: string; localTime: string } | null;
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

/**
 * Esqueleto da tela inicial — Issue #5.
 *
 * Trocado o `animate-pulse` do Tailwind pelo `.zelo-esqueleto`: pulse pisca a
 * opacidade em laco infinito, e num app usado por gente com sensibilidade
 * visual isso cansa. O brilho que atravessa comunica a mesma coisa sem piscar,
 * e para de se mover — sem sumir — quando o sistema pede movimento reduzido.
 *
 * As alturas imitam o que vai chegar: cabecalho do paciente, cartao da proxima
 * dose, resumo do dia. Assim a tela nao pula quando o conteudo entra.
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

  // ZELO-28: abrir o app a partir de uma notificação (?patient=ID) troca
  // pro paciente daquela dose, mesmo que outro estivesse selecionado — o
  // link é um sinal de intenção mais forte que a última seleção salva. Só
  // uma vez (o array de dependências vazio já garante isso); limpa a URL
  // depois pra não reforçar a troca de novo num F5.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const patientParam = params.get("patient");
    if (!patientParam) return;
    const id = Number(patientParam);
    if (!Number.isNaN(id) && id > 0) void handleSwitchPatient(String(id));
    window.history.replaceState({}, "", window.location.pathname);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Issue #135: um pulso so para a tela. Ele nem nasce se nao houver dose
  // registrada com prazo aberto, e morre no segundo em que o ultimo vence.
  // Issue #153: pulso de minuto, para a dose virar atrasada sozinha na tela
  // de quem esta com o app aberto esperando o horario chegar.
  const agoraEmMinutos = usePulsoDeMinuto();
  const pulso = usePulsoDeDesfazer(ultimoPrazoDeDesfazer(home?.doses ?? []));

  /**
   * Issue #135 — o prazo de desfazer passou a vir do SERVIDOR.
   *
   * Antes era um `undoableRecordId` no estado do React, apagado por um
   * `setTimeout` de 60 s, e só para quem tivesse **vencido a corrida** do
   * registro. Isso perdia o desfazer ao recarregar a página, escondia-o de
   * quem não registrou, e não existia na ficha do paciente.
   *
   * Agora cada dose já registrada traz `desfazerAte`, e o botão mora na
   * linha da própria dose — antes era um botão só no cabeçalho de "Já foi",
   * e com duas doses registradas não dava para saber qual delas ele
   * desfaria.
   */
  // Issue #162 — um dono so para registrar dose.
  //
  // Isto era sete estados soltos e quatro funcoes nesta tela, e OUTRAS
  // sete e quatro na ficha do paciente — que divergiram. O hook e o
  // `AcoesDaDose` sao o mesmo produto nas duas telas.
  const dose = useRegistrarDose({
    patientId: selectedPatientId ?? 0,
    aoMudar: () => void queryClient.invalidateQueries({ queryKey: ["home", selectedPatientId] }),
    // A tela inicial ja reagia antes da resposta chegar, e isso continua:
    // o `aoMudar` acima reconcilia (ou desfaz) quando ela volta.
    otimista: (doseId, desfecho) =>
      queryClient.setQueryData<HomeData | undefined>(["home", selectedPatientId], (prev) =>
        prev
          ? { ...prev, doses: prev.doses.map((d) => (d.id === doseId ? { ...d, status: desfecho } : d)) }
          : prev,
      ),
  });

  // ZELO-34: "já comprou?" — um toque abre um campo mínimo (quantidade),
  // não navega pra outra tela. O alerta em si (lowStockItems) já vem
  // recalculado do servidor a cada busca; some sozinho quando os dias
  // restantes voltam a ficar acima do limite.
  const [restockingMedicationId, setRestockingMedicationId] = useState<number | null>(null);
  const [restockAmount, setRestockAmount] = useState("");

  const handleSwitchPatient = async (idStr: string) => {
    const id = Number(idStr);
    setSelectedPatientId(id);
    void authFetch("/api/account/selected-patient", { method: "PATCH", body: JSON.stringify({ patientId: id }) });
  };

  const handleRestock = async (medicationId: number) => {
    const amount = Number(restockAmount);
    if (!amount || amount <= 0) return;
    const res = await authFetch(`/api/patients/${selectedPatientId}/stock/${medicationId}`, {
      method: "PATCH",
      body: JSON.stringify({ addQuantity: amount }),
    });
    if (res.ok) {
      setRestockingMedicationId(null);
      setRestockAmount("");
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
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              {/* Issue #88: este `div` era filho de flex sem `min-w-0`, e o
                  `h2` trazia o nome completo. Um nome de 49 caracteres - que
                  a validacao aceita porque e nome de gente - empurrava o
                  seletor de paciente para fora da tela. */}
              <div className="min-w-0">
                <p className="text-sm text-muted-foreground">Cuidando de</p>
                <h2 className="text-2xl font-semibold" title={currentPatient?.name}>
                  {currentPatient ? nomeCurto(currentPatient.name) : "…"}
                </h2>
              </div>
              {activePatients.length > 1 && (
                <Select value={selectedPatientId ? String(selectedPatientId) : undefined} onValueChange={handleSwitchPatient}>
                  <SelectTrigger className="w-40"><SelectValue placeholder="Trocar paciente" /></SelectTrigger>
                  <SelectContent>
                    {activePatients.map((p) => (
                      <SelectItem key={p.id} value={String(p.id)}>{nomeCurto(p.name)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>

            {/* ZELO-57: só faz sentido com mais de um paciente — com um só,
                esta tela JÁ é o dia inteiro. Disponível em qualquer plano:
                é ferramenta de não esquecer ninguém, e isso não entra em
                paywall (mesma regra do registro de dose). */}
            {activePatients.length > 1 && (
              <Link href="/hoje" asChild>
                <a className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2 hover:bg-muted/70">
                  <LayoutList className="w-4 h-4 shrink-0" />
                  Ver o dia de todos os {activePatients.length} pacientes
                </a>
              </Link>
            )}
          </div>
        )}

        {isLoading && !isPlaceholderData && <HomeSkeleton />}

        {/* BUG corrigido: essa condição exigia selectedPatientId já definido,
            mas a seleção automática (useEffect acima) só roda quando JÁ
            existe paciente — pra quem não tem nenhum, selectedPatientId
            nunca sai de null, e este estado vazio nunca aparecia. Sintoma
            real: cuidadora nova via só "Cuidando de …" sem nada embaixo. */}
        {!patients ? null : activePatients.length === 0 && (
          <div className="text-center py-16 border rounded-xl border-dashed">
            <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
            <p className="text-foreground font-medium text-lg">Você ainda não está cuidando de ninguém</p>
            <p className="text-muted-foreground text-sm mt-1 mb-4">Cadastre a primeira pessoa que você cuida pra começar.</p>
            <Link href="/pacientes"><Button className="gap-2"><Plus className="w-4 h-4" /> Cadastrar paciente</Button></Link>
          </div>
        )}

        {/* Issue #162: o aviso e o erro do registro, num lugar so e em toda
            tela. A corrida perdida ("outra pessoa registrou") e INFORMACAO,
            e por isso e neutra; erro de verdade e ambar, nunca vermelho. */}
        {dose.aviso && (
          <div className="flex items-center gap-2 text-sm bg-muted rounded-lg px-3 py-2">
            <span>{dose.aviso}</span>
          </div>
        )}
        {dose.erro && (
          <p className="text-sm text-zelo-amber-fg px-1">{dose.erro}</p>
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
                  <p className="text-zelo-amber-fg font-medium text-[17px]">
                    {home.lateDoses === 1 ? "Uma dose de hoje ficou sem registro." : `${home.lateDoses} doses de hoje ficaram sem registro.`}
                  </p>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-5 h-5 text-zelo-green-fg shrink-0" />
                  <p className="text-zelo-green-fg font-medium text-[17px]">Tudo em dia hoje.</p>
                </>
              )}
            </div>

            {/* Issue #154: "nenhum tratamento ativo" também olha a madrugada.

                Numa noite em que a única dose do paciente é às 03:00, `doses`
                chega vazio — é dia civil de amanhã. Só com `doses` esta tela
                convidaria a cadastrar o primeiro tratamento logo abaixo da
                seção que mostra o tratamento que existe. */}
            {home.doses.length === 0 && (home.madrugada ?? []).length === 0 && (
              <div className="text-center py-16 border rounded-xl border-dashed">
                <Pill className="w-10 h-10 mx-auto text-muted-foreground mb-3" />
                <p className="text-foreground font-medium">Nenhum tratamento ativo</p>
                <p className="text-muted-foreground text-sm mt-1 mb-4">Cadastre o primeiro tratamento de {currentPatient ? nomeCurto(currentPatient.name) : "quem você cuida"}.</p>
                <Link href={`/pacientes/${selectedPatientId}`}><Button className="gap-2"><Plus className="w-4 h-4" /> Cadastrar tratamento</Button></Link>
              </div>
            )}

            {agora.length > 0 && (
              <div className="space-y-3">
                <h3 className="text-sm font-medium text-muted-foreground">Agora</h3>
                <AnimatePresence initial={false}>
                  {agora.map((d) => (
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="space-y-2 mb-2">
                      <DoseCard
                        medicationName={d.medicationName}
                        dosage={d.dose ?? ""}
                        time={d.scheduledLocalTime}
                        status="pending"
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
                      <div className="flex items-center justify-between px-4 py-3 rounded-lg border border-zelo-amber/20 bg-zelo-amber-bg/40 text-[17px]">
                        <span>{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</span>
                        <span className="text-muted-foreground">{d.scheduledLocalTime}</span>
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
                    <motion.div key={d.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex items-center justify-between px-4 py-3 rounded-lg border bg-card text-[17px] mb-2">
                      <span>{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</span>
                      <span className="text-muted-foreground">{d.scheduledLocalTime}</span>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            )}

            {/* ── Issue #154: a madrugada seguinte ─────────────────────────

                O fundador perguntou o que acontece com um remédio de
                madrugada. Não acontecia nada: a tela recorta pelo dia civil,
                então às 22:00 a dose das 03:00 não aparecia em lugar nenhum.
                Quem ia dormir não sabia que precisava acordar.

                Não é sobre o aviso — o lembrete de madrugada já funciona, e o
                silêncio noturno não o cala. É sobre poder se PLANEJAR:
                ajustar o despertador, combinar quem acorda, separar o
                remédio.

                Quem decide que já é noite é o servidor, no fuso do PACIENTE.
                Durante o dia esta lista chega vazia e a seção nem existe.

                Sem botão de registrar, de propósito: é aviso, não ação.
                Registrar dose que ainda não chegou é assunto da #134. */}
            {(home?.madrugada ?? []).length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-medium text-muted-foreground">Madrugada</h3>
                <p className="text-sm text-muted-foreground -mt-1">
                  Para você já se organizar hoje.
                </p>
                {(home?.madrugada ?? []).map((d) => (
                  <div
                    key={d.id}
                    className="flex items-center justify-between gap-2 px-4 py-3 rounded-lg border border-dashed bg-card text-[17px] mb-2"
                  >
                    <span className="min-w-0">{d.medicationName}{d.dose ? ` — ${d.dose}` : ""}</span>
                    {/* O dia entra AQUI e só aqui. Nos cartões de hoje ele
                        seria ruído — a seção já diz que é hoje —, e é
                        justamente esta lista que faz a tela deixar de ter um
                        dia só. */}
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
                      <span className="min-w-0">✓ {d.medicationName} {d.scheduledLocalTime}</span>
                      {/* #135: o desfazer mora na LINHA da dose. Antes era um
                          botão só, no cabeçalho de "Já foi" — com duas doses
                          registradas, não dava para saber qual ele desfaria.

                          #164: passado o minuto, o que aparece aqui é
                          CORRIGIR. Antes não aparecia nada, e era por isso
                          que não dava para emendar um registro feito nesta
                          tela sem ir até a ficha do paciente. */}
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

            {(home.lowStockItems.length > 0 || home.nextAppointment) && (
              <div className="pt-2 space-y-2">
                {home.lowStockItems.map((item) => (
                  <div key={item.medicationId} className="text-sm text-zelo-amber-fg bg-zelo-amber-bg rounded-lg px-3 py-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <Package className="w-4 h-4 shrink-0" />
                      {/* Issue #88: nome de medicamento tambem e texto do
                          usuario, e uma palavra comprida aqui empurra a
                          pagina igual a um nome de paciente. */}
                      <span className="flex-1 min-w-0">
                        Estoque baixo: {item.medicationName} ({item.quantityRemaining} {item.unit})
                        {item.effectiveDaysRemaining !== null && ` — cerca de ${Math.round(item.effectiveDaysRemaining)} dia(s)`}
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
                        <Button size="sm" onClick={() => void handleRestock(item.medicationId)}>Registrar</Button>
                        <Button size="sm" variant="ghost" onClick={() => setRestockingMedicationId(null)}>Cancelar</Button>
                      </div>
                    )}
                  </div>
                ))}
                {home.nextAppointment && (
                  <Link href={`/pacientes/${selectedPatientId}/consultas`} asChild>
                    <a className="flex items-center gap-2 text-sm text-muted-foreground bg-muted rounded-lg px-3 py-2 hover:bg-muted/70">
                      <CalendarClock className="w-4 h-4 shrink-0" />
                      Próxima consulta: {home.nextAppointment.specialty} em {home.nextAppointment.localDate.split("-").reverse().join("/")}
                    </a>
                  </Link>
                )}
              </div>
            )}
          </>
        )}
        {/* Issue #162 — os modais moram na tela, nao no cartao: um por dose
            criaria dez instancias da mesma caixa esperando para abrir.
            A de antecipacao (#134) e a de correcao (#136) nunca tinham
            chegado a esta tela. */}
        {selectedPatientId !== null && (
          <DialogosDaDose controlador={dose} patientId={String(selectedPatientId)} />
        )}
      </main>
    </div>
  );
}
