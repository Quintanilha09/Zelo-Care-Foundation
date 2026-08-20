/**
 * Formulário de cadastro de paciente — ZELO.
 *
 * O consentimento de dado de saúde é capturado AQUI, inline, específico
 * deste paciente — não é mais um passo separado de conta (ver correção
 * registrada em planning/phases/03-.../03-CONTEXT.md). Cada paciente tem
 * seu próprio consentimento, distinguindo titular de representante legal.
 */
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { authFetch } from "@/lib/auth-client";

interface PatientFormProps {
  onCreated: () => void;
  onCancel: () => void;
  /** ZELO-38/paywall: quando o limite de plano bloqueia, o PAI decide como
   *  mostrar isso (dialog quente, "Cuidar junto é melhor") — mesmo padrão
   *  já usado no convite de cuidador (CaregiversPage), pra não ter um
   *  título de dialog ("Cadastrar paciente") descolado do conteúdo. */
  onPaywall: (message: string) => void;
}

export function PatientForm({ onCreated, onCancel, onPaywall }: PatientFormProps) {
  const [name, setName] = useState("");
  const [birthDate, setBirthDate] = useState("");
  const [timezone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [notes, setNotes] = useState("");
  const [givenBy, setGivenBy] = useState<"self" | "legal_representative">("legal_representative");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setLoading(true);
    setError("");
    try {
      const res = await authFetch("/api/patients", {
        method: "POST",
        body: JSON.stringify({
          name: name.trim(),
          birthDate: birthDate || undefined,
          timezone,
          notes: notes.trim() || undefined,
          healthConsent: { givenBy, version: "v1.0" },
        }),
      });
      if (!res.ok) {
        const data = (await res.json()) as { error?: string; code?: string };
        // ZELO-38 pedia só a mensagem; agora o momento do limite também
        // aponta pra um lugar concreto de ver os planos, não só avisa.
        if (data.code === "PLAN_LIMIT") {
          onPaywall(data.error ?? "O plano gratuito cuida de 1 paciente. O plano Família libera até 5.");
          return;
        }
        throw new Error(data.error ?? "Erro ao cadastrar paciente");
      }
      onCreated();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro");
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <Label htmlFor="patient-name">Nome</Label>
        <Input
          id="patient-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Nome de quem você cuida"
          required
          autoFocus
        />
      </div>

      <div className="space-y-2">
        <Label htmlFor="patient-birth">Data de nascimento (opcional)</Label>
        <Input id="patient-birth" type="date" value={birthDate} onChange={(e) => setBirthDate(e.target.value)} />
      </div>

      <p className="text-sm text-muted-foreground">
        O horário do remédio vai seguir o fuso <strong>{timezone}</strong> — o relógio de onde{" "}
        {name || "a pessoa"} mora.
      </p>

      <div className="space-y-2">
        <Label htmlFor="patient-notes">Observações (opcional)</Label>
        <Textarea
          id="patient-notes"
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="Não é prontuário — evite diagnóstico aqui."
          rows={2}
        />
      </div>

      <div className="space-y-3 rounded-lg border p-4 bg-muted/30">
        <Label className="text-sm font-medium">Quem está consentindo com o tratamento de dados de saúde?</Label>
        <RadioGroup value={givenBy} onValueChange={(v) => setGivenBy(v as typeof givenBy)} className="space-y-2">
          <div className="flex items-start gap-3">
            <RadioGroupItem value="legal_representative" id="pf-rep" className="mt-0.5" />
            <Label htmlFor="pf-rep" className="cursor-pointer font-normal leading-snug">
              Sou representante legal — {name || "a pessoa"} não decide mais sozinha.
            </Label>
          </div>
          <div className="flex items-start gap-3">
            <RadioGroupItem value="self" id="pf-self" className="mt-0.5" />
            <Label htmlFor="pf-self" className="cursor-pointer font-normal leading-snug">
              Sou o próprio titular — estou gerenciando meus próprios dados.
            </Label>
          </div>
        </RadioGroup>
      </div>

      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="flex gap-3 justify-end pt-2">
        <Button type="button" variant="secondary" onClick={onCancel} disabled={loading}>
          Cancelar
        </Button>
        <Button type="submit" disabled={loading || !name.trim()}>
          {loading ? "Cadastrando…" : "Cadastrar paciente"}
        </Button>
      </div>
    </form>
  );
}
