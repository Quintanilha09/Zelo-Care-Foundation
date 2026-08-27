/**
 * Cuidadores e convites — ZELO.
 * "Quem cuida com você" — a visibilidade da família é o diferencial do
 * produto. Ações de gestão (trocar papel, revogar, convidar) só aparecem
 * para o cuidador principal; o servidor é a autoridade real, isso aqui é
 * só esconder o botão que o backend rejeitaria de qualquer forma.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { PlanPaywall } from "@/components/plan-paywall";
import {
  caregiverLimitReached, caregiverLimitMessage, type PlanView,
} from "@/lib/plan-limits-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { ActivityFeed } from "@/components/ActivityFeed";
import { CaregiverBadge } from "@/components/caregiver-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { User, UserPlus, X, Copy, Check, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type Role = "primary_caregiver" | "caregiver" | "hired_caregiver" | "observer";

interface Caregiver {
  id: number;
  name: string;
  email: string | null;
  role: Role;
}

interface Invite {
  id: number;
  invitedEmail: string | null;
  role: Role;
  status: string;
  expiresAt: string;
}

const ROLE_LABELS: Record<Role, string> = {
  primary_caregiver: "Cuidador principal",
  caregiver: "Cuidador",
  hired_caregiver: "Cuidador contratado",
  observer: "Observador",
};

async function fetchCaregivers(): Promise<Caregiver[]> {
  const res = await authFetch("/api/caregivers");
  if (!res.ok) throw new Error("Erro ao carregar cuidadores");
  return res.json();
}

async function fetchInvites(): Promise<Invite[]> {
  const res = await authFetch("/api/invites");
  if (!res.ok) return [];
  return res.json();
}

function InviteDialog({ onCreated, plan, caregiverCount }: {
  onCreated: () => void;
  plan: PlanView | null | undefined;
  caregiverCount: number;
}) {
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<Role>("caregiver");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [paywallMessage, setPaywallMessage] = useState("");
  const [result, setResult] = useState<{ inviteLink: string; role: Role } | null>(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const fullLink = result ? `${window.location.origin}${result.inviteLink}` : "";
  const whatsappText = result
    ? `Te convidei para acompanhar os remédios comigo no ZELO. Entra aqui: ${fullLink}`
    : "";

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    setPaywallMessage("");
    try {
      const res = await authFetch("/api/invites", {
        method: "POST",
        body: JSON.stringify({ invitedEmail: email.trim() || undefined, role }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; code?: string };
        // ZELO-38: limite de plano é um momento diferente de um erro —
        // tela quente, não um alerta vermelho de falha.
        if (data.code === "PLAN_LIMIT") {
          setPaywallMessage(data.error ?? "Cuidar junto é melhor. O plano Família libera cuidadores ilimitados.");
          return;
        }
        throw new Error(data.error ?? "Erro ao criar convite");
      }
      const data = (await res.json()) as { inviteLink: string; role: Role };
      setResult(data);
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  const handleCopy = () => {
    void navigator.clipboard.writeText(fullLink);
    setCopied(true);
    toast({ description: "Link copiado" });
    setTimeout(() => setCopied(false), 2000);
  };

  const reset = () => {
    setOpen(false);
    setResult(null);
    setEmail("");
    setRole("caregiver");
    setError("");
    setPaywallMessage("");
  };

  // Mesmo cuidado da tela de pacientes: se o limite já foi atingido, o
  // convite nem chega a abrir o formulário — mostra direto o convite ao
  // plano. O 403 do servidor segue tratado abaixo (é ele a autoridade).
  const handleInviteClick = () => {
    if (caregiverLimitReached(plan, caregiverCount)) {
      setPaywallMessage(caregiverLimitMessage());
    }
    setOpen(true);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => (v ? setOpen(true) : reset())}>
      <Button onClick={handleInviteClick} className="gap-2">
        <UserPlus className="w-4 h-4" /> Convidar
      </Button>
      <DialogContent className="max-w-md">
        {paywallMessage ? (
          <PlanPaywall
            title="Cuidar junto é melhor"
            message={paywallMessage}
            onDismiss={reset}
          />
        ) : !result ? (
          <>
            <DialogHeader>
              <DialogTitle>Convidar cuidador</DialogTitle>
              <DialogDescription>O link expira em 7 dias e só pode ser usado uma vez.</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="inv-email">E-mail (opcional)</Label>
                <Input id="inv-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Se souber o e-mail da pessoa" />
              </div>
              <div className="space-y-2">
                <Label>Papel</Label>
                <Select value={role} onValueChange={(v) => setRole(v as Role)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="caregiver">Cuidador</SelectItem>
                    <SelectItem value="hired_caregiver">Cuidador contratado</SelectItem>
                    <SelectItem value="observer">Observador (só acompanha)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
              <div className="flex gap-3 justify-end pt-2">
                <Button type="button" variant="secondary" onClick={reset}>Cancelar</Button>
                <Button type="submit" disabled={loading}>{loading ? "Criando…" : "Gerar convite"}</Button>
              </div>
            </form>
          </>
        ) : (
          <>
            <DialogHeader>
              <DialogTitle>Convite criado</DialogTitle>
              <DialogDescription>Compartilhe este link — ele não mostra nenhum dado de saúde até a pessoa aceitar.</DialogDescription>
            </DialogHeader>
            <div className="space-y-3">
              <div className="flex gap-2">
                <Input readOnly value={fullLink} className="text-sm" />
                <Button type="button" variant="outline" size="icon" onClick={handleCopy}>
                  {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                </Button>
              </div>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-zelo-green text-white font-medium text-sm hover:opacity-90"
              >
                <MessageCircle className="w-4 h-4" /> Compartilhar no WhatsApp
              </a>
            </div>
            <div className="flex justify-end pt-2">
              <Button variant="secondary" onClick={reset}>Fechar</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function CaregiversPage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isPrimary = user?.caregiver?.role === "primary_caregiver";

  const { data: caregivers, isLoading } = useQuery({ queryKey: ["caregivers"], queryFn: fetchCaregivers });
  const { data: invites } = useQuery({ queryKey: ["invites"], queryFn: fetchInvites, enabled: isPrimary });

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["caregivers"] });
    void queryClient.invalidateQueries({ queryKey: ["invites"] });
  };

  const handleRoleChange = async (caregiverId: number, role: Role) => {
    const res = await authFetch(`/api/caregivers/${caregiverId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    if (res.ok) invalidate();
  };

  const handleRemove = async (caregiverId: number) => {
    const res = await authFetch(`/api/caregivers/${caregiverId}`, { method: "DELETE" });
    if (res.ok) invalidate();
  };

  const handleRevokeInvite = async (inviteId: number) => {
    const res = await authFetch(`/api/invites/${inviteId}`, { method: "DELETE" });
    if (res.ok) invalidate();
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-8">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold">Quem cuida com você</h2>
            <p className="text-muted-foreground text-[17px]">Presença da família, visível para todo mundo.</p>
          </div>
          {isPrimary && (
            <InviteDialog onCreated={invalidate} plan={user?.plan} caregiverCount={caregivers?.length ?? 0} />
          )}
        </div>

        {isLoading && <p className="text-muted-foreground text-center py-8">Carregando…</p>}

        <div className="space-y-3">
          {caregivers?.map((c) => {
            const isSelf = c.id === user?.caregiver?.id;
            return (
              <div key={c.id} className="flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm">
                <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center shrink-0">
                  <User className="w-6 h-6 text-muted-foreground" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[18px] font-medium truncate">{c.name}{isSelf && " (você)"}</p>
                  {isPrimary && !isSelf ? (
                    <Select value={c.role} onValueChange={(v) => void handleRoleChange(c.id, v as Role)}>
                      <SelectTrigger className="h-8 w-[220px] text-sm mt-1"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {Object.entries(ROLE_LABELS).filter(([r]) => r !== "primary_caregiver").map(([r, label]) => (
                          <SelectItem key={r} value={r}>{label}</SelectItem>
                        ))}
                        <SelectItem value="primary_caregiver">Cuidador principal</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <div className="mt-1"><CaregiverBadge role={c.role} /></div>
                  )}
                </div>
                {isPrimary && !isSelf && (
                  <Button variant="ghost" size="icon" onClick={() => void handleRemove(c.id)} title="Remover acesso">
                    <X className="w-4 h-4 text-muted-foreground" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        {isPrimary && invites && invites.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Convites pendentes</h3>
            {invites.filter((i) => i.status === "pending").map((inv) => (
              <div key={inv.id} className="flex items-center justify-between gap-3 p-3 rounded-lg border bg-muted/30">
                <div>
                  <p className="text-sm">{inv.invitedEmail ?? "Link compartilhável"}</p>
                  <p className="text-xs text-muted-foreground">{ROLE_LABELS[inv.role]} · expira {new Date(inv.expiresAt).toLocaleDateString("pt-BR")}</p>
                </div>
                <Button variant="ghost" size="sm" onClick={() => void handleRevokeInvite(inv.id)}>Revogar</Button>
              </div>
            ))}
          </div>
        )}

        {/* Atividade recente — Issue #13.
            A rota e o componente existiam ha tempo e nenhuma tela os
            renderizava. O lugar e aqui: "quem registrou a dose das 8h?" e
            pergunta sobre PESSOAS da familia, e e nesta tela que se ve quem
            sao.
            O texto vem de templates fixos no servidor e nunca carrega nome de
            medicamento — ha teste provando, inclusive no caminho de fallback. */}
        <ActivityFeed limit={15} />
      </main>
    </div>
  );
}
