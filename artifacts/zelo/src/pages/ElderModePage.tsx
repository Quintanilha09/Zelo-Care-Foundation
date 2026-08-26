/**
 * Modo idoso — ZELO (ZELO-40).
 *
 * Uma tela, uma dose por vez, um botão gigante — "Tomei". Nada de
 * percentual de adesão, estoque ou histórico: isso é ferramenta do
 * cuidador, não de quem só quer confirmar que tomou o remédio.
 *
 * O aparelho travado neste modo usa a MESMA sessão do cuidador que o
 * ativou (ver lib/elder-mode.ts) — não existe conta própria do paciente.
 *
 * ─────────────────────────────────────────────────────────────────────
 * REGRA DESTA TELA, aprendida em três rodadas de teste ao vivo:
 * TODO caminho termina em algo visível. Nenhum `return` mudo.
 *
 * As três versões anteriores falharam exatamente por violar isso:
 *   1. Saída com `opacity-0` — invisível, ninguém achava.
 *   2. Saída exigindo segurar 3s sob um rótulo escrito "Sair" — o rótulo
 *      pede clique; o clique soltava antes do tempo e cancelava calado.
 *   3. `if (!user?.email) return` — e /account/me nunca devolvia `email`,
 *      então a confirmação de senha era um no-op permanente e silencioso.
 *      No mesmo período, "Tomei" mascarava o erro real do servidor
 *      (403 de limite de plano) atrás de uma mensagem genérica.
 *
 * "Nada que gere ansiedade" (a diretriz do produto) nunca quis dizer
 * "esconder falha": pra quem está olhando, silêncio e falha são a mesma
 * coisa — parece quebrado. O tom é calmo; o feedback é sempre explícito.
 * ─────────────────────────────────────────────────────────────────────
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { deactivateElderModeOnThisDevice } from "@/lib/elder-mode";
import { patientFetch, clearPatientAccess } from "@/lib/patient-access";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Volume2, Check, LogOut, RefreshCw } from "lucide-react";
import { BotaoRecado } from "@/components/botao-recado";

interface ElderDose {
  id: number;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  dose: string | null;
  medicationName: string;
}

/**
 * Estado do dia, normalizado — a tela é a mesma nos dois modos de acesso:
 *
 *  - APARELHO DO PACIENTE (ZELO-58): token próprio, escopo de duas rotas,
 *    nenhuma sessão de cuidador guardada aqui. É o caminho recomendado.
 *  - APARELHO DO CUIDADOR (ZELO-40): o tablet compartilhado da casa, que o
 *    cuidador controla, usando a sessão dele.
 */
interface ElderState {
  nextDose: ElderDose | null;
  elderModeEnabled: boolean;
}

async function fetchAsPatient(): Promise<ElderState> {
  const res = await patientFetch("/api/patient-access/today");
  if (!res.ok) throw new Error("Não foi possível carregar os remédios de hoje.");
  const data = (await res.json()) as {
    elderModeEnabled: boolean;
    nextDose: { id: number; medicationName: string; dose: string | null; scheduledLocalTime: string } | null;
  };
  return {
    elderModeEnabled: data.elderModeEnabled,
    nextDose: data.nextDose ? { ...data.nextDose, status: "pending" } : null,
  };
}

async function fetchAsCaregiver(patientId: number): Promise<ElderState> {
  const res = await authFetch(`/api/patients/${patientId}/today-doses`);
  if (!res.ok) throw new Error("Não foi possível carregar os remédios de hoje.");
  const data = (await res.json()) as { doses: ElderDose[]; elderModeEnabled: boolean };
  return {
    elderModeEnabled: data.elderModeEnabled,
    nextDose: data.doses.find((d) => d.status === "pending") ?? null,
  };
}

/**
 * Traduz uma resposta de erro em algo que a pessoa na frente da tela
 * consiga agir. O servidor do ZELO responde `{ error, code? }` em
 * português, mas nem toda resposta dele serve como está: um 404 do
 * catch-all de /api chega como "Rota não encontrada", que não diz nada a
 * ninguém — e é justamente o que aparece quando o navegador já está numa
 * versão mais nova que a do servidor (deploy do front sem reiniciar a API).
 */
