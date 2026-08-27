/**
 * Preferências de notificação por paciente — ZELO (ZELO-26).
 * Padrão é tudo ativado — só existe estado quando o cuidador desliga algo.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Bell } from "lucide-react";

type Category = "dose" | "appointment" | "stock" | "treatment" | "moment";
interface Preference { category: Category; enabled: boolean }

const LABELS: Record<Category, string> = {
  dose: "Lembretes de dose",
  appointment: "Lembretes de consulta",
  stock: "Estoque baixo",
  treatment: "Avisos de tratamento",
  // QUI-10. Por último de propósito: as quatro de cima existem para nada
  // passar batido no cuidado. Esta existe para a família não perder uma foto,
  // e é a única que dá para desligar sem abrir mão de nada clínico.
  moment: "Momentos novos",
};

const ORDER: Category[] = ["dose", "appointment", "stock", "treatment", "moment"];

async function fetchPreferences(patientId: number): Promise<Preference[]> {
  const res = await authFetch(`/api/patients/${patientId}/notification-preferences`);
  if (!res.ok) throw new Error("Erro ao carregar preferências");
  const data = (await res.json()) as { preferences: Preference[] };
  return data.preferences;
}

export function NotificationPreferencesCard({ patientId }: { patientId: number }) {
  const queryClient = useQueryClient();
  const queryKey = ["notification-preferences", patientId];
  const { data } = useQuery({ queryKey, queryFn: () => fetchPreferences(patientId) });

  const handleToggle = async (category: Category, enabled: boolean) => {
    // Otimista — o painel é de baixo risco (nunca bloqueia dose nem registro).
    queryClient.setQueryData<Preference[]>(queryKey, (prev) =>
      (prev ?? []).map((p) => (p.category === category ? { ...p, enabled } : p))
    );
    const res = await authFetch(`/api/patients/${patientId}/notification-preferences`, {
      method: "PATCH",
      body: JSON.stringify({ category, enabled }),
    });
    if (!res.ok) void queryClient.invalidateQueries({ queryKey });
  };

  if (!data) return null;
  const byCategory = new Map(data.map((p) => [p.category, p.enabled]));

  return (
    <div className="p-4 rounded-xl border bg-card space-y-3">
      <div className="flex items-center gap-2">
        <Bell className="w-4 h-4 text-muted-foreground" />
        <h3 className="text-sm font-medium">Notificações para este paciente</h3>
      </div>
      <div className="space-y-2.5">
        {ORDER.map((category) => (
          <div key={category} className="flex items-center justify-between">
            <Label htmlFor={`notif-${category}`} className="text-[17px] font-normal">
              {LABELS[category]}
            </Label>
            <Switch
              id={`notif-${category}`}
              checked={byCategory.get(category) ?? true}
              onCheckedChange={(checked) => void handleToggle(category, checked)}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
