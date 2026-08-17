import { Link } from "wouter";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";

export function AppHeader() {
  const { user, logout } = useAuth();

  return (
    <header className="bg-card border-b sticky top-0 z-10">
      <div className="max-w-4xl mx-auto px-5 py-4 flex items-center justify-between gap-3">
        <Link href="/pacientes" className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-primary text-primary-foreground flex items-center justify-center font-bold text-xl">
            Z
          </div>
          <div>
            <h1 className="font-semibold text-lg leading-none">ZELO</h1>
            <p className="text-sm text-muted-foreground">{user?.family?.name ?? "Cuidado compartilhado"}</p>
          </div>
        </Link>
        <Button variant="ghost" size="sm" onClick={() => void logout()} className="gap-2">
          <LogOut className="w-4 h-4" />
          Sair
        </Button>
      </div>
    </header>
  );
}
