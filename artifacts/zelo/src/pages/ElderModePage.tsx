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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Volume2, Check, LogOut, RefreshCw } from "lucide-react";

interface ElderDose {
  id: number;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  dose: string | null;
  medicationName: string;
}

async function fetchDoses(patientId: number): Promise<{ doses: ElderDose[]; elderModeEnabled: boolean }> {
  const res = await authFetch(`/api/patients/${patientId}/today-doses`);
  if (!res.ok) throw new Error("Não foi possível carregar os remédios de hoje.");
  return res.json();
}

/** Lê a mensagem que o servidor mandou, sem nunca deixar vazar texto
 *  técnico/em inglês pra esta tela. O servidor do ZELO responde erro
 *  sempre como `{ error, code? }` em português. */
async function readServerError(res: Response, fallback: string): Promise<string> {
  try {
    const body = (await res.json()) as { error?: string };
    return body?.error?.trim() || fallback;
  } catch {
    return fallback;
  }
}

export default function ElderModePage({ patientId }: { patientId: number }) {
  const queryClient = useQueryClient();

  const [confirmed, setConfirmed] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [takenError, setTakenError] = useState<string | null>(null);

  const [exitOpen, setExitOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [exitError, setExitError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["elder-mode-doses", patientId],
    queryFn: () => fetchDoses(patientId),
    refetchInterval: 30_000,
  });

  const nextDose = (data?.doses ?? []).find((d) => d.status === "pending") ?? null;

  // SAÍDA DE EMERGÊNCIA REMOTA: o servidor é quem manda sobre este modo
  // estar permitido. Se o cuidador principal desligar o interruptor pelo
  // aparelho DELE, este aqui se destrava sozinho na próxima atualização
  // (que roda a cada 30s) — sem precisar da senha nem do aparelho em mãos.
  // É a rede de segurança pra quando algo der errado com o botão "Sair".
  useEffect(() => {
    if (data && data.elderModeEnabled === false) {
      deactivateElderModeOnThisDevice();
      window.location.replace(import.meta.env.BASE_URL || "/");
    }
  }, [data]);

  const handleTaken = async () => {
    if (!nextDose || registering) return; // só reentrância; o botão já está desabilitado
    setRegistering(true);
    setTakenError(null);
    try {
      const res = await authFetch(`/api/patients/${patientId}/dose-records`, {
        method: "POST",
        body: JSON.stringify({
          scheduledDoseId: nextDose.id,
          takenAt: new Date().toISOString(),
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
      // authFetch lança quando nem consegue renovar a sessão (offline, rede
      // caída). Sem este catch, o clique morria em silêncio.
      setTakenError("Sem conexão agora. Tente de novo em instantes.");
    } finally {
      setRegistering(false);
      void queryClient.invalidateQueries({ queryKey: ["elder-mode-doses", patientId] });
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
   * Confirma a senha do cuidador e sai do modo idoso NESTE aparelho.
   *
   * Usa POST /account/verify-password (endpoint dedicado) em vez de refazer
   * login: login rotacionaria o par de tokens, recarregaria a sessão e
   * consumiria a cota do rate limiter de LOGIN — uma senha errada aqui
   * trancaria o cuidador pra entrar de novo. Aqui a sessão fica intacta.
   */
  const handleExitConfirm = async () => {
    if (verifying) return;
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
              Confirme sua senha de cuidador para voltar ao aplicativo normal neste aparelho.
            </DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(e) => { e.preventDefault(); void handleExitConfirm(); }}
          >
            <Input
              type="password"
              autoFocus
              autoComplete="current-password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setExitError(null); }}
              placeholder="Sua senha"
              disabled={verifying}
            />
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
