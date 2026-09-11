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
import { Check, Clock, MinusCircle, User, AlertCircle } from "lucide-react";
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
  /**
   * A dose passou da hora — Issue #153.
   *
   * Vem calculado de fora porque quem sabe QUE HORAS SAO e a pagina, que
   * tem o pulso de minuto. O cartao so exibe.
   */
  atrasada?: boolean;
  /** "há 58 minutos". So aparece quando `atrasada`. */
  atrasadaHa?: string | null;
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

export function DoseCard({ medicationName, dosage, time, status, takenBy, takenAt, atrasada = false, atrasadaHa }: DoseCardProps) {
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
        // #153: mesma COR, mais presenca. Vermelho e proibido em dose
        // (invariante 5) — a urgencia se faz com peso, nao com outra cor.
        !resolvida && !atrasada && "bg-zelo-amber-bg border-zelo-amber/20",
        !resolvida && atrasada && "bg-zelo-amber-bg border-zelo-amber"
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
          !resolvida && !atrasada && "bg-zelo-amber/20 text-zelo-amber-fg border-zelo-amber/20",
          // #153 — o preenchimento NAO muda, e o motivo esta medido.
          //
          // A primeira versao punha branco sobre ambar solido. O teste de
          // contraste da #149 reprovou na hora: 2,11:1 no claro e 2,14:1 no
          // escuro. Medi as alternativas, e todas falham — ambar cheio com
          // ambar-fg da 2,70:1, e ate o /40 fica em 4,26:1.
          //
          // Ambar e uma cor de luminancia MEDIA: nada legivel assenta nela.
          // O /20 com ambar-fg, que ja existia, e a combinacao mais legivel
          // que o ambar permite (4,94:1).
          //
          // Entao a urgencia vem do PESO e da BORDA, que nao tem texto por
          // cima: borda cheia em vez de 20%, e a palavra em negrito. O que
          // grita e a palavra "Atrasado", nao a saturacao do fundo.
          !resolvida && atrasada && "bg-zelo-amber/20 text-zelo-amber-fg border-zelo-amber font-semibold"
        )}>
          {tomada && <Check className="w-4 h-4" />}
          {pulada && <MinusCircle className="w-4 h-4" />}
          {!resolvida && !atrasada && <Clock className="w-4 h-4" />}
          {/* Issue #160 — o UNICO vermelho de todo o contexto de dose.

              O fundador pediu senso de urgencia depois de ver a #153 no
              aparelho: peso e borda nao bastavam para o atraso saltar. O
              recorte e o que mantem o invariante 5 de pe — fundo, texto e
              borda do selo continuam ambar, e "Pendente" nao muda. O
              vermelho e um ACENTO de icone, nao a cor do estado.

              `text-zelo-atraso`, e nao `text-destructive`: destrutivo e
              apagar e cancelar. Dose atrasada nao e nenhum dos dois. */}
          {!resolvida && atrasada && <AlertCircle className="w-4 h-4 text-zelo-atraso" />}
          <span>{tomada ? "Tomado" : pulada ? "Pulado" : atrasada ? "Atrasado" : "Pendente"}</span>
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
          <span className="text-zelo-amber-fg font-medium">
            {/* #153: o horario continua sendo o que a pessoa combinou com o
                medico. O atraso entra DEPOIS dele, e nao no lugar — trocar o
                horario pelo tempo decorrido esconderia o dado clinico. */}
            Agendado para {time}
            {atrasada && atrasadaHa && (
              <span className="font-semibold"> — {atrasadaHa}</span>
            )}
          </span>
        )}
      </div>
    </motion.div>
  );
}
