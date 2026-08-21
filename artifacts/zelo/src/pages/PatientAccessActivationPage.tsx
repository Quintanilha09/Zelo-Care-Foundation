/**
 * Ativação do acesso do paciente — ZELO-58.
 *
 * Primeira (e única) tela que o paciente vê antes do modo idoso. Aberta a
 * partir do link que o cuidador mandou, NO APARELHO DELE.
 *
 * Escrita com a mesma régua do modo idoso: letra grande, um botão só,
 * nenhum jargão. Quem está lendo isto pode ter 80 anos e não saber o que é
 * "token", "ativar dispositivo" ou "conta" — e não precisa saber.
 */
import { useState } from "react";
import { savePatientAccess } from "@/lib/patient-access";
import { Check, AlertCircle } from "lucide-react";

export default function PatientAccessActivationPage() {
  const [activating, setActivating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const token = new URLSearchParams(window.location.search).get("token");

  const handleActivate = async () => {
    if (!token || activating) return;
    setActivating(true);
    setError(null);
    try {
      const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${BASE}/api/patient-access/activate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Não foi possível ativar. Peça um novo link para quem cuida de você.");
        return;
      }
      const data = (await res.json()) as { accessToken: string; patientName: string };
      savePatientAccess(data.accessToken, data.patientName);
      // Recarrega de verdade: o gate em App.tsx precisa reavaliar do zero.
      window.location.replace(import.meta.env.BASE_URL || "/");
    } catch {
      setError("Sem conexão agora. Tente de novo em instantes.");
    } finally {
      setActivating(false);
    }
  };

  if (!token) {
    return (
      <div className="min-h-screen bg-[#F8F7F5] flex flex-col items-center justify-center px-6 py-10 text-center">
        <AlertCircle className="w-14 h-14 text-zelo-amber-fg mb-4" />
        <p className="text-2xl text-[#2D2D2B]">Este link está incompleto.</p>
        <p className="text-xl text-[#6B6B6B] mt-2">Peça um novo para quem cuida de você.</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8F7F5] flex flex-col items-center justify-center px-6 py-10 text-center" translate="no">
      <div className="w-full max-w-md space-y-8">
        <div className="space-y-3">
          <div className="w-20 h-20 mx-auto rounded-full bg-zelo-green-bg flex items-center justify-center">
            <Check className="w-12 h-12 text-zelo-green-fg" strokeWidth={3} />
          </div>
          <p className="text-3xl font-bold text-[#2D2D2B] leading-tight">
            Este celular vai te lembrar dos seus remédios
          </p>
          <p className="text-xl text-[#6B6B6B]">
            É só tocar no botão abaixo. Você não precisa criar senha nem preencher nada.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void handleActivate()}
          disabled={activating}
          className="w-full min-h-24 rounded-3xl bg-zelo-green text-white text-3xl font-bold shadow-lg active:scale-[0.98] transition-transform disabled:opacity-70"
        >
          {activating ? "Ativando…" : "Ativar neste celular"}
        </button>

        {error && (
          <div className="rounded-2xl bg-zelo-amber-bg border border-zelo-amber/30 px-5 py-4">
            <p className="text-xl text-zelo-amber-fg leading-snug">{error}</p>
          </div>
        )}
      </div>
    </div>
  );
}
