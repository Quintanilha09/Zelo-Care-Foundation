/**
 * A casca dos Ajustes — Issue #114.
 *
 * ── Por que a lista saiu de cartões empilhados ────────────────────────────
 *
 * A QUI-19 agrupou os ajustes por **de quem é a coisa** (a conta, a família,
 * o titular, a ajuda) e isso continua certo — o que não escalava era a forma:
 * cartões empilhados, um destino por vez, sem nunca mostrar o conjunto. Com
 * "Seu perfil" chegando na #116 seriam oito cartões numa pilha.
 *
 * A lista fixa à esquerda mostra o conjunto inteiro o tempo todo, e é o padrão
 * que o fundador pediu por nome (GitHub). Quem procura um ajuste varre a
 * lista; quem procurava na pilha tinha de ler item por item.
 *
 * ── Quem é dono do embrulho agora ────────────────────────────────────────
 *
 * Esta casca. As seis telas de conteúdo tinham, cada uma, o mesmo
 * `min-h-screen` + `<AppHeader />` + `<main>` + link "← Ajustes" copiado.
 * Isso subiu para cá; elas passaram a renderizar só o próprio conteúdo. Uma
 * cópia a menos por tela, e o cabeçalho deixa de piscar ao trocar de seção.
 *
 * ── No celular a lista É o índice ────────────────────────────────────────
 *
 * Duas colunas não cabem num celular, e uma lista espremida ao lado do
 * conteúdo seria pior que as duas coisas separadas. Em `/ajustes` aparece só
 * a lista; dentro de uma seção aparece só o conteúdo, com voltar. No desktop
 * as duas convivem. É o que o GitHub faz, e não precisa ser aprendido.
 */
import type { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { cn } from "@/lib/utils";
import {
  User, CreditCard, Users, Bell, History, ShieldCheck, Smartphone,
  ArrowLeft, ExternalLink,
} from "lucide-react";

interface Secao {
  href: string;
  rotulo: string;
  icone: typeof User;
  /**
   * Sai da casca — a tela tem identidade própria e não é uma seção de
   * ajustes de verdade. Só "Cuidadores" hoje: ela vive na barra do topo,
   * tem convite e atividade recente, e nunca teve o "← Ajustes" que as
   * outras seis tinham. Continua na lista porque quem procura "como convido
   * minha irmã" procura aqui (era o ponto da QUI-19).
   */
  externa?: boolean;
}

/**
 * Os grupos, e por que estes nomes.
 *
 * São os da QUI-19, preservados de propósito: eles respondem **de quem é a
 * coisa**, e é isso que faz alguém achar o ajuste sem ler todos. O que mudou
 * foi a forma de mostrar, não o critério de agrupar.
 */
const GRUPOS: Array<{ titulo: string; secoes: Secao[] }> = [
  {
    titulo: "Conta",
    secoes: [
      { href: "/ajustes/conta", rotulo: "Sua conta", icone: User },
      { href: "/planos", rotulo: "Plano", icone: CreditCard },
    ],
  },
  {
    titulo: "Família",
    secoes: [
      { href: "/cuidadores", rotulo: "Cuidadores", icone: Users, externa: true },
      { href: "/ajustes/notificacoes", rotulo: "Notificações", icone: Bell },
      { href: "/ajustes/registro-retroativo", rotulo: "Registro retroativo", icone: History },
    ],
  },
  {
    titulo: "Seus dados",
    secoes: [
      { href: "/ajustes/seus-dados", rotulo: "Baixar ou excluir", icone: ShieldCheck },
    ],
  },
  {
    titulo: "Ajuda",
    secoes: [
      { href: "/notificacoes/ios", rotulo: "Notificações no iPhone", icone: Smartphone },
    ],
  },
];

export function AjustesShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const { user } = useAuth();
  // `/ajustes` é o índice. No celular ele mostra a lista e nada mais; no
  // desktop mostra a lista mais o painel de boas-vindas.
  const naRaiz = location === "/ajustes";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      {/* `main` envolve a lista TAMBÉM, e não só o conteúdo: a navegação de
          ajustes é parte do que esta página é. */}
      <main className="max-w-5xl mx-auto px-5 py-8">
        <h1 className="text-2xl font-semibold">Ajustes</h1>

        {/* Identidade só no índice, e fora da grade — senão sumiria no
            celular, que é justamente onde a pergunta "estou em qual conta?"
            aparece (Issue #78). Repetir em toda seção seria ruído. */}
        {naRaiz && (
          <div className="mt-5 flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted">
              <User className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="truncate text-[16px] font-medium">{user?.name ?? "…"}</p>
              <p className="truncate text-sm text-muted-foreground">{user?.email ?? ""}</p>
              <p className="truncate text-sm text-muted-foreground">{user?.family?.name ?? ""}</p>
            </div>
          </div>
        )}

        <div className="mt-6 md:grid md:grid-cols-[15rem_1fr] md:gap-10">
          <nav
            aria-label="Seções dos ajustes"
            className={cn(
              // `self-start` + `sticky`: a lista acompanha a rolagem de uma
              // seção longa em vez de sumir para cima.
              "md:block md:self-start md:sticky md:top-24",
              naRaiz ? "block" : "hidden"
            )}
          >
            {GRUPOS.map((grupo) => (
              <div key={grupo.titulo} className="mb-6 last:mb-0">
                <h2 className="mb-1.5 px-3 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  {grupo.titulo}
                </h2>
                <ul className="space-y-0.5">
                  {grupo.secoes.map((secao) => {
                    const ativa = location === secao.href;
                    return (
                      <li key={secao.href}>
                        <Link href={secao.href}>
                          <a
                            aria-current={ativa ? "page" : undefined}
                            className={cn(
                              "flex items-center gap-2.5 rounded-lg px-3 py-2 text-sm",
                              ativa
                                ? "bg-muted font-medium text-foreground"
                                : "text-muted-foreground hover:bg-muted/60 hover:text-foreground"
                            )}
                          >
                            <secao.icone className="h-4 w-4 shrink-0" aria-hidden />
                            <span className="truncate">{secao.rotulo}</span>
                            {secao.externa && (
                              <ExternalLink
                                className="ml-auto h-3 w-3 shrink-0 opacity-50"
                                aria-hidden
                              />
                            )}
                          </a>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className={cn("min-w-0", naRaiz ? "hidden md:block" : "block")}>
            {/* Voltar só no celular: no desktop a lista está do lado, e um
                "voltar" para algo que nunca saiu da tela confunde. */}
            {!naRaiz && (
              <Link href="/ajustes">
                <a className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground md:hidden">
                  <ArrowLeft className="h-4 w-4" aria-hidden /> Ajustes
                </a>
              </Link>
            )}
            {children}
          </div>
        </div>
      </main>
    </div>
  );
}
