/**
 * Cartão de uma dose do dia — ZELO.
 *
 * ── O defeito que este arquivo carregava, e a lição — Issue #26 ───────────
 *
 * A linha de baixo era escrita como `às {takenAt} por {takenBy}`, **sem
 * checar se os dois existiam**. Quem montava o cartão não passava nenhum dos
 * dois, e a tela exibia literalmente **"às  por"** — as preposições sozinhas,
 * com um buraco em cada lado.
 *
 * Ficou assim por meses porque nenhum teste olhava a tela e porque a tela
 * inicial usa outro caminho. Um cuidador apressado leria "às por" e não
 * saberia se alguém deu o remédio.
 *
 * A correção não é só passar os dados: é o cartão **parar de assumir que
 * eles existem**. `frasePartida` monta a frase com o que tem — e, sem nada,
 * diz "Registrado", que é verdade, em vez de duas preposições, que não é
 * nada.
 *
 * ── Três estados, não dois ────────────────────────────────────────────────
 *
 * `skipped` era jogado no balde de "pendente": uma dose que alguém pulou de
 * propósito aparecia âmbar, escrita "Pendente", e sem botão nenhum — parecia
 * travada. Contradizia a regra que o próprio produto já tinha escrito:
 * **pular é uma decisão registrada, e conta como resolvida.**
 *
 * Cores: âmbar para pendente, verde para tomada, **neutro para pulada**.
 * Vermelho é proibido em qualquer contexto de dose (invariante 5), e pular
 * não é erro nenhum — é alguém decidindo, e registrando a decisão.
 */
import { cn } from "@/lib/utils";
import { Check, Clock, MinusCircle, User } from "lucide-react";
import { motion } from "framer-motion";

export type EstadoDaDose = "pending" | "taken" | "skipped";

interface DoseCardProps {
  medicationName: string;
  dosage: string;
  time: string;
  status: EstadoDaDose;
  /** Nome de quem registrou. No modo idoso, é o nome do PACIENTE (ZELO-40). */
  takenBy?: string | null;
  /** Hora do registro, já formatada no fuso do paciente ("08:14"). */
  takenAt?: string | null;
}

/**
 * A frase de quem registrou, montada com o que existe.
 *
 * Nunca devolve preposição solta. É o conserto da Issue #26, e o motivo de
 * ser uma função à parte: a regra é fácil de reintroduzir por descuido numa
 * interpolação de uma linha.
 */
export function frasePartida(quando?: string | null, quem?: string | null): string {
  if (quando && quem) return `às ${quando} por ${quem}`;
  if (quando) return `às ${quando}`;
  if (quem) return `por ${quem}`;
  // Sem hora e sem nome ainda é informação: alguém registrou. Melhor dizer
  // pouco e verdadeiro do que muito e quebrado.
  return "Registrado";
}

export function DoseCard({ medicationName, dosage, time, status, takenBy, takenAt }: DoseCardProps) {
  const tomada = status === "taken";
  const pulada = status === "skipped";
  const resolvida = tomada || pulada;

  return (
    <motion.div
      layout
      whileHover={{ y: -2 }}
      className={cn(
        "p-5 rounded-xl border flex flex-col gap-3 min-h-[64px] shadow-sm transition-colors",
        tomada && "bg-zelo-green-bg border-zelo-green/20",
        pulada && "bg-muted/40 border-border",
        !resolvida && "bg-zelo-amber-bg border-zelo-amber/20"
      )}
    >
      <div className="flex justify-between items-start gap-4">
        <div className="min-w-0">
          <h3 className="text-[18px] font-semibold text-foreground leading-tight">{medicationName}</h3>
          <p className="text-muted-foreground mt-1 text-[17px]">{dosage}</p>
        </div>
        <div className={cn(
          "flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[17px] font-medium border shrink-0",
          tomada && "bg-zelo-green/10 text-zelo-green-fg border-zelo-green/20",
          pulada && "bg-muted text-muted-foreground border-border",
          !resolvida && "bg-zelo-amber/20 text-zelo-amber-fg border-zelo-amber/20"
        )}>
          {tomada && <Check className="w-4 h-4" />}
          {pulada && <MinusCircle className="w-4 h-4" />}
          {!resolvida && <Clock className="w-4 h-4" />}
          <span>{tomada ? "Tomado" : pulada ? "Pulado" : "Pendente"}</span>
        </div>
      </div>

      <div className="flex items-center gap-2 text-[17px] mt-1">
        {resolvida ? (
          <>
            <div className="flex -space-x-1">
              <div className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center border border-white",
                tomada ? "bg-zelo-green/20" : "bg-muted"
              )}>
                <User className={cn("w-3.5 h-3.5", tomada ? "text-zelo-green-fg" : "text-muted-foreground")} />
              </div>
            </div>
            {/* O selo acima já diz o QUE aconteceu ("Tomado" / "Pulado").
                Esta linha diz quando e quem — repetir o verbo aqui daria
                "Pulado Registrado" quando faltasse hora e nome. */}
            <span className="text-muted-foreground">
              <strong className="font-medium text-foreground">{frasePartida(takenAt, takenBy)}</strong>
            </span>
          </>
        ) : (
          <span className="text-zelo-amber-fg font-medium">Agendado para {time}</span>
        )}
      </div>
    </motion.div>
  );
}
