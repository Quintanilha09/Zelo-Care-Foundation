/**
 * Ajustes da família — ZELO (ZELO-24).
 * Por enquanto só a janela de registro retroativo. Só o cuidador
 * principal edita — o servidor é a autoridade real, isso aqui só esconde
 * o controle que o backend rejeitaria de qualquer forma.
 */
import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";

export default function SettingsPage() {
  const { user } = useAuth();
  const isPrimary = user?.caregiver?.role === "primary_caregiver";

  const [hours, setHours] = useState(String(user?.family?.retroactiveWindowHours ?? 24));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.family?.retroactiveWindowHours) setHours(String(user.family.retroactiveWindowHours));
  }, [user?.family?.retroactiveWindowHours]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await authFetch("/api/families/me/settings", {
        method: "PATCH",
        body: JSON.stringify({ retroactiveWindowHours: Number(hours) }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao salvar");
      }
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader />
      <main className="max-w-2xl mx-auto px-5 py-8 space-y-6">
        <div>
          <h2 className="text-2xl font-semibold">Ajustes</h2>
          <p className="text-muted-foreground text-[15px]">Configurações da família.</p>
        </div>

        <form onSubmit={handleSave} className="space-y-4 p-4 rounded-xl border bg-card">
          <div className="space-y-1">
            <Label htmlFor="st-hours">Janela de registro retroativo (horas)</Label>
            <p className="text-sm text-muted-foreground">
              Dentro desse prazo, registrar uma dose passada só pede confirmar o horário. Fora dele, pede uma breve justificativa.
            </p>
          </div>
          <Input
            id="st-hours"
            type="number"
            min={1}
            max={24 * 30}
            value={hours}
            onChange={(e) => { setHours(e.target.value); setSaved(false); }}
            disabled={!isPrimary}
            className="w-32"
          />
          {!isPrimary && <p className="text-sm text-muted-foreground">Só o cuidador principal pode alterar este ajuste.</p>}

          {error && (
            <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>
          )}
          {saved && <p className="text-sm text-zelo-green-fg">Salvo.</p>}

          {isPrimary && (
            <Button type="submit" disabled={saving}>{saving ? "Salvando…" : "Salvar"}</Button>
          )}
        </form>
      </main>
    </div>
  );
}
