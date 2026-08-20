/**
 * Tela quente de limite de plano — ZELO (ZELO-38).
 *
 * "O paywall é social, não funcional" e o tom é convite, nunca parede:
 * ícone de coração, zero vermelho, nenhuma contagem regressiva, nenhuma
 * escassez artificial. Mostra o que o plano Família ENTREGA, não só o que
 * o gratuito não permite — a pessoa precisa entender o que ganha.
 *
 * Conteúdo de um Dialog (o pai controla abertura/fechamento), usado tanto
 * no limite de paciente quanto no de cuidador pra os dois momentos serem
 * literalmente a mesma experiência.
 */
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import {
  DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { planHighlights, type PlanTier } from "@/lib/plan-limits-client";
import { Heart, Check } from "lucide-react";

interface PlanPaywallProps {
  title: string;
  message: string;
  onDismiss: () => void;
  /** Plano atual — decide qual próximo plano é oferecido. Quem já está no
   *  maior tier contratável recebe o caminho do atendimento institucional. */
  currentTier?: PlanTier;
}

export function PlanPaywall({ title, message, onDismiss, currentTier }: PlanPaywallProps) {
  const highlights = planHighlights(currentTier);
  return (
    <>
      <DialogHeader>
        <div className="mx-auto mb-2 w-10 h-10 rounded-full bg-zelo-green-bg flex items-center justify-center">
          <Heart className="w-5 h-5 text-zelo-green-fg" />
        </div>
        <DialogTitle className="text-center">{title}</DialogTitle>
        <DialogDescription className="text-center">{message}</DialogDescription>
      </DialogHeader>

      <div className="rounded-xl border bg-zelo-green-bg/30 p-4 space-y-2">
        <p className="text-sm font-medium">{highlights.title}</p>
        <ul className="space-y-1.5">
          {highlights.items.map((item) => (
            <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
              <Check className="w-4 h-4 text-zelo-green-fg shrink-0 mt-0.5" />
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>

      <div className="flex justify-center gap-2">
        <Button variant="ghost" onClick={onDismiss}>Agora não</Button>
        <Link href="/planos"><Button>Ver planos</Button></Link>
      </div>
    </>
  );
}
