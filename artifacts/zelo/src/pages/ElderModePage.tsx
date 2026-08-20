/**
 * Modo idoso — ZELO (ZELO-40).
 *
 * Uma tela, uma dose por vez, um botão gigante — "Tomei". Nada de
 * percentual de adesão, estoque ou histórico aqui: isso é para o cuidador,
 * não para quem só quer confirmar que tomou o remédio.
 *
 * O dispositivo travado neste modo usa a MESMA sessão do cuidador que o
 * ativou (ver lib/elder-mode.ts) — não existe conta própria do paciente.
 * Sair exige a senha do cuidador, atrás de um toque longo (3s) num ícone
 * discreto no canto — baixo contraste de propósito (não convida o idoso a
 * mexer), mas VISÍVEL: a primeira versão era opacity-0 (invisível de
 * verdade) e nem quem construiu a tela conseguiu encontrar a saída no
 * teste ao vivo. Discreto ≠ escondido — essa é a lição.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { deactivateElderModeOnThisDevice } from "@/lib/elder-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Volume2, Check, Lock } from "lucide-react";

interface ElderDose {
  id: number;
  scheduledLocalTime: string;
  status: "pending" | "taken" | "skipped" | "late";
  dose: string | null;
  medicationName: string;
}

async function fetchDoses(patientId: number): Promise<{ doses: ElderDose[] }> {
  const res = await authFetch(`/api/patients/${patientId}/today-doses`);
  if (!res.ok) throw new Error("Erro ao carregar");
  return res.json();
}

const LONG_PRESS_MS = 3000;

export default function ElderModePage({ patientId }: { patientId: number }) {
  const { user, login } = useAuth();
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [exitOpen, setExitOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [exitError, setExitError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [pressing, setPressing] = useState(false);
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data } = useQuery({
    queryKey: ["elder-mode-doses", patientId],
    queryFn: () => fetchDoses(patientId),
    refetchInterval: 30_000,
  });

  const nextDose = useMemo(
    () => (data?.doses ?? []).find((d) => d.status === "pending") ?? null,
    [data]
  );

  const handleTaken = async () => {
    if (!nextDose) return;
    const res = await authFetch(`/api/patients/${patientId}/dose-records`, {
      method: "POST",
      body: JSON.stringify({
        scheduledDoseId: nextDose.id,
        takenAt: new Date().toISOString(),
        outcome: "taken",
        viaElderMode: true,
      }),
    });
    void queryClient.invalidateQueries({ queryKey: ["elder-mode-doses", patientId] });
    // Nada de mensagem de erro aqui — nada que gere ansiedade nesta tela.
    // Se algo impediu o registro, a dose simplesmente continua pendente e
    // o botão "Tomei" continua ali; quem resolve é o cuidador, depois.
    if (!res.ok) return;
    setConfirmed(true);
    setTimeout(() => setConfirmed(false), 2500);
  };

  const handleListen = () => {
    if (!nextDose || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const text = `Hora de tomar ${nextDose.medicationName}${nextDose.dose ? `, ${nextDose.dose}` : ""}, às ${nextDose.scheduledLocalTime}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const startPress = () => {
    setPressing(true);
    pressTimer.current = setTimeout(() => { setPressing(false); setExitOpen(true); }, LONG_PRESS_MS);
  };
  const cancelPress = () => {
    setPressing(false);
    if (pressTimer.current) clearTimeout(pressTimer.current);
  };
  useEffect(() => cancelPress, []);

  const handleExitConfirm = async () => {
    if (!user?.email || !password) return;
    setVerifying(true);
    setExitError(null);
    try {
      await login(user.email, password);
      deactivateElderModeOnThisDevice();
      window.location.href = "/";
    } catch {
      setExitError("Senha incorreta.");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8F7F5] flex flex-col items-center justify-center px-6 py-10 text-center relative" translate="no">
      {confirmed ? (
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
            className="w-full min-h-24 rounded-3xl bg-zelo-green text-white text-4xl font-bold shadow-lg active:scale-[0.98] transition-transform"
          >
            Tomei
          </button>

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

      {/* Saída do cuidador: baixo contraste (não convida o idoso a mexer),
          mas VISÍVEL — segurar 3s abre o pedido de senha. */}
      <button
        type="button"
        aria-label="Sair do modo idoso (cuidador)"
        onPointerDown={startPress}
        onPointerUp={cancelPress}
        onPointerLeave={cancelPress}
        onPointerCancel={cancelPress}
        className={`absolute bottom-4 right-4 flex flex-col items-center gap-1 rounded-full p-2 transition-transform ${pressing ? "scale-110" : ""}`}
      >
        <Lock className={`w-5 h-5 transition-colors ${pressing ? "text-[#2D2D2B]/60" : "text-[#2D2D2B]/25"}`} />
        <span className="text-[10px] text-[#2D2D2B]/25">Sair</span>
      </button>

      <Dialog open={exitOpen} onOpenChange={(open) => { setExitOpen(open); if (!open) { setPassword(""); setExitError(null); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Sair do modo idoso</DialogTitle>
            <DialogDescription>Confirme sua senha de cuidador para sair deste modo neste aparelho.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Sua senha"
              onKeyDown={(e) => { if (e.key === "Enter") void handleExitConfirm(); }}
            />
            {exitError && <p className="text-sm text-destructive">{exitError}</p>}
            <div className="flex gap-2 justify-end">
              <Button variant="ghost" onClick={() => setExitOpen(false)}>Cancelar</Button>
              <Button onClick={() => void handleExitConfirm()} disabled={verifying || !password}>
                {verifying ? "Verificando…" : "Sair"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
