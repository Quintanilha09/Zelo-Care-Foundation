/**
 * Ajustes — Registro retroativo — ZELO (ZELO-24).
 *
 * O controle de horas era um <input type="number"> com as setinhas nativas
 * do navegador — "arcaico" no relato do fundador, ruim em toque. Trocado
 * por uma lista de opções comuns (Select), igual o resto do app já usa em
 * todo outro lugar de "escolher uma entre poucas opções".
 */
import { useEffect, useState } from "react";
import { Link } from "wouter";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { AppHeader } from "@/components/app-header";
import { Label } from "@/components/ui/label";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { ArrowLeft } from "lucide-react";

// Opções comuns em vez de digitar um número qualquer — cobre desde "só até
// mais tarde hoje" (1h) até "a semana inteira" (168h), com 24h (padrão) no
// meio. O servidor continua sendo a autoridade real do limite (1–720h).
const HOUR_OPTIONS = [1, 2, 4, 6, 12, 24, 48, 72, 168];

function labelForHours(h: number): string {
  if (h < 24) return `${h} hora${h === 1 ? "" : "s"}`;
  const days = h / 24;
  if (Number.isInteger(days)) return `${days} dia${days === 1 ? "" : "s"} (${h}h)`;
  return `${h} horas`;
}

export default function SettingsRetroactivePage() {
  const { user } = useAuth();
  const isPrimary = user?.caregiver?.role === "primary_caregiver";

  const [hours, setHours] = useState(String(user?.family?.retroactiveWindowHours ?? 24));
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (user?.family?.retroactiveWindowHours) setHours(String(user.family.retroactiveWindowHours));
  }, [user?.family?.retroactiveWindowHours]);

  // O valor salvo pode não bater com nenhuma opção comum (ajustado antes
  // desta tela existir, ou por outra sessão) — inclui na lista pra não
  // "perder" a seleção atual do cuidador.
  const options = HOUR_OPTIONS.includes(Number(hours)) ? HOUR_OPTIONS : [...HOUR_OPTIONS, Number(hours)].sort((a, b) => a - b);

  const handleSave = async (value: string) => {
    setHours(value);
    setSaving(true);
    setError("");
    setSaved(false);
    try {
      const res = await authFetch("/api/families/me/settings", {
        method: "PATCH",
        body: JSON.stringify({ retroactiveWindowHours: Number(value) }),
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
        <Link href="/ajustes">
          <a className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="w-4 h-4" /> Ajustes
          </a>
        </Link>

        <div>
          <h2 className="text-2xl font-semibold">Registro retroativo</h2>
        </div>

        <div className="space-y-4 p-4 rounded-xl border bg-card">
          <div className="space-y-1">
            <Label htmlFor="st-hours">Janela de registro retroativo</Label>
            <p className="text-sm text-muted-foreground">
              Dentro desse prazo, registrar uma dose passada só pede confirmar o horário. Fora dele, pede uma breve justificativa.
            </p>
          </div>
          <Select value={hours} onValueChange={(v) => void handleSave(v)} disabled={!isPrimary || saving}>
            <SelectTrigger id="st-hours" className="w-56"><SelectValue /></SelectTrigger>
            <SelectContent>
              {options.map((h) => (
                <SelectItem key={h} value={String(h)}>{labelForHours(h)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!isPrimary && <p className="text-sm text-muted-foreground">Só o cuidador principal pode alterar este ajuste.</p>}

          {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
          {saved && !error && <p className="text-sm text-zelo-green-fg">Salvo.</p>}
        </div>
      </main>
    </div>
  );
}
