import { useEffect, useState } from "react";
import { authFetch } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Alert, AlertDescription } from "@/components/ui/alert";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";

/**
 * Corrigir um registro de dose — Issue #136.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * CORRIGIR NÃO É APAGAR.
 *
 * A palavra "apagar" não aparece nesta tela, e é de propósito. Até 60 s
 * depois de registrar existe o **desfazer** (#135), que apaga a linha —
 * o toque errado ainda é o "agora" da pessoa. Passado o prazo, um registro
 * de dose é registro clínico: o que se faz é **emendar deixando rastro**.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O tom ─────────────────────────────────────────────────────────────────
 *
 * Nada aqui pergunta por que a pessoa errou. A justificativa é **opcional**,
 * e só vira obrigatória quando o horário sai da janela retroativa da família
 * — exatamente a mesma regra do registro normal. O cuidador não é suspeito
 * (invariante 4).
 */

export interface DoseParaCorrigir {
  recordId: number;
  medicationName: string;
  /** O desfecho de agora, para o formulário abrir no estado real. */
  outcome: "taken" | "skipped";
  /** ISO do `takenAt` atual. */
  registeredAt: string | null;
}

/** "YYYY-MM-DDTHH:mm" no fuso local do navegador, que é o que o input pede. */
function paraCampoDeHorario(iso: string | null): string {
  const d = iso ? new Date(iso) : new Date();
  if (Number.isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CorrigirDose({
  patientId,
  dose,
  onFechar,
  onCorrigido,
}: {
  patientId: string;
  /** `null` fecha o diálogo. */
  dose: DoseParaCorrigir | null;
  onFechar: () => void;
  onCorrigido: () => void;
}) {
  const [desfecho, setDesfecho] = useState<"taken" | "skipped">("taken");
  const [horario, setHorario] = useState("");
  const [motivo, setMotivo] = useState("");
  const [precisaDeMotivo, setPrecisaDeMotivo] = useState(false);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  /**
   * Issue #136 — a pergunta de antecipacao, quando o servidor pede.
   *
   * Guarda a MENSAGEM que veio dele (com o horario dentro), e nao um
   * booleano: quem escreve a frase e quem conhece a regra.
   */
  const [perguntaDeAntecipacao, setPerguntaDeAntecipacao] = useState("");

  // Abrir no estado REAL do registro: um formulário que abre em branco faz a
  // pessoa reconstruir de memória o que ela veio consertar.
  useEffect(() => {
    if (!dose) return;
    setDesfecho(dose.outcome);
    setHorario(paraCampoDeHorario(dose.registeredAt));
    setMotivo("");
    setPrecisaDeMotivo(false);
    setErro("");
    setPerguntaDeAntecipacao("");
  }, [dose]);

  const salvar = async (confirmarAntecipacao = false) => {
    if (!dose) return;
    setSalvando(true);
    setErro("");
    try {
      const res = await authFetch(`/api/patients/${patientId}/dose-records/${dose.recordId}`, {
        method: "PATCH",
        body: JSON.stringify({
          outcome: desfecho,
          // `datetime-local` não tem fuso; `new Date` o lê no fuso do
          // navegador, que é onde a pessoa digitou. O servidor recebe o
          // instante absoluto e não precisa adivinhar nada.
          takenAt: horario ? new Date(horario).toISOString() : undefined,
          justification: motivo.trim() || undefined,
          ...(confirmarAntecipacao ? { confirmarAntecipacao: true } : {}),
        }),
      });

      if (!res.ok) {
        const corpo = (await res.json().catch(() => ({}))) as { error?: string; code?: string };

        /**
         * ── O eixo da ANTECIPAÇÃO também vale ao corrigir — Issue #136 ────
         *
         * Corrigir revalida as mesmas regras de tempo do registro original,
         * e uma delas é a janela de antecipação da #134. Corrigir hoje de
         * manhã o registro de uma dose agendada para as 23:59 cai nela — o
         * que é certo: o servidor não tem como saber se a pessoa quis mesmo
         * dizer que já deu o remédio da noite.
         *
         * **Isto faltava, e o CI achou.** O parâmetro `confirmarAntecipacao`
         * existia nesta função desde o começo e nada o acionava: a tela
         * mostrava o erro e ficava parada, com o diálogo aberto e sem saída.
         * Quem corrigisse uma dose futura não conseguia salvar de jeito
         * nenhum.
         *
         * A resposta é a mesma do registro: perguntar uma vez, com o horário
         * na frente, e reenviar. Nunca bloquear — corrigir um registro de
         * dose não pode ser impossível.
         */
        if (corpo.code === "ANTECIPACAO_REQUERIDA") {
          setPerguntaDeAntecipacao(corpo.error ?? "Esta dose é de mais tarde.");
          return;
        }
        // O servidor pede a justificativa quando o horário sai da janela da
        // família. A tela não conhece essa janela — ela reage ao pedido.
        if (corpo.code === "JUSTIFICATION_REQUIRED") setPrecisaDeMotivo(true);
        setErro(corpo.error ?? "Não conseguimos corrigir agora.");
        return;
      }

      onCorrigido();
    } catch {
      setErro("Sem conexão agora. Tente de novo em instantes.");
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Dialog open={dose !== null} onOpenChange={(aberto) => { if (!aberto && !salvando) onFechar(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Corrigir o registro</DialogTitle>
          <DialogDescription>
            {dose?.medicationName}. O registro original não é apagado — fica
            guardado que houve uma correção, e quem fez.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2">
          <Label>O que aconteceu de verdade</Label>
          {/* Dois botões, e não uma lista: são dois estados possíveis, e uma
              lista de dois itens é mais toque para a mesma decisão. */}
          <div className="flex gap-2">
            <Button
              type="button"
              variant={desfecho === "taken" ? "default" : "outline"}
              className="flex-1"
              aria-pressed={desfecho === "taken"}
              onClick={() => setDesfecho("taken")}
            >
              Tomou
            </Button>
            <Button
              type="button"
              variant={desfecho === "skipped" ? "default" : "outline"}
              className="flex-1"
              aria-pressed={desfecho === "skipped"}
              onClick={() => setDesfecho("skipped")}
            >
              Pulou
            </Button>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="corrigir-horario">A que horas</Label>
          <Input
            id="corrigir-horario"
            type="datetime-local"
            value={horario}
            onChange={(e) => setHorario(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            É este horário que vai para o relatório do médico.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="corrigir-motivo">
            Motivo {precisaDeMotivo ? "" : <span className="text-muted-foreground">(opcional)</span>}
          </Label>
          <Textarea
            id="corrigir-motivo"
            value={motivo}
            maxLength={500}
            rows={2}
            placeholder="Se quiser, diga o que houve"
            onChange={(e) => setMotivo(e.target.value)}
          />
        </div>

        {erro && (
          <Alert variant="destructive">
            <AlertDescription>{erro}</AlertDescription>
          </Alert>
        )}

        {/* ── Issue #136: a saída que faltava ────────────────────────────

            Âmbar, não vermelho: a dose ser de mais tarde é uma pendência a
            confirmar, não um erro (invariante 5). E o texto é o do servidor,
            que já vem com o horário dentro — a tela não conhece a janela. */}
        {perguntaDeAntecipacao && (
          <div className="rounded-lg border border-zelo-amber/30 bg-zelo-amber-bg px-4 py-3 space-y-3">
            <p className="text-sm text-zelo-amber-fg">{perguntaDeAntecipacao}</p>
            <Button
              size="sm"
              className="w-full"
              disabled={salvando}
              onClick={() => void salvar(true)}
            >
              Sim, é esta dose
            </Button>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onFechar} disabled={salvando}>
            Cancelar
          </Button>
          <Button onClick={() => void salvar()} disabled={salvando}>
            {salvando ? "Salvando…" : "Salvar correção"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
