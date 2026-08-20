/**
 * Planos — ZELO.
 *
 * Tela dedicada de comparação — antes o paywall (ex: limite de paciente)
 * só mostrava uma mensagem, sem nenhum lugar pra ver os planos de verdade
 * nem uma ação concreta pra seguir. Serve tanto quem chega direto de
 * Ajustes quanto quem é redirecionado por um paywall (limite de paciente,
 * de cuidador, etc.).
 *
 * O botão de assinar ainda não processa pagamento — a integração com um
 * PSP real (Stripe/Mercado Pago/Pagar.me) é decisão de fornecedor adiada
 * de propósito pelo fundador (mesmo padrão do SMS). Por enquanto o cartão
 * do plano Família é honesto sobre isso em vez de simular uma cobrança.
 */
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Check, Heart, Clock } from "lucide-react";

interface PlanFeature {
  label: string;
  free: string;
  paid: string;
}

const FEATURES: PlanFeature[] = [
  { label: "Pacientes", free: "1", paid: "Até 5" },
  { label: "Cuidadores por família", free: "1", paid: "Ilimitado" },
  { label: "Medicamentos cadastrados", free: "3", paid: "Ilimitado" },
  { label: "Histórico de adesão", free: "7 dias", paid: "Ilimitado" },
  { label: "Agenda de consultas e exames", free: "—", paid: "Incluída" },
  { label: "Alerta de estoque baixo", free: "—", paid: "Incluído" },
];

export default function PlansPage() {
  const { user } = useAuth();
  const isPaid = user?.plan?.isPaid ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <Link href="/ajustes">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Ajustes
          </a>
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Planos</h2>
          <p className="text-muted-foreground text-[15px]">Seu plano atual: <span className="font-medium text-foreground">{isPaid ? "Família" : "Grátis"}</span></p>
        </div>

        <div className="grid sm:grid-cols-2 gap-4">
          <div className={`p-5 rounded-xl border space-y-4 ${!isPaid ? "border-primary/40 bg-card" : "bg-muted/30"}`}>
            <div>
              <p className="font-semibold text-lg">Grátis</p>
              <p className="text-sm text-muted-foreground">Pra começar e experimentar de verdade.</p>
            </div>
            {!isPaid && <span className="inline-block text-xs px-2 py-1 rounded-full bg-primary/10 text-primary">Seu plano atual</span>}
          </div>

          <div className={`p-5 rounded-xl border space-y-4 ${isPaid ? "border-zelo-green/40 bg-zelo-green-bg/30" : "bg-card"}`}>
            <div className="flex items-center gap-2">
              <Heart className="w-4 h-4 text-zelo-green-fg shrink-0" />
              <p className="font-semibold text-lg">Família</p>
            </div>
            <p className="text-sm text-muted-foreground">Cuidar junto é melhor — mais gente, mais pacientes, sem limite no que importa.</p>
            {isPaid ? (
              <span className="inline-block text-xs px-2 py-1 rounded-full bg-zelo-green/15 text-zelo-green-fg">Seu plano atual</span>
            ) : (
              <div className="space-y-2">
                <Button className="w-full gap-2" disabled>
                  <Clock className="w-4 h-4" /> Assinar — em breve
                </Button>
                <p className="text-xs text-muted-foreground">
                  Ainda estamos habilitando o pagamento. Assim que estiver pronto, dá pra assinar direto por aqui, sem sair do app.
                </p>
              </div>
            )}
          </div>
        </div>

        <div className="rounded-xl border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="p-3 font-medium text-muted-foreground">Recurso</th>
                <th className="p-3 font-medium text-muted-foreground">Grátis</th>
                <th className="p-3 font-medium text-muted-foreground">Família</th>
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.label} className="border-t">
                  <td className="p-3">{f.label}</td>
                  <td className="p-3 text-muted-foreground">{f.free}</td>
                  <td className="p-3 text-zelo-green-fg font-medium flex items-center gap-1.5">
                    {f.paid !== "—" && <Check className="w-3.5 h-3.5 shrink-0" />} {f.paid}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </main>
    </div>
  );
}
