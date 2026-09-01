/**
 * Enviar acesso para o paciente e gerir os aparelhos — ZELO-58.
 *
 * Reaproveita o padrão do convite de cuidador (link copiável + atalho de
 * WhatsApp), que já é conhecido no produto e não exige dependência nova
 * pra QR code.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { Copy, Check, MessageCircle, Send, X, Smartphone } from "lucide-react";

interface AccessDevice {
  id: number;
  status: "pending" | "active" | "revoked";
  deviceLabel: string | null;
  activatedAt: string | null;
  lastUsedAt: string | null;
}

async function fetchDevices(patientId: number): Promise<AccessDevice[]> {
  const res = await authFetch(`/api/patients/${patientId}/access`);
  if (!res.ok) return [];
  return res.json();
}

function relativeDay(iso: string | null): string {
  if (!iso) return "";
  const days = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (days <= 0) return "hoje";
  if (days === 1) return "ontem";
  return `há ${days} dias`;
}

export function PatientAccessCard({ patientId, patientName }: { patientId: number; patientName: string }) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [link, setLink] = useState("");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);

  const { data: devices } = useQuery({
    queryKey: ["patient-access", patientId],
    queryFn: () => fetchDevices(patientId),
  });

  const activeDevices = (devices ?? []).filter((d) => d.status === "active");

  const handleGenerate = async () => {
    setGenerating(true);
    setError("");
    try {
      const res = await authFetch(`/api/patients/${patientId}/access-link`, { method: "POST" });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error ?? "Não foi possível gerar o link.");
        return;
      }
      const data = (await res.json()) as { activationPath: string };
      setLink(`${window.location.origin}${data.activationPath}`);
      void queryClient.invalidateQueries({ queryKey: ["patient-access", patientId] });
    } catch {
      setError("Sem conexão agora. Tente de novo.");
    } finally {
      setGenerating(false);
    }
  };

  const handleRevoke = async (accessId: number) => {
    const res = await authFetch(`/api/patients/${patientId}/access/${accessId}`, { method: "DELETE" });
    if (res.ok) {
      toast({ description: "Acesso removido. O aparelho para de funcionar na hora." });
      void queryClient.invalidateQueries({ queryKey: ["patient-access", patientId] });
    }
  };

  const whatsappText = `Oi! Instalei um lembrete de remédio pra você. É só abrir este link no seu celular: ${link}`;

  return (
    <div className="space-y-3">
      {!link ? (
        <Button variant="outline" size="sm" className="gap-2" onClick={() => void handleGenerate()} disabled={generating}>
          <Send className="w-3.5 h-3.5" />
          {/* Rotulo ESTATICO. Interpolar o nome aqui estourava a caixa com
              nome longo (Issue #55), e nao acrescentava nada: o bloco que
              envolve este botao ja diz "No celular de {nome}" e "{nome} abre
              no proprio celular" nas duas linhas imediatamente acima. */}
          {generating ? "Gerando…" : "Enviar acesso"}
        </Button>
      ) : (
        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            Mande este link para {patientName} abrir <strong>no celular dela</strong>. Vale por 24 horas e só pode ser usado uma vez.
          </p>
          <div className="flex gap-2">
            <Input readOnly value={link} className="text-xs" onFocus={(e) => e.currentTarget.select()} />
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                void navigator.clipboard.writeText(link);
                setCopied(true);
                toast({ description: "Link copiado" });
                setTimeout(() => setCopied(false), 2000);
              }}
            >
              {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            </Button>
          </div>
          <a
            href={`https://wa.me/?text=${encodeURIComponent(whatsappText)}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-xs text-zelo-green-fg"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Enviar pelo WhatsApp
          </a>
        </div>
      )}

      {error && <Alert variant="destructive"><AlertDescription className="text-xs">{error}</AlertDescription></Alert>}

      {activeDevices.length > 0 && (
        <div className="space-y-1.5 pt-1">
          <p className="text-xs font-medium text-muted-foreground">Aparelhos de {patientName}</p>
          {activeDevices.map((d) => (
            <div key={d.id} className="flex items-center gap-2 text-xs">
              <Smartphone className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="flex-1 truncate">
                {d.deviceLabel ?? "Aparelho"}
                {d.lastUsedAt && <span className="text-muted-foreground"> · usado {relativeDay(d.lastUsedAt)}</span>}
              </span>
              <button
                type="button"
                className="text-destructive inline-flex items-center gap-1"
                onClick={() => void handleRevoke(d.id)}
              >
                <X className="w-3 h-3" /> Remover
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
