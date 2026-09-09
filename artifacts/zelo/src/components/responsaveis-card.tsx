/**
 * Quem é responsável por este paciente — Issue #120.
 *
 * ── O que esta seção NÃO diz, e é regra ───────────────────────────────────
 *
 * Ela **não** diz quem pode ver o paciente. Todo cuidador da família continua
 * vendo e registrando dose de todo paciente dela, exatamente como antes — o
 * vínculo é informativo.
 *
 * Isso está escrito na tela, e não só aqui: sem dizer, alguém vincula uma
 * pessoa e supõe que acabou de tirar o acesso das outras. Supor errado sobre
 * quem tem acesso a dado de saúde é o tipo de engano que não pode acontecer
 * em silêncio.
 *
 * ── Para que serve, então ─────────────────────────────────────────────────
 *
 * Para responder *"quem é o responsável?"* numa família com mais de um
 * paciente — o exemplo do próprio spec, pai e mãe na mesma conta. E é o que
 * a #122 vai usar para achar paciente descoberto.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { useAuth } from "@/context/AuthContext";
import { Button } from "@/components/ui/button";
import { CaregiverBadge } from "@/components/caregiver-badge";
import {
  Select, SelectTrigger, SelectValue, SelectContent, SelectItem,
} from "@/components/ui/select";
import { AreaCarregando, Esqueleto } from "@/components/esqueleto";
import { UserCheck, X } from "lucide-react";
import { useState } from "react";

interface Responsavel {
  id: number;
  name: string;
  role: string;
  vinculadoEm: string;
}

interface CuidadorDaFamilia {
  id: number;
  name: string;
  role: string;
}

export function ResponsaveisCard({ patientId }: { patientId: number }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const ehPrincipal = user?.caregiver?.role === "primary_caregiver";
  const [vinculando, setVinculando] = useState(false);

  const chave = ["responsaveis", patientId];

  const { data: responsaveis, isLoading } = useQuery({
    queryKey: chave,
    queryFn: async (): Promise<Responsavel[]> => {
      const res = await authFetch(`/api/patients/${patientId}/caregivers`);
      if (!res.ok) return [];
      return res.json();
    },
  });

  // Só o principal vincula, então só ele precisa da lista da família.
  const { data: daFamilia } = useQuery({
    queryKey: ["caregivers"],
    queryFn: async (): Promise<CuidadorDaFamilia[]> => {
      const res = await authFetch("/api/caregivers");
      if (!res.ok) return [];
      return res.json();
    },
    enabled: ehPrincipal,
  });

  const recarregar = () => queryClient.invalidateQueries({ queryKey: chave });

  const vincular = async (caregiverId: number) => {
    setVinculando(true);
    try {
      await authFetch(`/api/patients/${patientId}/caregivers`, {
        method: "POST",
        body: JSON.stringify({ caregiverId }),
      });
      await recarregar();
    } finally {
      setVinculando(false);
    }
  };

  const desvincular = async (caregiverId: number) => {
    await authFetch(`/api/patients/${patientId}/caregivers/${caregiverId}`, { method: "DELETE" });
    await recarregar();
  };

  const jaVinculados = new Set((responsaveis ?? []).map((r) => r.id));
  const disponiveis = (daFamilia ?? []).filter((c) => !jaVinculados.has(c.id));

  return (
    <div className="p-4 rounded-xl border space-y-4" role="region" aria-label="Quem é responsável">
      <div className="flex items-center gap-2">
        <UserCheck className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden />
        <p className="font-medium">Quem é responsável</p>
      </div>

      {isLoading ? (
        <AreaCarregando rotulo="Carregando os responsáveis">
          <div className="space-y-2">
            <Esqueleto className="h-9 w-full" />
          </div>
        </AreaCarregando>
      ) : (responsaveis ?? []).length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Ninguém foi indicado como responsável por esta pessoa ainda.
        </p>
      ) : (
        <ul className="space-y-2">
          {(responsaveis ?? []).map((r) => (
            <li
              key={r.id}
              className="flex items-center justify-between gap-3 rounded-lg border bg-card p-3"
            >
              <div className="min-w-0">
                <p className="truncate text-[16px]" title={r.name}>{r.name}</p>
                <div className="mt-0.5"><CaregiverBadge role={r.role as never} /></div>
              </div>
              {ehPrincipal && (
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => void desvincular(r.id)}
                  aria-label={`Tirar ${r.name} da responsabilidade por este paciente`}
                >
                  <X className="w-4 h-4 text-muted-foreground" />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {ehPrincipal && disponiveis.length > 0 && (
        <Select
          value=""
          disabled={vinculando}
          onValueChange={(v) => void vincular(Number(v))}
        >
          <SelectTrigger className="h-9 max-w-xs text-sm" aria-label="Indicar responsável">
            <SelectValue placeholder={vinculando ? "Vinculando…" : "Indicar alguém"} />
          </SelectTrigger>
          <SelectContent>
            {disponiveis.map((c) => (
              <SelectItem key={c.id} value={String(c.id)}>{c.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      )}

      {/* Dito na tela, e não só no código: sem isto, alguém vincula uma pessoa
          e supõe que tirou o acesso das outras. Supor errado sobre quem
          alcança dado de saúde não pode acontecer em silêncio. */}
      <p className="text-xs text-muted-foreground">
        Isto diz quem responde por esta pessoa. <strong>Não muda quem enxerga</strong> —
        toda a família continua vendo e registrando dose, como antes.
      </p>
    </div>
  );
}
