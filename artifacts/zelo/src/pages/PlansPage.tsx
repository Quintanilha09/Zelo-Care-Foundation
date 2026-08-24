/**
 * Planos — ZELO (ZELO-38, estendido na ZELO-56).
 *
 * Três planos contratáveis sozinho (Grátis, Família, Profissional) mais o
 * caminho institucional — que NÃO é um tier com botão de assinar: casa de
 * repouso e empresa de cuidado são cobradas por leito ativo/mês, com
 * cadastro verificado e implantação acompanhada (ver "ZELO - Extensao B2B
 * Institucional.md" §6 e §8). Aqui ele aparece como contato, de propósito.
 *
 * O botão de assinar ainda não processa pagamento — a integração com um
 * PSP real é decisão de fornecedor adiada pelo fundador (mesmo padrão do
 * SMS). Os cartões são honestos sobre isso em vez de simular cobrança.
 */
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import type { PlanTier } from "@/lib/plan-limits-client";
import { ArrowLeft, Check, Heart, Clock, Building2, Briefcase } from "lucide-react";

interface PlanCard {
  tier: PlanTier;
  name: string;
  pitch: string;
  icon: typeof Heart;
}

const PLANS: PlanCard[] = [
  { tier: "free", name: "Grátis", pitch: "Pra começar e experimentar de verdade.", icon: Check },
  { tier: "family", name: "Família", pitch: "Cuidar junto é melhor — a família inteira acompanhando.", icon: Heart },
  { tier: "professional", name: "Profissional", pitch: "Pra quem cuida de muita gente: cuidador autônomo, acompanhante, home care.", icon: Briefcase },
];

/** Uma linha por recurso, com o valor em cada plano. Espelha os números de
 *  api-server/src/lib/plan-limits.ts — que continua sendo a fonte da
 *  verdade aplicada no servidor. */
const FEATURES: { label: string; values: Record<PlanTier, string> }[] = [
  { label: "Pacientes", values: { free: "1", family: "Até 5", professional: "Até 15" } },
  { label: "Cuidadores por família", values: { free: "1", family: "Ilimitado", professional: "Ilimitado" } },
  { label: "Medicamentos", values: { free: "3", family: "Ilimitado", professional: "Ilimitado" } },
  { label: "Histórico de adesão", values: { free: "7 dias", family: "Completo", professional: "Completo" } },
  { label: "Agenda de consultas", values: { free: "—", family: "Incluída", professional: "Incluída" } },
  { label: "Aviso de estoque acabando", values: { free: "—", family: "Incluído", professional: "Incluído" } },
  { label: "Relatório para o médico", values: { free: "—", family: "Incluído", professional: "Incluído" } },
];

/** O que vale em TODOS os planos, inclusive no gratuito. Fica explícito na
 *  tela porque é uma promessa do produto, não uma omissão: nada que
 *  proteja a segurança do paciente entra em paywall. */
const ALWAYS_INCLUDED = [
  "Registrar que a dose foi tomada",
  "Lembretes e a cascata de avisos quando ninguém registra",
  "Modo idoso, pro próprio paciente confirmar",
];

export default function PlansPage() {
  const { user } = useAuth();
  const currentTier: PlanTier = user?.plan?.tier ?? "free";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-3xl mx-auto px-5 py-8 space-y-6">
        <Link href="/ajustes">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Ajustes
          </a>
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Planos</h2>
          <p className="text-muted-foreground text-[17px]">
            Seu plano atual: <span className="font-medium text-foreground">{user?.plan?.label ?? "Grátis"}</span>
          </p>
        </div>

        <div className="grid sm:grid-cols-3 gap-4">
          {PLANS.map((plan) => {
            const isCurrent = plan.tier === currentTier;
            const Icon = plan.icon;
            return (
              <div
                key={plan.tier}
                className={`p-5 rounded-xl border space-y-3 ${isCurrent ? "border-zelo-green/40 bg-zelo-green-bg/30" : "bg-card"}`}
              >
                <div className="flex items-center gap-2">
                  <Icon className="w-4 h-4 text-zelo-green-fg shrink-0" />
                  <p className="font-semibold text-lg">{plan.name}</p>
                </div>
                <p className="text-sm text-muted-foreground">{plan.pitch}</p>
                {isCurrent ? (
                  <span className="inline-block text-xs px-2 py-1 rounded-full bg-zelo-green/15 text-zelo-green-fg">
                    Seu plano atual
                  </span>
                ) : plan.tier === "free" ? null : (
                  <Button className="w-full gap-2" disabled>
                    <Clock className="w-4 h-4" /> Assinar — em breve
                  </Button>
                )}
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          Ainda estamos habilitando o pagamento. Assim que estiver pronto, dá pra assinar direto por aqui, sem sair do app.
        </p>

        <div className="rounded-xl border overflow-x-auto">
          <table className="w-full text-sm min-w-[520px]">
            <thead>
              <tr className="bg-muted/50 text-left">
                <th className="p-3 font-medium text-muted-foreground">Recurso</th>
                {PLANS.map((p) => (
                  <th key={p.tier} className="p-3 font-medium text-muted-foreground">{p.name}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {FEATURES.map((f) => (
                <tr key={f.label} className="border-t">
                  <td className="p-3">{f.label}</td>
                  {PLANS.map((p) => (
                    <td key={p.tier} className={`p-3 ${p.tier === "free" ? "text-muted-foreground" : "text-zelo-green-fg font-medium"}`}>
                      {f.values[p.tier]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="rounded-xl border bg-card p-4 space-y-2">
          <p className="font-medium text-[17px]">Em todos os planos, inclusive no Grátis</p>
          <ul className="space-y-1.5">
            {ALWAYS_INCLUDED.map((item) => (
              <li key={item} className="flex items-start gap-2 text-sm text-muted-foreground">
                <Check className="w-4 h-4 text-zelo-green-fg shrink-0 mt-0.5" />
                <span>{item}</span>
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground pt-1">
            Nada que proteja quem está sendo cuidado depende de assinatura — nem se o pagamento atrasar.
          </p>
        </div>

        <div className="rounded-xl border border-dashed p-5 space-y-3">
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 text-muted-foreground shrink-0" />
            <p className="font-semibold">Casa de repouso ou empresa de cuidado</p>
          </div>
          <p className="text-sm text-muted-foreground">
            Para instituições, o ZELO funciona diferente: a cobrança é por leito, o acesso das famílias é incluído e sem
            limite, e a implantação é acompanhada — cadastro dos residentes, treinamento da equipe e verificação do
            estabelecimento. Não dá pra contratar sozinho por aqui, e é de propósito.
          </p>
          <Button variant="outline" asChild>
            <a href="mailto:contato@zelo.app?subject=ZELO%20para%20instituições">Falar com a gente</a>
          </Button>
        </div>
      </main>
    </div>
  );
}
