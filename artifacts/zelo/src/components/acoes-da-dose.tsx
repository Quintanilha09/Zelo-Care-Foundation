/**
 * Os botões de uma dose, num lugar só — Issue #162.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA QUE ESTE ARQUIVO EXISTE PARA GUARDAR
 *
 * **Uma dose tem um estado, e cada estado tem UMA resposta.**
 *
 *   pendente, já chegou a hora  →  Registrar · Pular · Outro horário
 *   pendente, ainda não chegou  →  Já dei este remédio
 *   perdida                     →  Registrar (não é tarde demais)
 *   registrada, dentro do minuto→  Desfazer
 *   registrada, passou o minuto →  Corrigir
 *
 * As duas últimas **nunca aparecem juntas**. São respostas para momentos
 * diferentes, e oferecer as duas faria a pessoa escolher entre "apagar" e
 * "emendar" sem ter por que decidir isso.
 *
 * Antes da #162 essa tabela estava escrita duas vezes, em duas telas, e
 * nenhuma tinha as cinco linhas.
 * ═══════════════════════════════════════════════════════════════════════════
 */
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CorrigirDose } from "@/components/corrigir-dose";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Clock as ClockIcon, Undo2, Pencil } from "lucide-react";
import { podeDesfazer } from "@/hooks/use-pode-desfazer";
import { useState } from "react";
import { MOTIVOS_SUGERIDOS } from "@/hooks/use-registrar-dose";
import type { ControladorDeDose, DoseRegistravel } from "@/hooks/use-registrar-dose";

/**
 * O editor de horário real — antes só existia na tela inicial.
 *
 * A justificativa aparece **só quando o servidor pede**. Pedir sempre
 * transformaria um registro atrasado numa redação obrigatória, e quem está
 * com o remédio na mão desistiria.
 */
