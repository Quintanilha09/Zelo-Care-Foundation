/**
 * Ajustes — hub — ZELO (QUI-19).
 *
 * ── Por que virou seções ──────────────────────────────────────────────────
 *
 * Cada categoria já vivia na própria tela (Plano, Notificações, Registro
 * retroativo) — antes era tudo empilhado numa página só, obrigando a rolar
 * por ajustes que a maioria nunca mexe pra chegar no que importa.
 *
 * A lista plana resolveu aquilo e criou outro problema: com a chegada de
 * "Seus dados" (QUI-17) viraram quatro linhas sem hierarquia nenhuma, e
 * "Cuidadores" continuava existindo só no cabeçalho. Lista plana de itens
 * heterogêneos não se lê — se varre.
 *
 * As quatro seções não são decoração: elas respondem a **de quem é a coisa**.
 * "Notificações" é da família inteira (o silêncio noturno vale para todo
 * mundo); "Baixar ou excluir" é do titular; "Plano" é da conta que paga.
 * Agrupar por dono é o que faz alguém achar o ajuste sem ler todos.
 */
import type { ReactNode } from "react";
import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import {
  CreditCard, Bell, History, ChevronRight, ShieldCheck, Users, Smartphone, User,
} from "lucide-react";

function SettingsRow({
  href, icon: Icon, title, description,
}: { href: string; icon: typeof CreditCard; title: string; description: string }) {
  return (
    <Link href={href}>
      <a className="flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm hover:border-primary/40 transition-colors">
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
          <Icon className="w-5 h-5 text-muted-foreground" />
        </div>
        {/* `min-w-0` aqui pelo mesmo motivo da Issue #28: sem ele, uma
            descrição longa se recusa a encolher e empurra a setinha para
            fora da tela no celular. */}
        <div className="flex-1 min-w-0">
          <p className="text-[16px] font-medium">{title}</p>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
        <ChevronRight className="w-5 h-5 text-muted-foreground shrink-0" />
      </a>
    </Link>
  );
}

function Secao({ titulo, children }: { titulo: string; children: ReactNode }) {
  return (
    <section className="space-y-3">
      <h3 className="text-sm font-medium text-muted-foreground">{titulo}</h3>
      {children}
    </section>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-8">
        <div>
          <h2 className="text-2xl font-semibold">Ajustes</h2>
          <p className="text-muted-foreground text-[17px]">
            {user?.family?.name ?? "Configurações da família."}
          </p>
        </div>

        <Secao titulo="Conta">
          {/* Identidade não é ajuste: não leva a lugar nenhum, e por isso não
              é um `SettingsRow` com setinha. Serve para responder, num
              relance, "estou em qual conta mesmo?" — pergunta que aparece de
              verdade em quem cuida de duas famílias. */}
          <div className="flex items-center gap-4 p-4 rounded-xl border bg-card shadow-sm">
            <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center shrink-0">
              <User className="w-5 h-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-[16px] font-medium truncate">{user?.name ?? "…"}</p>
              <p className="text-sm text-muted-foreground truncate">{user?.email ?? ""}</p>
            </div>
          </div>

          {/* Issue #45: a identidade acima RESPONDE "que conta e esta?"; esta
              linha responde "como mudo isso?". Eram duas perguntas e so a
              primeira tinha resposta. */}
          <SettingsRow
            href="/ajustes/conta"
            icon={User}
            title="Sua conta"
            description="Trocar seu nome ou sua senha"
          />

          <SettingsRow
            href="/planos"
            icon={CreditCard}
            title="Plano"
            description={
              user?.plan
                ? user.plan.isPaid
                  ? user.plan.label
                  : "Grátis — ver o que o plano Família libera"
                : "Carregando…"
            }
          />
        </Secao>

        <Secao titulo="Família">
          {/* Cuidadores só existia no cabeçalho. Quem procura "como convido
              minha irmã" procura em Ajustes — é onde a pergunta cabe. */}
          <SettingsRow
            href="/cuidadores"
            icon={Users}
            title="Cuidadores"
            description="Quem cuida junto, e o que cada um pode fazer"
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
        </Secao>

        <Secao titulo="Seus dados">
          {/* QUI-17 — as duas metades da LGPD moravam só no servidor: a rota
              existia, testada, e nenhuma tela chamava. Direito que exige
              `curl` para ser exercido não é direito do titular. */}
          <SettingsRow
            href="/ajustes/seus-dados"
            icon={ShieldCheck}
            title="Baixar ou excluir"
            description="Levar uma cópia de tudo, ou apagar a conta e os dados"
          />
        </Secao>

        <Secao titulo="Ajuda">
          <SettingsRow
            href="/notificacoes/ios"
            icon={Smartphone}
            title="Notificações no iPhone"
            description="Como instalar o ZELO na tela de início pra receber lembrete"
          />
        </Secao>
      </main>
    </div>
  );
}
