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
import { apiUrl } from "@/lib/auth-client";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { iniciais } from "@/lib/perfil";
import { AppHeader } from "@/components/app-header";
import { cn } from "@/lib/utils";
import {
  User, IdCard, CreditCard, Users, Bell, History, ShieldCheck, Smartphone,
  ArrowLeft, ExternalLink, ChevronRight, SunMoon,
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
      /**
       * Issue #133 — "Seu perfil" vem PRIMEIRO, e a ordem é o conserto.
       *
       * O fundador foi procurar a própria foto em "Sua conta" e não achou:
       * ela mora aqui, em "Seu perfil". A divisão veio da #114 copiando o
       * GitHub (*Account* de um lado, *Public profile* do outro) e **está
       * certa** — o que estava errado era a ordem.
       *
       * No GitHub, *Public profile* é o primeiro item da lista e é onde
       * está a foto. No Zelo, "Sua conta" vinha antes — e "conta" é a
       * palavra que uma pessoa procura quando quer trocar o próprio
       * retrato. Quem varre a lista de cima para baixo agora encontra o
       * perfil antes de desistir.
       */
      { href: "/ajustes/perfil", rotulo: "Seu perfil", icone: IdCard },
      { href: "/ajustes/conta", rotulo: "Sua conta", icone: User },
      // Issue #138 — onde o GitHub tambem poe: Ajustes, no grupo da conta.
      // A preferencia e por APARELHO, entao ela nao mora no perfil (que e o
      // que a familia ve sobre voce) nem na conta (que e a mesma em todo
      // lugar). Aparencia e deste telefone.
      { href: "/ajustes/aparencia", rotulo: "Aparência", icone: SunMoon },
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
            aparece (Issue #78). Repetir em toda seção seria ruído.

            ── Issue #133: o cartão existia e mostrava um desconhecido ──────

            Ele nasceu na #78 com um ícone genérico de pessoa, e continuou
            assim depois de a #116 trazer a foto de perfil. O efeito: quem
            tinha foto abria os Ajustes e via a silhueta cinza — a mesma
            imagem de quem nunca mandou nenhuma.

            Foi metade do relato do fundador ("a imagem não é salva"). A
            outra metade é que o cartão não levava a lugar nenhum: ele
            dizia quem você é sem oferecer o caminho para mexer nisso, e a
            pessoa ia procurar em "Sua conta", onde a foto não mora.

            Agora mostra o rosto de verdade e é o atalho para "Seu perfil". */}
        {naRaiz && (
          <Link href="/ajustes/perfil" asChild>
            <a className="mt-5 flex items-center gap-4 rounded-xl border bg-card p-4 shadow-sm transition-colors hover:border-primary/40">
              <Avatar className="h-12 w-12 shrink-0 border">
                {user?.caregiver?.fotoUrl && (
                  <AvatarImage src={apiUrl(user.caregiver.fotoUrl)} alt="" />
                )}
                <AvatarFallback className="bg-muted font-medium text-muted-foreground">
                  {iniciais(user?.name)}
                </AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <p className="truncate text-[16px] font-medium">{user?.name ?? "…"}</p>
                <p className="truncate text-sm text-muted-foreground">{user?.email ?? ""}</p>
                <p className="truncate text-sm text-muted-foreground">{user?.family?.name ?? ""}</p>
              </div>
              <ChevronRight className="ml-auto h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
            </a>
          </Link>
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
                        {/* `asChild` não é enfeite — Issue #114.
                            Sem ele, o `<Link>` do wouter monta o PRÓPRIO `<a>`
                            e põe o meu dentro. Dois âncoras aninhadas são HTML
                            inválido: o navegador achata em duas irmãs, a de
                            fora com o `href` e a minha com a classe e o
                            `aria-current`, sem href nenhum. O leitor de tela
                            anuncia dois links por seção, e o CI pegou isso
                            pelo href vazio no item marcado. */}
                        <Link href={secao.href} asChild>
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
              <Link href="/ajustes" asChild>
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
