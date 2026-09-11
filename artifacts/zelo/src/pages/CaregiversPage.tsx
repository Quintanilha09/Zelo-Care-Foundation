/**
 * Cuidadores e convites — ZELO.
 *
 * A visibilidade da família é o diferencial do produto. Ações de gestão
 * (trocar papel, revogar, convidar) só aparecem para o cuidador principal; o
 * servidor é a autoridade real, isso aqui é só esconder o botão que o backend
 * rejeitaria de qualquer forma.
 *
 * ── O título mudou na #121 ────────────────────────────────────────────────
 *
 * Era "Quem cuida com você". Isso afirma que todo mundo está no mesmo
 * círculo — verdade numa família, falso numa casa com vários pacientes, onde
 * cada cuidador atende os seus. O fundador notou testando: *"a mensagem
 * sugere que estamos todos na mesma família. Mas e para uma empresa?"*.
 *
 * "Quem cuida aqui" não afirma nada sobre quem cuida de quem — e a resposta
 * a isso passou a estar em cada cartão.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { PlanPaywall } from "@/components/plan-paywall";
import {
  caregiverLimitReached, caregiverLimitMessage, type PlanView,
} from "@/lib/plan-limits-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { apiUrl } from "@/lib/auth-client";
import { iniciais, rotuloDoParentesco } from "@/lib/perfil";
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
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { UserPlus, X, Copy, Check, MessageCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

/**
 * Esqueleto de "Quem cuida aqui" — Issue #5.
 *
 * Mesmo formato da linha real: círculo do avatar, nome e a etiqueta de papel
 * logo abaixo. Duas linhas — a família típica tem dois ou três cuidadores, e
 * quem está sozinho vê o esqueleto sumir rápido demais para contar.
 */
function EsqueletoDeCuidadores() {
  return (
    <AreaCarregando rotulo="Carregando quem cuida aqui">
      <div className="space-y-3">
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="flex items-center gap-4 p-4 rounded-xl border">
            <Esqueleto className="w-12 h-12 rounded-full shrink-0" />
            <div className="flex-1 space-y-2">
              <Esqueleto className="h-5 w-2/5" />
              <Esqueleto className="h-4 w-24 rounded-full" />
            </div>
          </div>
        ))}
      </div>
    </AreaCarregando>
  );
}

type Role = "primary_caregiver" | "caregiver" | "hired_caregiver" | "observer";

interface Caregiver {
  id: number;
  name: string;
  email: string | null;
  role: Role;
  /**
   * Issue #116 — visíveis para a família toda (decisão D2 do refinamento).
   *
   * O que NÃO existe aqui, e é de propósito: em que outras famílias esta
   * pessoa cuida. Contar isso a esta família expõe relação de terceiro que
   * ela não tem direito de conhecer (achado 2 do refinamento).
   */
  phone: string | null;
  relationship: string | null;
  fotoUrl: string | null;
  /**
   * De quem esta pessoa é responsável — Issue #121.
   *
   * Lista vazia, nunca ausente: "não é responsável por ninguém ainda" e "o
   * campo não veio" se parecem demais quando a diferença é `undefined`.
   *
   * **Não diz quem ela pode ver.** Todo cuidador da família continua vendo
   * todo paciente dela — o vínculo é informativo (#120).
   */
  pacientes: Array<{ id: number; name: string }>;
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
                /* Issue #151: `text-primary-foreground`, e não `text-white`.
                   Este é o único lugar do app que escrevia a tinta do verde
                   à mão — e era por isso que ele aparecia na lista de dívida
                   de contraste ao lado do botão primário. No escuro o verde
                   clareia e a tinta escurece junto; `text-white` fixo faria
                   branco sobre verde-claro, que é ilegível. */
                className="flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-zelo-green text-primary-foreground font-medium text-sm hover:opacity-90"
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