async function readServerError(res: Response, fallback: string): Promise<string> {
  let serverMessage = "";
  try {
    const body = (await res.json()) as { error?: string };
    serverMessage = body?.error?.trim() ?? "";
  } catch {
    // resposta sem JSON (proxy, gateway) — cai nas mensagens por status
  }

  if (res.status === 404 && (!serverMessage || /rota n[ãa]o encontrada/i.test(serverMessage))) {
    return "O aplicativo está mais novo que o servidor. Peça pra quem cuida de você reiniciar o servidor do ZELO.";
  }
  if (res.status === 429) {
    return serverMessage || "Muitas tentativas seguidas. Aguarde alguns minutos.";
  }
  if (res.status >= 500) {
    return "O servidor teve um problema agora. Tente de novo em instantes.";
  }
  return serverMessage || fallback;
}

/** `patientId` só existe no modo "aparelho do cuidador". No aparelho do
 *  paciente, quem identifica é o próprio token — o cliente nem precisa
 *  saber o id, e não saber é melhor: menos coisa exposta ali. */
export default function ElderModePage({ patientId }: { patientId: number | null }) {
  const queryClient = useQueryClient();
  const isPatientDevice = patientId === null;

  const [confirmed, setConfirmed] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [takenError, setTakenError] = useState<string | null>(null);

  const [exitOpen, setExitOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [exitError, setExitError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const queryKey = ["elder-mode-doses", isPatientDevice ? "patient-device" : patientId];
  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey,
    queryFn: () => (isPatientDevice ? fetchAsPatient() : fetchAsCaregiver(patientId!)),
    refetchInterval: 30_000,
  });

  const nextDose = data?.nextDose ?? null;

  // SAÍDA DE EMERGÊNCIA REMOTA: o servidor é quem manda sobre este modo
  // estar permitido. Se o cuidador principal desligar o interruptor pelo
  // aparelho DELE, este aqui se destrava sozinho na próxima atualização
  // (que roda a cada 30s) — sem precisar da senha nem do aparelho em mãos.
  // No aparelho do paciente vale o mesmo, e ainda tem a revogação do
  // acesso, que derruba na requisição seguinte (401 → tela de erro).
  useEffect(() => {
    if (data && data.elderModeEnabled === false) {
      deactivateElderModeOnThisDevice();
      clearPatientAccess();
      window.location.replace(import.meta.env.BASE_URL || "/");
    }
  }, [data]);

  const handleTaken = async () => {
    if (!nextDose || registering) return; // só reentrância; o botão já está desabilitado
    setRegistering(true);
    setTakenError(null);
    try {
      // Nos dois modos, "agora" quem decide é o relógio do SERVIDOR — o
      // relógio deste aparelho pode estar minutos fora de sincronia, e
      // mandá-lo já fez um registro legítimo ser recusado como "dose no
      // futuro" (ver routes/dose-records.ts).
      const res = isPatientDevice
        ? await patientFetch("/api/patient-access/taken", {
            method: "POST",
            body: JSON.stringify({ scheduledDoseId: nextDose.id }),
          })
        : await authFetch(`/api/patients/${patientId}/dose-records`, {
            method: "POST",
            body: JSON.stringify({
              scheduledDoseId: nextDose.id,
              outcome: "taken",
              viaElderMode: true,
            }),
          });

      if (!res.ok) {
        // A mensagem REAL do servidor, não uma genérica — foi mascarar isso
        // que escondeu por dias um 403 de limite de plano.
        setTakenError(await readServerError(res, "Não deu pra registrar agora. Tente de novo."));
        return;
      }

      // 200 com wonRace:false = outro cuidador registrou primeiro (ZELO-23).
      // Pra quem está olhando esta tela, isso é sucesso: a dose está
      // registrada. Nunca mostrar isso como erro.
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 2500);
    } catch {
      // Rede caída, ou sessão que não renova. Sem este catch, o clique
      // morria em silêncio.
      setTakenError("Sem conexão agora. Tente de novo em instantes.");
    } finally {
      setRegistering(false);
      void queryClient.invalidateQueries({ queryKey });
    }
  };

  const handleListen = () => {
    if (!nextDose) return;
    if (typeof window === "undefined" || !("speechSynthesis" in window)) {
      setTakenError("Este aparelho não consegue ler em voz alta.");
      return;
    }
    const text = `Hora de tomar ${nextDose.medicationName}${nextDose.dose ? `, ${nextDose.dose}` : ""}, às ${nextDose.scheduledLocalTime}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  /**
   * Sair do modo idoso NESTE aparelho.
   *
   * No aparelho do PACIENTE (ZELO-58) não há senha a pedir: o aparelho não
   * guarda sessão de cuidador nenhuma, então não existe nada pra proteger —
   * sair é só apagar o token daqui. Pra voltar, o cuidador manda outro link.
   *
   * No aparelho do CUIDADOR (tablet compartilhado), a senha continua sendo
   * pedida, porque ali sair de fato revela a sessão dele por baixo. Usa
   * POST /account/verify-password (endpoint dedicado) em vez de refazer
   * login: login rotacionaria o par de tokens, recarregaria a sessão e
   * consumiria a cota do rate limiter de LOGIN — uma senha errada aqui
   * trancaria o cuidador pra entrar de novo. Aqui a sessão fica intacta.
   */
  const handleExitConfirm = async () => {
    if (verifying) return;

    if (isPatientDevice) {
      clearPatientAccess();
      window.location.replace(import.meta.env.BASE_URL || "/");
      return;
    }

    if (!password) {
      setExitError("Digite sua senha de cuidador.");
      return;
    }
    setVerifying(true);
    setExitError(null);
    try {
      const res = await authFetch("/api/account/verify-password", {
        method: "POST",
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        setExitError(await readServerError(res, "Não foi possível confirmar a senha."));
        return;
      }
      // Só depois da confirmação: destrava o aparelho e recarrega de fato.
      // Recarregar (em vez de navegar pela SPA) garante que o gate do modo
      // idoso em App.tsx seja reavaliado do zero, sem cache de rota.
      deactivateElderModeOnThisDevice();
      window.location.replace(import.meta.env.BASE_URL || "/");
    } catch {
      setExitError("Sem conexão agora. Tente de novo em instantes.");
    } finally {
      setVerifying(false);
    }
  };

  const closeExitDialog = () => {
    setExitOpen(false);
    setPassword("");
    setExitError(null);
  };

  return (
    <div className="min-h-screen bg-[#F8F7F5] flex flex-col items-center justify-center px-6 py-10 text-center relative" translate="no">
      {isLoading ? (
        <p className="text-2xl text-[#6B6B6B]">Carregando…</p>
      ) : isError ? (
        <div className="space-y-6 w-full max-w-md">
          <p className="text-2xl text-[#2D2D2B]">
            {error instanceof Error ? error.message : "Não foi possível carregar os remédios de hoje."}
          </p>
          <button
            type="button"
            onClick={() => void refetch()}
            className="flex items-center justify-center gap-3 w-full min-h-16 px-8 rounded-2xl border-2 border-[#2D2D2B]/20 text-2xl text-[#2D2D2B]"
          >
            <RefreshCw className="w-7 h-7" /> Tentar de novo
          </button>
        </div>
      ) : confirmed ? (
        <div className="flex flex-col items-center gap-6">
          <div className="w-28 h-28 rounded-full bg-zelo-green-bg flex items-center justify-center">
            <Check className="w-16 h-16 text-zelo-green-fg" strokeWidth={3} />
          </div>
          <p className="text-4xl font-semibold text-[#2D2D2B]">Tomado!</p>
        </div>
      ) : nextDose ? (
        <div className="flex flex-col items-center gap-8 w-full max-w-md">
          <div className="space-y-2">
            <p className="text-2xl text-[#6B6B6B]">Hora de tomar</p>
            <p className="text-5xl font-bold text-[#2D2D2B] leading-tight">{nextDose.medicationName}</p>
            {nextDose.dose && <p className="text-3xl text-[#6B6B6B]">{nextDose.dose}</p>}
            <p className="text-3xl text-[#6B6B6B]">{nextDose.scheduledLocalTime}</p>
          </div>

          <button
            type="button"
            onClick={() => void handleTaken()}
            disabled={registering}
            className="w-full min-h-24 rounded-3xl bg-zelo-green text-white text-4xl font-bold shadow-lg active:scale-[0.98] transition-transform disabled:opacity-70"
          >
            {registering ? "Registrando…" : "Tomei"}
          </button>

          {takenError && (
            <div className="w-full rounded-2xl bg-zelo-amber-bg border border-zelo-amber/30 px-5 py-4 space-y-3">
              <p className="text-xl text-zelo-amber-fg leading-snug">{takenError}</p>
              <p className="text-base text-[#6B6B6B]">Se continuar assim, avise quem cuida de você.</p>
            </div>
          )}

          <button
            type="button"
            onClick={handleListen}
            className="flex items-center gap-3 min-h-16 px-8 rounded-2xl border-2 border-[#2D2D2B]/20 text-2xl text-[#2D2D2B]"
          >
            <Volume2 className="w-8 h-8" /> Ouvir
          </button>

          {/* QUI-8 — só no aparelho DO PACIENTE. No modo idoso ativado sobre a
              sessão de um cuidador, quem está usando é o cuidador, e o recado
              seria atribuído à pessoa errada. */}
          {isPatientDevice && <BotaoRecado />}
        </div>
      ) : (
        <div className="space-y-3">
          <div className="w-24 h-24 mx-auto rounded-full bg-zelo-green-bg flex items-center justify-center">
            <Check className="w-14 h-14 text-zelo-green-fg" strokeWidth={3} />
          </div>
          <p className="text-3xl font-semibold text-[#2D2D2B]">Está tudo em dia.</p>
          <p className="text-xl text-[#6B6B6B]">Nada agora.</p>
        </div>
      )}

      {/* Saída do cuidador: um toque abre a confirmação. A fricção contra
          sair sem querer é a SENHA pedida em seguida — que o idoso não
          tem —, não esconder o botão nem exigir um gesto secreto. */}
      <button
        type="button"
        onClick={() => setExitOpen(true)}
        className="absolute bottom-4 right-4 flex items-center gap-1.5 px-4 py-2.5 rounded-full bg-destructive/10 text-destructive text-base font-medium"
      >
        <LogOut className="w-5 h-5" /> Sair
      </button>

      <Dialog open={exitOpen} onOpenChange={(open) => (open ? setExitOpen(true) : closeExitDialog())}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sair do modo idoso</DialogTitle>
            <DialogDescription>
              {isPatientDevice
                ? "Este celular vai parar de te lembrar dos remédios. Pra voltar, peça um novo link para quem cuida de você."
                : "Confirme sua senha de cuidador para voltar ao aplicativo normal neste aparelho."}
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); void handleExitConfirm(); }}
          >
            {/* No aparelho do paciente não há senha a pedir: não existe
                sessão de cuidador guardada aqui pra proteger. */}
            {!isPatientDevice && (
              <Input
                type="password"
                autoFocus
                autoComplete="current-password"
                value={password}
                onChange={(e) => { setPassword(e.target.value); setExitError(null); }}
                placeholder="Sua senha"
                disabled={verifying}
              />
            )}
            {exitError && <p className="text-sm text-destructive">{exitError}</p>}
            <div className="flex gap-2 justify-end">
              <Button type="button" variant="ghost" onClick={closeExitDialog} disabled={verifying}>Cancelar</Button>
              <Button type="submit" disabled={verifying}>
                {verifying ? "Verificando…" : "Sair"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
