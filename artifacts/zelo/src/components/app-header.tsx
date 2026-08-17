import { Link, useLocation } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LogOut, Users, User, Settings } from "lucide-react";

export function AppHeader() {
  const { user, logout } = useAuth();
  const [location] = useLocation();

  return (
    <header className="bg-card border-b sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
        <Link href="/" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl">
            Z
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-none">ZELO</h1>
            <p className="text-sm text-muted-foreground">{user?.family?.name ?? "Cuidado compartilhado"}</p>
          </div>
        </Link>
        <div className="flex items-center gap-1">
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
          <Link href="/ajustes">
            <a
              title="Ajustes"
              className={cn(
                "flex items-center px-2.5 py-2 rounded-lg text-sm font-medium",
                location === "/ajustes" ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground"
              )}
            >
              <Settings className="w-4 h-4" />
            </a>
          </Link>
          <Button variant="ghost" size="sm" onClick={() => void logout()} className="gap-2">
            <LogOut className="w-4 h-4" />
            <span className="hidden sm:inline">Sair</span>
          </Button>
        </div>
      </div>
    </header>
  );
}