function EditorDeHorario({
  dose,
  desfecho,
  controlador,
}: {
  dose: DoseRegistravel;
  desfecho: "taken" | "skipped";
  controlador: ControladorDeDose;
}) {
  if (controlador.editandoHorarioDe !== dose.id) return null;
  const agora = new Date();

  return (
    <div className="px-1 space-y-2 bg-muted/50 rounded-lg p-3">
      <label className="text-xs text-muted-foreground block" htmlFor={`horario-${dose.id}`}>
        Horário real
      </label>
      <Input
        id={`horario-${dose.id}`}
        type="datetime-local"
        value={controlador.horario}
        // O servidor recusa dose no futuro. Travar o campo evita a pessoa
        // descobrir isso só depois de digitar e apertar Confirmar.
        max={`${agora.getFullYear()}-${String(agora.getMonth() + 1).padStart(2, "0")}-${String(agora.getDate()).padStart(2, "0")}T${String(agora.getHours()).padStart(2, "0")}:${String(agora.getMinutes()).padStart(2, "0")}`}
        onChange={(e) => controlador.setHorario(e.target.value)}
      />
      {controlador.precisaJustificar === dose.id && (
        <>
          <label className="text-xs text-muted-foreground block" htmlFor={`motivo-${dose.id}`}>
            Esse registro é de um tempo atrás — pode contar rapidamente o que aconteceu?
          </label>
          <Textarea
            id={`motivo-${dose.id}`}
            value={controlador.justificativa}
            rows={2}
            maxLength={500}
            placeholder="Ex: só vi o comprimido em cima da mesa hoje de manhã"
            onChange={(e) => controlador.setJustificativa(e.target.value)}
          />
        </>
      )}
      <div className="flex gap-2">
        <Button
          size="sm"
          disabled={controlador.emVoo === dose.id}
          onClick={() => void controlador.confirmarHorarioEscolhido(dose, desfecho)}
        >
          {controlador.emVoo === dose.id ? "Registrando…" : "Confirmar"}
        </Button>
        <Button size="sm" variant="ghost" onClick={controlador.fecharEditor}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}

export function AcoesDaDose({
  dose,
  controlador,
  agora,
  medicationName,
  somenteLeitura = false,
  compacto = false,
}: {
  dose: DoseRegistravel;
  controlador: ControladorDeDose;
  /** O "agora" da tela, vindo do pulso de desfazer. */
  agora: number;
  /** Para o diálogo de correção dizer de qual remédio se trata. */
  medicationName: string;
  /** Observador não registra nada (capacidade `register_dose`). */
  somenteLeitura?: boolean;
  /** Botões menores, para listas densas como a ficha do paciente. */
  compacto?: boolean;
}) {
  if (somenteLeitura) return null;

  const tamanho = compacto ? "sm" : "default";
  const jaChegou = new Date(dose.scheduledAt).getTime() <= agora;
  const resolvida = dose.status === "taken" || dose.status === "skipped";
  const editorAberto = controlador.editandoHorarioDe === dose.id;

  // ── Registrada ────────────────────────────────────────────────────────
  if (resolvida) {
    if (dose.recordId === null) return null;

    // Desfazer OU corrigir, nunca os dois. A #135 desenhou a janela de 60 s;
    // a #136 desenhou o que vem depois dela. Só a #162 pôs as duas na mesma
    // tela — antes o desfazer morria e não sobrava nada na tela inicial.
    return podeDesfazer(dose.desfazerAte, agora) ? (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1 h-auto py-1 shrink-0"
        onClick={() => void controlador.desfazer(dose)}
      >
        <Undo2 className="w-3.5 h-3.5" /> Desfazer
      </Button>
    ) : (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-muted-foreground h-auto py-1.5"
        onClick={() =>
          controlador.abrirCorrecao({
            recordId: dose.recordId!,
            // #178: a correção precisa saber de QUEM é a dose — a tela
            // inicial mostra várias pessoas de uma vez.
            patientId: dose.patientId,
            medicationName,
            outcome: dose.status === "skipped" ? "skipped" : "taken",
            registeredAt: null,
          })
        }
      >
        <Pencil className="w-3.5 h-3.5" aria-hidden /> Corrigir
      </Button>
    );
  }

  // ── Perdida: o registro é sempre retroativo ───────────────────────────
  if (dose.status === "late") {
    return (
      <div className="space-y-2">
        {!editorAberto && (
          <Button
            variant="outline"
            size="sm"
            className="gap-1"
            onClick={() => controlador.abrirEditorDeHorario(dose.id, new Date(dose.scheduledAt))}
          >
            <ClockIcon className="w-3.5 h-3.5" /> Registrar (não é tarde demais)
          </Button>
        )}
        <EditorDeHorario dose={dose} desfecho="taken" controlador={controlador} />
      </div>
    );
  }

  // ── Pendente, ainda não chegou a hora ─────────────────────────────────
  //
  // Issue #163: deixou de ser um botão fantasma. Continua `outline` e não
  // primário — visível sem ser o alvo mais fácil do polegar, que é de quem
  // vai registrar a dose de agora.
  if (!jaChegou) {
    return (
      <div className="space-y-2">
        {!editorAberto && (
          <Button
            variant="outline"
            size={tamanho}
            className="gap-1.5"
            onClick={() => void controlador.registrar(dose, "taken")}
          >
            <ClockIcon className="w-3.5 h-3.5" /> Já dei este remédio
          </Button>
        )}
        <EditorDeHorario dose={dose} desfecho="taken" controlador={controlador} />
      </div>
    );
  }

  // ── Pendente, já chegou a hora ────────────────────────────────────────
  return (
    <div className="space-y-2">
      {!editorAberto && (
        <div className="flex items-center gap-2 px-1">
          <Button
            className="flex-1"
            size={tamanho}
            disabled={controlador.emVoo === dose.id}
            onClick={() => void controlador.registrar(dose, "taken")}
          >
            ✓ Registrar
          </Button>
          <Button
            variant="secondary"
            size={tamanho}
            disabled={controlador.emVoo === dose.id}
            onClick={() => void controlador.registrar(dose, "skipped")}
          >
            Pular
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="gap-1 text-muted-foreground shrink-0"
            onClick={() => controlador.abrirEditorDeHorario(dose.id, new Date(dose.scheduledAt))}
          >
            <ClockIcon className="w-3.5 h-3.5" /> Outro horário
          </Button>
        </div>
      )}
      <EditorDeHorario dose={dose} desfecho="taken" controlador={controlador} />
    </div>
  );
}

/**
 * Os diálogos da tela — montados UMA vez, não por dose.
 *
 * São modais: existir um por cartão criaria dez instâncias da mesma caixa
 * esperando para abrir.
 */
/**
 * O motivo de uma dose pulada — Issue #166.
 *
 * ═══════════════════════════════════════════════════════════════════════
 * APARECE DEPOIS DE A DOSE ESTAR REGISTRADA, E NUNCA ANTES.
 *
 * "Pular" continua sendo UM toque. Quem está com pressa fecha a tela e a
 * dose está lá — o motivo é oferta, não pedágio. Perguntar antes
 * transformaria um toque em dois, e o cuidador com o remédio na mão é
 * exatamente quem não tem esse tempo.
 * ═══════════════════════════════════════════════════════════════════════
 *
 * ── O que ele NÃO é ────────────────────────────────────────────────────
 *
 * Não é um modal: modal exige decisão, e aqui não há decisão nenhuma a
 * tomar. É uma faixa que aparece e some, e ignorá-la é uma resposta
 * legítima — a mais comum, provavelmente.
 */
function MotivoDeTerPulado({ controlador }: { controlador: ControladorDeDose }) {
  const [texto, setTexto] = useState("");
  const dose = controlador.motivoPendente;
  if (!dose) return null;

  return (
    <div className="rounded-lg border border-dashed bg-muted/40 px-4 py-3 space-y-2">
      <div className="flex items-start justify-between gap-2">
        <p className="text-[15px]">
          Quer dizer por que a dose não foi dada?{" "}
          <span className="text-muted-foreground">Ajuda o médico a entender.</span>
        </p>
        {/* Fechar é uma resposta, e por isso tem botão próprio em vez de
            depender de a pessoa adivinhar que pode ignorar. */}
        <Button
          variant="ghost"
          size="sm"
          className="shrink-0 text-muted-foreground h-auto py-1"
          onClick={controlador.dispensarOMotivo}
        >
          Agora não
        </Button>
      </div>
      <div className="flex flex-wrap gap-2">
        {MOTIVOS_SUGERIDOS.map((m) => (
          <Button
            key={m}
            variant="outline"
            size="sm"
            onClick={() => void controlador.darOMotivo(m)}
          >
            {m}
          </Button>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Input
          value={texto}
          maxLength={500}
          placeholder="Ou escreva o que houve"
          onChange={(e) => setTexto(e.target.value)}
        />
        <Button size="sm" disabled={!texto.trim()} onClick={() => void controlador.darOMotivo(texto)}>
          Guardar
        </Button>
      </div>
    </div>
  );
}

export function DialogosDaDose({ controlador }: { controlador: ControladorDeDose }) {
  return (
    <>
      <MotivoDeTerPulado controlador={controlador} />

      {/* ── Issue #134, agora nas duas telas ──────────────────────────────

          O ZELO registra, não interpreta (invariante 4). Ele diz a que horas
          a dose é e pergunta se é isso mesmo — dar o remédio adiantado não é
          erro, é informação, e por isso "Sim, agora" é botão normal e não
          destrutivo.

          Issue #163: a terceira saída. "Sim, já dei" gravava o relógio de
          agora e não perguntava nada — quem deu às 18:40 e lembrou às 19:20
          registrava 19:20, e era esse horário que ia para o médico. */}
      <AlertDialog
        open={controlador.antecipacao !== null}
        onOpenChange={(aberto) => { if (!aberto) controlador.responderAntecipacao(false); }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Esta dose é das {controlador.antecipacao?.horario}</AlertDialogTitle>
            <AlertDialogDescription>
              Ela ainda não chegou no horário. Se o remédio já foi dado, registre —
              e diga a que horas foi, se não foi agora.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <AlertDialogCancel>Ainda não</AlertDialogCancel>
            <Button variant="outline" onClick={() => controlador.responderAntecipacao(true, true)}>
              Dei em outro horário
            </Button>
            <AlertDialogAction onClick={() => controlador.responderAntecipacao(true)}>
              Sim, agora
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Issue #136 — existia só na ficha do paciente até a #162. */}
      {/* #178: o paciente vem da dose aberta, e não da tela — a tela inicial
          mostra as doses de todos de uma vez. */}
      <CorrigirDose
        patientId={String(controlador.aCorrigir?.patientId ?? "")}
        dose={controlador.aCorrigir}
        onFechar={controlador.fecharCorrecao}
        onCorrigido={controlador.aoCorrigir}
      />
    </>
  );
}
