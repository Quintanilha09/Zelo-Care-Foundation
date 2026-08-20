/**
 * Modo idoso — ZELO (ZELO-40).
 *
 * Uma tela, uma dose por vez, um botão gigante — "Tomei". Nada de
 * percentual de adesão, estoque ou histórico aqui: isso é para o cuidador,
 * não para quem só quer confirmar que tomou o remédio.
 *
 * O dispositivo travado neste modo usa a MESMA sessão do cuidador que o
 * ativou (ver lib/elder-mode.ts) — não existe conta própria do paciente.
 *
 * HISTÓRICO DO BOTÃO DE SAIR (duas rodadas de teste ao vivo já mudaram
 * este desenho, registrado pra não repetir o mesmo erro):
 * 1ª versão: opacity-0 — literalmente invisível, ninguém achava.
 * 2ª versão: ícone visível, mas exigia segurar 3s — um rótulo "Sair"
 *    implica CLIQUE, não segurar; um clique normal soltava antes do
 *    temporizador completar e não acontecia nada, lido como "quebrado".
 * 3ª versão (atual): botão vermelho, sempre visível, um toque só abre o
 *    pedido de senha — a fricção contra saída acidental do idoso já é a
 *    PRÓPRIA senha (ele não sabe a senha do cuidador), seguro segurar
 *    não era necessário e só atrapalhava.
 *
 * A senha (via login real) é a segurança de verdade contra sair sem
 * querer — coincidência do rótulo com o gesto importa mais do que
 * discrição extra que ninguém consegue operar.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { deactivateElderModeOnThisDevice } from "@/lib/elder-mode";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Volume2, Check, LogOut } from "lucide-react";

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

export default function ElderModePage({ patientId }: { patientId: number }) {
  const { user, login } = useAuth();
  const queryClient = useQueryClient();
  const [confirmed, setConfirmed] = useState(false);
  const [registering, setRegistering] = useState(false);
  // Calma no tom, mas VISÍVEL — a versão anterior escondia qualquer falha
  // de propósito ("nada que gere ansiedade") e o efeito colateral foi
  // "cliquei e não aconteceu nada", indistinguível de quebrado de verdade.
  const [takenError, setTakenError] = useState<string | null>(null);
  const [exitOpen, setExitOpen] = useState(false);
  const [password, setPassword] = useState("");
  const [exitError, setExitError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);

  const { data } = useQuery({
    queryKey: ["elder-mode-doses", patientId],
    queryFn: () => fetchDoses(patientId),
    refetchInterval: 30_000,
  });

  const nextDose = (data?.doses ?? []).find((d) => d.status === "pending") ?? null;

  const handleTaken = async () => {
    if (!nextDose || registering) return;
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
      void queryClient.invalidateQueries({ queryKey: ["elder-mode-doses", patientId] });
      if (!res.ok) {
        setTakenError("Não deu pra registrar agora. Tente de novo.");
        return;
      }
      setConfirmed(true);
      setTimeout(() => setConfirmed(false), 2500);
    } catch {
      // authFetch lança quando a sessão não renova (ex: sem internet) — sem
      // isto, essa falha desaparecia em silêncio, exatamente o "cliquei e
      // não aconteceu nada" relatado no teste ao vivo.
      setTakenError("Sem conexão no momento. Tente de novo.");
    } finally {
      setRegistering(false);
    }
  };

  const handleListen = () => {
    if (!nextDose || typeof window === "undefined" || !("speechSynthesis" in window)) return;
    const text = `Hora de tomar ${nextDose.medicationName}${nextDose.dose ? `, ${nextDose.dose}` : ""}, às ${nextDose.scheduledLocalTime}.`;
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = "pt-BR";
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
  };

  const handleExitConfirm = async () => {
    if (!user?.email || !password) return;
    setVerifying(true);
    setExitError(null);
    try {
      await login(user.email, password);
      deactivateElderModeOnThisDevice();
      window.location.href = "/";
    } catch (err) {
      // login() lança com a mensagem real do servidor (senha errada, limite
      // de tentativas etc.) — só cai no genérico quando nem isso veio (ex:
      // sem internet), pra nunca mostrar um erro técnico em inglês aqui.
      const message = err instanceof Error && err.message && err.message !== "Failed to fetch" ? err.message : "Não deu pra verificar a senha agora. Tente de novo.";
      setExitError(message);
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
            disabled={registering}
            className="w-full min-h-24 rounded-3xl bg-zelo-green text-white text-4xl font-bold shadow-lg active:scale-[0.98] transition-transform disabled:opacity-70"
          >
            {registering ? "Registrando…" : "Tomei"}
          </button>
          {takenError && <p className="text-lg text-destructive">{takenError}</p>}

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

      {/* Saída do cuidador: um toque abre o pedido de senha — a senha É a
          fricção contra sair sem querer, não precisa de mais nenhuma. */}
      <button
        type="button"
        onClick={() => setExitOpen(true)}
        className="absolute bottom-4 right-4 flex items-center gap-1.5 px-3 py-2 rounded-full bg-destructive/10 text-destructive text-sm font-medium"
      >
        <LogOut className="w-4 h-4" /> Sair
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
