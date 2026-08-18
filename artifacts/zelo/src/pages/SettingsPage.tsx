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
import { Switch } from "@/components/ui/switch";
import { PushDiagnostics } from "@/components/push-diagnostics";

export default function SettingsPage() {
  const { user } = useAuth();
  const isPrimary = user?.caregiver?.role === "primary_caregiver";

  const [hours, setHours] = useState(String(user?.family?.retroactiveWindowHours ?? 24));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const [showMedication, setShowMedication] = useState(user?.family?.showMedicationInPush ?? false);
  const [savingMedicationToggle, setSavingMedicationToggle] = useState(false);

  // ZELO-30: silêncio noturno — só afeta o nível 2 (transmissão pra todos)
  // de tratamentos "padrão"; o cuidador principal continua avisado sempre,
  // e um tratamento "crítico" ignora esta janela de propósito.
  const [quietHoursEnabled, setQuietHoursEnabled] = useState(user?.family?.quietHoursEnabled ?? true);
  const [quietHoursStart, setQuietHoursStart] = useState(user?.family?.quietHoursStart ?? "22:00");
  const [quietHoursEnd, setQuietHoursEnd] = useState(user?.family?.quietHoursEnd ?? "07:00");
  const [savingQuietHoursToggle, setSavingQuietHoursToggle] = useState(false);
  const [savingQuietHoursWindow, setSavingQuietHoursWindow] = useState(false);
  const [quietHoursSaved, setQuietHoursSaved] = useState(false);
  const [quietHoursError, setQuietHoursError] = useState("");

  useEffect(() => {
    if (user?.family?.retroactiveWindowHours) setHours(String(user.family.retroactiveWindowHours));
  }, [user?.family?.retroactiveWindowHours]);

  useEffect(() => {
    setShowMedication(user?.family?.showMedicationInPush ?? false);
  }, [user?.family?.showMedicationInPush]);

  useEffect(() => {
    setQuietHoursEnabled(user?.family?.quietHoursEnabled ?? true);
    setQuietHoursStart(user?.family?.quietHoursStart ?? "22:00");
    setQuietHoursEnd(user?.family?.quietHoursEnd ?? "07:00");
  }, [user?.family?.quietHoursEnabled, user?.family?.quietHoursStart, user?.family?.quietHoursEnd]);

  const handleToggleShowMedication = async (checked: boolean) => {
    setShowMedication(checked); // otimista — é um ajuste de baixo risco, sem consequência se a rede demorar
    setSavingMedicationToggle(true);
    const res = await authFetch("/api/families/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ showMedicationInPush: checked }),
    });
    setSavingMedicationToggle(false);
    if (!res.ok) setShowMedication(!checked); // reverte se o servidor recusou
  };

  const handleToggleQuietHours = async (checked: boolean) => {
    setQuietHoursEnabled(checked);
    setSavingQuietHoursToggle(true);
    const res = await authFetch("/api/families/me/settings", {
      method: "PATCH",
      body: JSON.stringify({ quietHoursEnabled: checked }),
    });
    setSavingQuietHoursToggle(false);
    if (!res.ok) setQuietHoursEnabled(!checked);
  };

  const handleSaveQuietHoursWindow = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingQuietHoursWindow(true);
    setQuietHoursError("");
    setQuietHoursSaved(false);
    try {
      const res = await authFetch("/api/families/me/settings", {
        method: "PATCH",
        body: JSON.stringify({ quietHoursStart, quietHoursEnd }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string };
        throw new Error(data.error ?? "Erro ao salvar");
      }
      setQuietHoursSaved(true);
    } catch (err) {
      setQuietHoursError(err instanceof Error ? err.message : "Erro");
    } finally {
      setSavingQuietHoursWindow(false);
    }
  };

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

        <div className="p-4 rounded-xl border bg-card space-y-3">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="st-show-med" className="text-[15px] font-normal">Exibir o medicamento na notificação</Label>
              <p className="text-sm text-muted-foreground">
                Desligado por padrão: a notificação diz só "está na hora do remédio", nunca o nome — qualquer pessoa perto do celular veria um dado de saúde na tela de bloqueio.
              </p>
            </div>
            <Switch
              id="st-show-med"
              checked={showMedication}
              onCheckedChange={(checked) => void handleToggleShowMedication(checked)}
              disabled={!isPrimary || savingMedicationToggle}
            />
          </div>
          {!isPrimary && <p className="text-sm text-muted-foreground">Só o cuidador principal pode alterar este ajuste.</p>}
        </div>

        <div className="p-4 rounded-xl border bg-card space-y-4">
          <div className="flex items-center justify-between gap-4">
            <div className="space-y-1">
              <Label htmlFor="st-quiet-hours" className="text-[15px] font-normal">Silêncio noturno</Label>
              <p className="text-sm text-muted-foreground">
                Nesse período, uma dose sem registro não chama os outros cuidadores (a não ser que o tratamento esteja marcado como "crítico") — só o cuidador principal continua avisado.
              </p>
            </div>
            <Switch
              id="st-quiet-hours"
              checked={quietHoursEnabled}
              onCheckedChange={(checked) => void handleToggleQuietHours(checked)}
              disabled={!isPrimary || savingQuietHoursToggle}
            />
          </div>

          {quietHoursEnabled && (
            <form onSubmit={handleSaveQuietHoursWindow} className="flex items-end gap-3 flex-wrap">
              <div className="space-y-1">
                <Label htmlFor="st-quiet-start" className="text-sm">Início</Label>
                <Input
                  id="st-quiet-start"
                  type="time"
                  value={quietHoursStart}
                  onChange={(e) => { setQuietHoursStart(e.target.value); setQuietHoursSaved(false); }}
                  disabled={!isPrimary}
                  className="w-28"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="st-quiet-end" className="text-sm">Fim</Label>
                <Input
                  id="st-quiet-end"
                  type="time"
                  value={quietHoursEnd}
                  onChange={(e) => { setQuietHoursEnd(e.target.value); setQuietHoursSaved(false); }}
                  disabled={!isPrimary}
                  className="w-28"
                />
              </div>
              {isPrimary && (
                <Button type="submit" variant="secondary" disabled={savingQuietHoursWindow}>
                  {savingQuietHoursWindow ? "Salvando…" : "Salvar horário"}
                </Button>
              )}
            </form>
          )}

          {quietHoursError && <Alert variant="destructive"><AlertDescription>{quietHoursError}</AlertDescription></Alert>}
          {quietHoursSaved && <p className="text-sm text-zelo-green-fg">Salvo.</p>}
          {!isPrimary && <p className="text-sm text-muted-foreground">Só o cuidador principal pode alterar este ajuste.</p>}
        </div>

        <PushDiagnostics />
      </main>
    </div>
  );
}
