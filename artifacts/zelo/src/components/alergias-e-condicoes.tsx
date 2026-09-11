/**
 * Alergias e condições do paciente — Issue #176.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * É O PRIMEIRO DADO QUE UM PRONTO-SOCORRO PERGUNTA.
 *
 * E o cuidador que chega com o idoso às três da manhã costuma não saber de
 * cor — ainda mais quando não é o cuidador principal. Até 11/09/2026 a ficha
 * do paciente não tinha onde guardar isso: só nome, nascimento, fuso, contato
 * de emergência e um campo de observações.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Registrar não é interpretar ──────────────────────────────────────────
 *
 * O invariante 4 proíbe o app de verificar interação medicamentosa e de
 * opinar. Guardar "alérgica a dipirona" e mostrar para quem cuida não é
 * nenhuma das duas coisas — é a mesma natureza do contato de emergência.
 *
 * **A linha que este arquivo não cruza:** nada aqui olha os medicamentos
 * cadastrados, nada compara, nada avisa. Se um dia alguém quiser um alerta de
 * "este remédio bate com a alergia", isso é verificação de interação, e é
 * proibido.
 *
 * ── Texto livre, e não lista fechada ─────────────────────────────────────
 *
 * "Alérgica a AAS e a esparadrapo" é uma frase de gente. Obrigar a escolher
 * de um catálogo faz perder metade — e a metade perdida é justamente a que
 * ninguém previu.
 */
import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { authFetch } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { ShieldAlert, ChevronRight } from "lucide-react";

export function AlergiasECondicoes({
  patientId,
  allergies,
  conditions,
  somenteLeitura = false,
}: {
  patientId: string;
  allergies: string | null;
  conditions: string | null;
  somenteLeitura?: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [editando, setEditando] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [alergias, setAlergias] = useState(allergies ?? "");
  const [condicoes, setCondicoes] = useState(conditions ?? "");

  const temAlgo = Boolean(allergies?.trim() || conditions?.trim());

  const salvar = async () => {
    setSalvando(true);
    try {
      const res = await authFetch(`/api/patients/${patientId}`, {
        method: "PATCH",
        body: JSON.stringify({
          allergies: alergias.trim() || null,
          conditions: condicoes.trim() || null,
        }),
      });
      if (!res.ok) throw new Error();
      toast({ description: "Salvo." });
      setEditando(false);
      void queryClient.invalidateQueries({ queryKey: ["patient", patientId] });
    } catch {
      toast({ description: "Não deu pra salvar agora.", variant: "destructive" });
    } finally {
      setSalvando(false);
    }
  };

  if (editando) {
    return (
      <div className="rounded-xl border p-4 space-y-4">
        <div className="space-y-2">
          <Label htmlFor="alergias">Alergias</Label>
          <Textarea
            id="alergias"
            value={alergias}
            maxLength={2000}
            rows={2}
            placeholder="Dipirona, esparadrapo…"
            onChange={(e) => setAlergias(e.target.value)}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="condicoes">Condições de saúde</Label>
          <Textarea
            id="condicoes"
            value={condicoes}
            maxLength={2000}
            rows={2}
            placeholder="Diabetes tipo 2, hipertensão…"
            onChange={(e) => setCondicoes(e.target.value)}
          />
          {/* Dizer o que o app NÃO faz com isto é parte da honestidade do
              produto: quem escreve uma alergia aqui pode achar que o app vai
              conferir os remédios. Ele não vai, e nunca vai. */}
          <p className="text-xs text-muted-foreground">
            O ZELO guarda e mostra. Ele não confere remédio nem avisa sobre
            interação — quem faz isso é o médico.
          </p>
        </div>
        <div className="flex gap-2">
          <Button size="sm" disabled={salvando} onClick={() => void salvar()}>
            {salvando ? "Salvando…" : "Salvar"}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setEditando(false)}>Cancelar</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          <h3 className="font-medium flex items-center gap-2">
            <ShieldAlert className="w-4 h-4 text-muted-foreground" aria-hidden /> Alergias e condições
          </h3>
          {temAlgo ? (
            <div className="space-y-1 text-[17px]">
              {allergies?.trim() && (
                <p><span className="text-muted-foreground">Alergias:</span> {allergies}</p>
              )}
              {conditions?.trim() && (
                <p><span className="text-muted-foreground">Condições:</span> {conditions}</p>
              )}
            </div>
          ) : (
            // Sem alarme: não ter isto preenchido não é falha de ninguém, e
            // âmbar aqui faria a ficha parecer um erro a cada abertura.
            <p className="text-sm text-muted-foreground">
              Nada anotado ainda. É o primeiro dado que um pronto-socorro pergunta.
            </p>
          )}
        </div>
        {!somenteLeitura && (
          <Button size="sm" variant="ghost" className="shrink-0" onClick={() => setEditando(true)}>
            {temAlgo ? "Editar" : "Adicionar"}
          </Button>
        )}
      </div>

      {/* A ficha de emergência é o motivo de este dado existir: uma tela para
          MOSTRAR a alguém, não para navegar. */}
      <Link href={`/pacientes/${patientId}/emergencia`} asChild>
        <a className="flex items-center justify-between gap-2 text-sm text-muted-foreground hover:text-foreground">
          Ver ficha de emergência
          <ChevronRight className="w-4 h-4" />
        </a>
      </Link>
    </div>
  );
}
