/**
 * O cabeçalho do app — ZELO.
 *
 * ── Por que o e-mail aparece aqui — Issue #78 ────────────────────────────
 *
 * Em 02/09/2026 o fundador reportou que uma conta recém-criada já vinha com
 * um paciente, o que seria uma falha grave de isolamento. **Não era.** Ele
 * estava numa conta antiga e não percebeu, porque as duas contas dele mostram
 * o mesmo texto aqui: `POST /auth/register` monta o nome da família como
 * `Família de ${nome}`, então duas contas da mesma pessoa ficam idênticas na
 * tela por construção. Custou uma sessão inteira de investigação, e por pouco
 * uma correção de código num defeito que não existia.
 *
 * O e-mail é o **único** dado que distingue duas contas da mesma pessoa.
 *
 * ── Por que fixo, e não dentro de um menu ────────────────────────────────
 *
 * Um menu satisfaria a letra do critério (ver sem sair da tela), e não teria
 * resolvido o caso que originou a Issue: o fundador não foi procurar em que
 * conta estava — ele não desconfiou. Só serve o que se lê sem procurar. (O
 * menu da conta da Issue #113 repete nome e e-mail lá dentro, mas o e-mail
 * fixo aqui continua sendo o que responde sem ninguém procurar.)
 */
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { ContaMenu } from "@/components/conta-menu";
import { cn } from "@/lib/utils";
import { Users, User } from "lucide-react";

export function AppHeader() {
  const { user } = useAuth();
  const [location] = useLocation();

  return (
    <header className="bg-card border-b sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 shrink-0 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl">
            Z
          </div>
          {/*
            `min-w-0` nos dois níveis é o que faz o `truncate` funcionar de
            verdade: um filho de flex não encolhe abaixo do próprio conteúdo
            sem isso, e o e-mail empurraria os botões para fora da tela num
            celular. Mesma lição da Issue #88.
          */}
          <div className="min-w-0">
            <h1 className="font-semibold text-lg leading-tight">ZELO</h1>
            <p className="text-sm text-muted-foreground leading-tight truncate">
              {user?.family?.name ?? "Cuidado compartilhado"}
            </p>
            {user?.email && (
              <p
                className="text-xs text-muted-foreground/80 leading-tight truncate"
                title={user.email}
                data-testid="email-da-conta"
              >
                {user.email}
              </p>
            )}
          </div>
        </Link>
        <div className="flex items-center gap-1 shrink-0">
          <Link href="/pacientes">
            <a className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium",
              location.startsWith("/pacientes") ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
              <User className="w-4 h-4" />
              <span className="hidden sm:inline">Pacientes</span>
            </a>
          </Link>
          <Link href="/cuidadores">
            <a className={cn(
              "flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium",
              location === "/cuidadores" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
            )}>
              <Users className="w-4 h-4" />
              <span className="hidden sm:inline">Cuidadores</span>
            </a>
          </Link>
          {/* Ajustes e Sair moram no menu do avatar desde a Issue #113 — não
              mais como ícones soltos aqui. */}
          <ContaMenu />
        </div>
      </div>
    </header>
  );
}
