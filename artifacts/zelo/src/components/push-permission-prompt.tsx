/**
 * Convite pra ativar lembretes de dose — ZELO (ZELO-26).
 *
 * Nunca aparece "no primeiro segundo" — só depois que o cuidador cadastra
 * o primeiro tratamento (trigger sobe em PatientDetailPage.handleCreated),
 * e no máximo uma vez por navegador (localStorage). Recusar não bloqueia
 * nada — dá pra ativar depois em Ajustes a qualquer momento.
 */
import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Bell } from "lucide-react";
import { subscribeToPush, needsIOSInstallGuide, isPushSupported } from "@/lib/push-client";

const STORAGE_KEY = "zelo_push_prompt_seen";

export function PushPermissionPrompt({ trigger }: { trigger: number }) {
  const [open, setOpen] = useState(false);
  const [subscribing, setSubscribing] = useState(false);
  const [, navigate] = useLocation();

  useEffect(() => {
    if (trigger === 0) return;
    if (!isPushSupported()) return;
    if (localStorage.getItem(STORAGE_KEY)) return;
    if (typeof Notification !== "undefined" && Notification.permission !== "default") return;
    setOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trigger]);

  const dismiss = () => {
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  const handleActivate = async () => {
    if (needsIOSInstallGuide()) {
      localStorage.setItem(STORAGE_KEY, "1");
      setOpen(false);
      navigate("/notificacoes/ios");
      return;
    }
    setSubscribing(true);
    await subscribeToPush();
    setSubscribing(false);
    localStorage.setItem(STORAGE_KEY, "1");
    setOpen(false);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="w-12 h-12 rounded-full bg-zelo-green-bg flex items-center justify-center mb-2">
            <Bell className="w-6 h-6 text-zelo-green-fg" />
          </div>
          <DialogTitle>Ativar lembretes de dose?</DialogTitle>
          <DialogDescription>
            {needsIOSInstallGuide()
              ? "No iPhone, os lembretes só funcionam depois de adicionar o ZELO à Tela de Início. Leva menos de 1 minuto."
              : "Quando estiver perto da hora de uma dose, o ZELO avisa — mesmo com o app fechado. Dá pra desativar quando quiser, em Ajustes."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex gap-2 justify-end pt-2">
          <Button variant="ghost" onClick={dismiss} disabled={subscribing}>Agora não</Button>
          <Button onClick={handleActivate} disabled={subscribing}>
            {subscribing ? "Ativando…" : needsIOSInstallGuide() ? "Ver como ativar" : "Ativar lembretes"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
