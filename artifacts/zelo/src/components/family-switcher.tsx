/**
 * Troca de família — ZELO.
 *
 * Só aparece pra quem é cuidador em mais de uma família (cuidar da própria
 * mãe E ser cuidadora contratada de outra é o caso real). Pra todo mundo
 * mais — a maioria — não renderiza nada, e o cabeçalho fica igual ao que
 * sempre foi.
 *
 * Sem isto, quem tinha duas famílias entrava numa delas e não tinha como
 * chegar na outra: o familyId vive dentro do token, não na URL.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";

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
      } catch { /* silencioso — o cabeçalho funciona sem o seletor */ }
    })();
    return () => { cancelled = true; };
  }, []);

  if (families.length < 2) return null;

  const active = families.find((f) => f.isActive);

  const handleChange = async (value: string) => {
    const familyId = Number(value);
    if (familyId === active?.familyId) return;
    setSwitching(true);
    try {
      await switchFamily(familyId);
    } catch {
      setSwitching(false);
    }
  };

  return (
    <Select value={String(active?.familyId ?? "")} onValueChange={(v) => void handleChange(v)} disabled={switching}>
      <SelectTrigger className="h-8 w-auto max-w-44 text-sm" aria-label="Trocar de família">
        <SelectValue placeholder="Família" />
      </SelectTrigger>
      <SelectContent>
        {families.map((f) => (
          <SelectItem key={f.familyId} value={String(f.familyId)}>{f.name}</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
