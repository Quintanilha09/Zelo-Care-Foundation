/**
 * Ajustes — hub — ZELO.
 *
 * Cada categoria vive na própria tela agora (Plano, Notificações, Registro
 * retroativo) — antes era tudo empilhado numa página só, obrigando a
 * rolar por ajustes que a maioria nunca mexe pra chegar no que importa.
 */
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { CreditCard, Bell, History, ChevronRight } from "lucide-react";

function SettingsRow({
  href, icon: Icon, title, description,
}: { href: string; icon: typeof CreditCard; title: string; description: string }) {
  return (
    <Link href={href}>
      <a className="flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm hover:border-primary/40 transition-colors">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        <div className="flex-1">
          <p className="text-[16px] font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </a>
    </Link>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Ajustes</h2>
          <p className="text-muted-foreground text-[15px]">Configurações da família.</p>
        </div>

        <div className="space-y-3">
          <SettingsRow
            href="/planos"
            icon={CreditCard}
            title="Plano"
            description={user?.plan ? (user.plan.isPaid ? "Família" : "Grátis — ver o que o plano Família libera") : "Carregando…"}
          />
          <SettingsRow
            href="/ajustes/notificacoes"
            icon={Bell}
            title="Notificações"
            description="Medicamento na notificação, silêncio noturno, diagnóstico de push"
          />
          <SettingsRow
            href="/ajustes/registro-retroativo"
            icon={History}
            title="Registro retroativo"
            description="Prazo pra registrar uma dose passada sem pedir justificativa"
          />
        </div>
      </main>
    </div>
  );
}
