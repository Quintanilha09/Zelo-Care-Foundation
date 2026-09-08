/**
 * Troca de família — ZELO.
 *
 * Só aparece pra quem é cuidador em mais de uma família (cuidar da própria
 * mãe E ser cuidadora contratada de outra é o caso real). Pra todo mundo
 * mais — a maioria — não renderiza nada.
 *
 * Sem isto, quem tinha duas famílias entrava numa delas e não tinha como
 * chegar na outra: o familyId vive dentro do token, não na URL.
 *
 * ── Vive dentro do menu da conta — Issue #113 ────────────────────────────
 *
 * Era um `Select` solto no cabeçalho. Passou a ser um submenu do menu do
 * avatar, então **só funciona dentro de um `<DropdownMenuContent>`** — é o
 * `ContaMenu` quem o monta.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { cn } from "@/lib/utils";
import {
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";
import { Users, Check } from "lucide-react";

interface FamilyLink {
  familyId: number;
  name: string;
  role: string;
  isActive: boolean;
}

export function FamilySwitcher() {
  const { switchFamily } = useAuth();
  const [families, setFamilies] = useState<FamilyLink[]>([]);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await authFetch("/api/account/families");
        if (!res.ok) return;
        const data = (await res.json()) as FamilyLink[];
        if (!cancelled) setFamilies(data);
      } catch {
        /* silencioso — o menu funciona sem o seletor */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (families.length < 2) return null;

  const active = families.find((f) => f.isActive);

  const trocar = async (familyId: number) => {
    if (familyId === active?.familyId) return;
    setSwitching(true);
    try {
      // Em caso de sucesso, `switchFamily` recarrega a página inteira — o
      // menu fecha junto e não há mais o que atualizar aqui.
      await switchFamily(familyId);
    } catch {
      setSwitching(false);
    }
  };

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger aria-label="Trocar de família">
        <Users className="mr-2 h-4 w-4" aria-hidden /> Trocar de família
      </DropdownMenuSubTrigger>
      <DropdownMenuSubContent>
        {families.map((f) => (
          <DropdownMenuItem
            key={f.familyId}
            disabled={switching}
            onSelect={() => void trocar(f.familyId)}
          >
            <Check
              className={cn("mr-2 h-4 w-4", f.isActive ? "opacity-100" : "opacity-0")}
              aria-hidden
            />
            <span className="truncate">{f.name}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuSubContent>
    </DropdownMenuSub>
  );
}
