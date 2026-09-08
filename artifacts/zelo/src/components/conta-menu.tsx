/**
 * Menu da conta — Issue #113.
 *
 * ── Por que existe ────────────────────────────────────────────────────────
 *
 * No lugar da engrenagem e do botão "Sair" soltos no cabeçalho: um menu que
 * abre no avatar, como no GitHub. Reúne o que é "sobre mim e minha conta" —
 * perfil, ajustes, trocar de família, sair — e deixa a barra para o que é
 * trabalho de verdade (Pacientes, Cuidadores).
 *
 * ── O avatar ainda não tem foto ──────────────────────────────────────────
 *
 * A foto de perfil chega na #116. Até lá o avatar mostra a inicial do nome, e
 * o item "Meu perfil" leva ao mesmo lugar que "Ajustes" — a #116 aponta ele
 * para a seção de perfil quando ela existir. Os dois itens são de propósito,
 * não engano: a estrutura do menu entra agora, o destino vem depois.
 */
import { useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { FamilySwitcher } from "@/components/family-switcher";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { User, Settings, LogOut } from "lucide-react";

/** Até duas iniciais do nome, para o avatar enquanto não há foto. */
function iniciais(nome: string | undefined): string {
  const partes = (nome ?? "").trim().split(/\s+/).filter(Boolean);
  if (partes.length === 0) return "?";
  if (partes.length === 1) return partes[0].slice(0, 1).toUpperCase();
  return (partes[0][0] + partes[partes.length - 1][0]).toUpperCase();
}

export function ContaMenu() {
  const { user, logout } = useAuth();
  const [, navigate] = useLocation();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className="ml-1 rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
        aria-label={`Menu de ${user?.name ?? "conta"}`}
      >
        <Avatar className="h-9 w-9 border">
          <AvatarFallback className="bg-muted text-sm font-medium text-muted-foreground">
            {iniciais(user?.name)}
          </AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-60">
        {/* Também responde "que conta é esta?" — a mesma pergunta que o e-mail
            fixo no cabeçalho resolve (Issue #78), aqui com o nome junto. */}
        <DropdownMenuLabel className="font-normal">
          <p className="truncate text-sm font-medium">{user?.name ?? "…"}</p>
          {user?.email && (
            <p className="truncate text-xs text-muted-foreground">{user.email}</p>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />

        <DropdownMenuItem onSelect={() => navigate("/ajustes")}>
          <User className="mr-2 h-4 w-4" aria-hidden /> Meu perfil
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => navigate("/ajustes")}>
          <Settings className="mr-2 h-4 w-4" aria-hidden /> Ajustes
        </DropdownMenuItem>

        {/* Não renderiza nada para quem cuida numa família só — a maioria. */}
        <FamilySwitcher />

        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => void logout()}>
          <LogOut className="mr-2 h-4 w-4" aria-hidden /> Sair
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