  // Convite ACEITO continua vindo da rota — `invites` traz todo tipo, nao so
  // os pendentes. Derivar aqui, uma vez, e o que impede a armadilha de
  // decidir a secao por um conjunto e listar outro (Issue #47).
  const convitesPendentes = invites?.filter((i) => i.status === "pending");

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ["caregivers"] });
    void queryClient.invalidateQueries({ queryKey: ["invites"] });
  };

  /** Qual cuidador está sendo resgatado agora — Issue #87. */
  const [resgatando, setResgatando] = useState<number | null>(null);
  /**
   * Erro do resgate, separado do erro do convite.
   *
   * O `error` que já existia nesta tela mora dentro do `InviteDialog`, é de
   * outro escopo e de outro assunto. Reaproveitá-lo faria a falha de um
   * aparecer no lugar do outro — e foi o que a primeira versão deste patch
   * tentou fazer, até o typecheck reclamar.
   */
  const [erroDoResgate, setErroDoResgate] = useState("");

  const handleRoleChange = async (caregiverId: number, role: Role) => {
    const res = await authFetch(`/api/caregivers/${caregiverId}`, { method: "PATCH", body: JSON.stringify({ role }) });
    if (res.ok) invalidate();
  };

  const handleRemove = async (caregiverId: number) => {
    const res = await authFetch(`/api/caregivers/${caregiverId}`, { method: "DELETE" });
    if (res.ok) invalidate();
  };

  /**
   * Restaurar o acesso de alguém da família — Issue #87.
   *
   * A confirmação diz o que a ação FAZ, e não o nome dela: "restaurar acesso"
   * não deixa claro que a próxima entrada da pessoa pula o segundo fator, e é
   * exatamente isso que quem clica precisa entender antes de clicar.
   *
   * Diz também que a pessoa será avisada. Quem faz um favor não se importa;
   * quem faria por outro motivo pensa duas vezes — e as duas reações são boas.
   */
  const handleResgate = async (caregiverId: number, nome: string) => {
    const certeza = window.confirm(
      `Restaurar o acesso de ${nome}?\n\n` +
        "A próxima entrada dela, nas próximas 24 horas, não vai pedir o código de aparelho novo. " +
        "A senha dela continua sendo necessária.\n\n" +
        "Ela será avisada por e-mail de que foi você quem restaurou.",
    );
    if (!certeza) return;

    setResgatando(caregiverId);
    setErroDoResgate("");
    try {
      const res = await authFetch(`/api/caregivers/${caregiverId}/resgate`, { method: "POST" });
      const dados = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!res.ok) {
        setErroDoResgate(dados.error ?? "Não foi possível restaurar o acesso agora.");
        return;
      }
      window.alert(dados.message ?? "Acesso restaurado.");
    } catch {
      setErroDoResgate("Não foi possível falar com o servidor.");
    } finally {
      setResgatando(null);
    }
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
            <h2 className="text-2xl font-semibold">Quem cuida aqui</h2>
            <p className="text-muted-foreground text-[17px]">Quem é responsável por quem — visível para todo mundo.</p>
          </div>
          {isPrimary && (
            <InviteDialog onCreated={invalidate} plan={user?.plan} caregiverCount={caregivers?.length ?? 0} />
          )}
        </div>

        {isLoading && <EsqueletoDeCuidadores />}

        {erroDoResgate && (
          <Alert>
            <AlertDescription>{erroDoResgate}</AlertDescription>
          </Alert>
        )}

        <div className={`space-y-3 ${isLoading ? "" : "zelo-entra"}`}>
          {caregivers?.map((c) => {
            const isSelf = c.id === user?.caregiver?.id;
            return (
              <div key={c.id} className="flex items-start gap-4 p-4 rounded-xl border bg-card shadow-sm">
                {/* Issue #116: o rosto de quem cuida. Sem foto, as iniciais —
                    nunca um ícone genérico, que faz todo mundo parecer a
                    mesma pessoa. */}
                <Avatar className="h-12 w-12 shrink-0 border">
                  {c.fotoUrl && <AvatarImage src={apiUrl(c.fotoUrl)} alt="" />}
                  <AvatarFallback className="bg-muted text-muted-foreground font-medium">
                    {iniciais(c.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  {/* Issue #88: o `truncate` ja segurava o layout; faltava
                      o nome inteiro ficar alcancavel para quem so ve o
                      corte. */}
                  <p className="text-[18px] font-medium truncate" title={c.name}>{c.name}{isSelf && " (você)"}</p>
                  {/* Parentesco é rótulo humano, e vem ANTES do papel de
                      propósito: "filha" é como a família reconhece a pessoa;
                      "cuidador principal" é o que ela pode fazer no app. */}
                  {rotuloDoParentesco(c.relationship) && (
                    <p className="text-sm text-muted-foreground truncate">
                      {rotuloDoParentesco(c.relationship)}
                    </p>
                  )}
                  {(c.phone || c.email) && (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm">
                      {c.phone && (
                        <a href={`tel:${c.phone.replace(/[^0-9+]/g, "")}`} className="text-primary hover:underline">
                          {c.phone}
                        </a>
                      )}
                      {c.email && (
                        <a href={`mailto:${c.email}`} className="text-muted-foreground hover:underline truncate">
                          {c.email}
                        </a>
                      )}
                    </p>
                  )}

                  {/* De quem esta pessoa responde — Issue #121.
                      Sem vínculo, a linha diz isso em vez de sumir: numa casa
                      com vários pacientes, "não sei de quem essa pessoa cuida"
                      e "essa pessoa não cuida de ninguém" são respostas
                      diferentes, e só a segunda é acionável. */}
                  <p className="mt-1 text-sm text-muted-foreground">
                    {c.pacientes.length === 0 ? (
                      <span>Ainda não é responsável por ninguém</span>
                    ) : (
                      <>
                        Responsável por{" "}
                        {c.pacientes.map((p, i) => (
                          <span key={p.id}>
                            {i > 0 && (i === c.pacientes.length - 1 ? " e " : ", ")}
                            <Link href={`/pacientes/${p.id}`} asChild>
                              <a className="text-foreground underline underline-offset-2 hover:no-underline">
                                {p.name}
                              </a>
                            </Link>
                          </span>
                        ))}
                      </>
                    )}
                  </p>
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
                {/* Issue #87: restaurar o acesso de quem perdeu o e-mail. Só
                    para o cuidador principal, e nunca no próprio cartão — quem
                    está lendo esta tela já entrou.

                    Botão com texto, e não ícone: "resgatar" não tem símbolo
                    que se entenda sozinho. O de remover ao lado segue ícone
                    porque X é universal. */}
                {isPrimary && !isSelf && (
                  <div className="flex items-center gap-1 shrink-0">
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleResgate(c.id, c.name)}
                      disabled={resgatando === c.id}
                    >
                      {resgatando === c.id ? "Restaurando…" : "Restaurar acesso"}
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => void handleRemove(c.id)} title="Remover acesso">
                      <X className="w-4 h-4 text-muted-foreground" />
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* A guarda contava `invites.length` — TODOS os convites — e a lista
            filtrava `status === "pending"`. Um convite aceito e nenhum
            pendente deixava o titulo sozinho na tela. Agora as duas olham
            `convitesPendentes` (Issue #47).
            `undefined` e "ainda carregando": nao renderiza nada, para nao
            piscar "Nenhum convite pendente" antes da resposta chegar. */}
        {isPrimary && convitesPendentes !== undefined && (
          <div className="space-y-3">
            <h3 className="text-sm font-medium text-muted-foreground">Convites pendentes</h3>
            {convitesPendentes.length === 0 && (
              <p className="text-sm text-muted-foreground">Nenhum convite pendente.</p>
            )}
            {convitesPendentes.map((inv) => (
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
