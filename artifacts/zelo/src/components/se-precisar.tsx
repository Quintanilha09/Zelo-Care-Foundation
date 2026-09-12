/**
 * "Se precisar" — o remédio sem hora marcada. Issue #169.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * SEÇÃO PRÓPRIA PORQUE É OUTRA PERGUNTA.
 *
 * O dia responde *o que falta fazer*. Esta lista responde *o que já precisou*.
 * Misturadas, o cuidador leria uma procurando a outra — e um card de dipirona
 * no meio das doses pendentes pareceria tarefa, quando é registro.
 *
 * Ela aparece mesmo sem uso nenhum hoje: o botão É o caminho de registrar, e
 * escondê-lo "até precisar" esconderia justamente o momento em que se precisa.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que esta tela mostra, e o que ela nunca vai dizer ──────────────────
 *
 * Mostra: a última vez, quantas já foram hoje, e o que a receita diz
 * ("a cada 6 h · no máximo 4 por dia"). Tudo isso é fato — registrado ou
 * transcrito.
 *
 * Nunca diz: se pode dar agora. Não compara a última vez com o intervalo, não
 * soma os usos contra o teto, não pinta nada de aviso e não bloqueia o botão.
 * Mostrar "a última foi há 2 h" é registro; dizer "ainda não pode" é
 * prescrição, e o invariante 4 proíbe. Quem decide é o médico, e quem está
 * com a pessoa na frente é o cuidador.
 *
 * ── E nada de âmbar aqui ─────────────────────────────────────────────────
 *
 * Âmbar é o estado de dose pendente ou atrasada (invariante 5). Este remédio
 * nunca está pendente e nunca atrasa — pintá-lo de âmbar seria dizer que algo
 * está por fazer quando não está.
 */
import { useState } from "react";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { authFetch } from "@/lib/auth-client";
import { nomeCurto } from "@workspace/nomes";

export interface SeNecessario {
  treatmentId: number;
  patientId: number;
  patientName: string;
  medicationName: string;
  dose: string | null;
  intervaloMinimoHoras: number | null;
  tetoDiario: number | null;
  ultimoUso: string | null;
  usosHoje: number;
  horariosDeHoje: string[];
}

/** "a cada 6 h · no máximo 4 por dia" — o que a receita diz, e nada além. */
function oQueAReceitaDiz(item: SeNecessario): string | null {
  const partes: string[] = [];
  if (item.intervaloMinimoHoras) partes.push(`a cada ${item.intervaloMinimoHoras} h`);
  if (item.tetoDiario) partes.push(`no máximo ${item.tetoDiario} por dia`);
  return partes.length > 0 ? partes.join(" · ") : null;
}

/**
 * "às 14:20" quando foi hoje, "ontem às 23:40", "em 08/09" antes disso.
 *
 * Frase curta de propósito: o cuidador está resolvendo uma coisa, e "há 2
 * horas e 14 minutos" pede uma conta de cabeça no pior momento para ela.
 */
function quandoFoi(iso: string): string {
  const quando = new Date(iso);
  const hoje = new Date();
  const mesmoDia =
    quando.getFullYear() === hoje.getFullYear() &&
    quando.getMonth() === hoje.getMonth() &&
    quando.getDate() === hoje.getDate();

  const hora = quando.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  if (mesmoDia) return `às ${hora}`;

  const ontem = new Date(hoje.getTime() - 86_400_000);
  const foiOntem =
    quando.getFullYear() === ontem.getFullYear() &&
    quando.getMonth() === ontem.getMonth() &&
    quando.getDate() === ontem.getDate();
  if (foiOntem) return `ontem às ${hora}`;

  return `em ${quando.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })} às ${hora}`;
}

/** "YYYY-MM-DDTHH:mm" local, para o campo datetime-local começar em "agora". */
function agoraParaOCampo(): string {
  const agora = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${agora.getFullYear()}-${p(agora.getMonth() + 1)}-${p(agora.getDate())}T${p(agora.getHours())}:${p(agora.getMinutes())}`;
}

export function SePrecisar({
  itens,
  mostrarPaciente,
  somenteLeitura = false,
  aoRegistrar,
}: {
  itens: SeNecessario[];
  /** Com mais de um paciente na tela, cada linha precisa dizer de quem é. */
  mostrarPaciente: boolean;
  somenteLeitura?: boolean;
  aoRegistrar: () => void;
}) {
  const [aberto, setAberto] = useState<SeNecessario | null>(null);

  if (itens.length === 0) return null;

  return (
    <div className="space-y-2">
      <h3 className="text-sm font-medium text-muted-foreground">Se precisar</h3>
      {itens.map((item) => {
        const receita = oQueAReceitaDiz(item);
        return (
          <div
            key={item.treatmentId}
            className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border bg-card text-[17px]"
          >
            <div className="min-w-0">
              <p className="font-medium truncate">
                {item.medicationName}
                {item.dose && <span className="text-muted-foreground font-normal"> · {item.dose}</span>}
                {mostrarPaciente && (
                  <span className="text-muted-foreground font-normal"> · {nomeCurto(item.patientName)}</span>
                )}
              </p>
              <p className="text-sm text-muted-foreground">
                {/* Os dois fatos, sempre nesta ordem: o que aconteceu primeiro,
                    o que a receita diz depois. Nunca uma conclusão sobre os
                    dois juntos. */}
                {item.ultimoUso ? `Última vez ${quandoFoi(item.ultimoUso)}` : "Nenhuma vez registrada ainda"}
                {item.usosHoje > 0 && ` · ${item.usosHoje} ${item.usosHoje === 1 ? "vez" : "vezes"} hoje`}
                {receita && <span className="block">A receita diz: {receita}</span>}
              </p>
            </div>
            {!somenteLeitura && (
              <Button
                type="button"
                variant="secondary"
                className="shrink-0 gap-1"
                onClick={() => setAberto(item)}
              >
                <Plus className="w-4 h-4" /> Dei
              </Button>
            )}
          </div>
        );
      })}

      <DialogoDeUso
        item={aberto}
        aoFechar={() => setAberto(null)}
        aoRegistrar={() => { setAberto(null); aoRegistrar(); }}
      />
    </div>
  );
}

/**
 * A janela de registrar um uso.
 *
 * Abre em "agora", porque é o caso de longe mais comum — o cuidador acabou de
 * dar. Mas o horário é editável na mesma tela, sem um segundo toque: "dei às
 * 14h e esqueci de marcar" foi a queixa que gerou a #162, e repetir ali o
 * mesmo erro aqui seria não ter aprendido nada.
 */
function DialogoDeUso({
  item,
  aoFechar,
  aoRegistrar,
}: {
  item: SeNecessario | null;
  aoFechar: () => void;
  aoRegistrar: () => void;
}) {
  const [quando, setQuando] = useState(agoraParaOCampo());
  const [motivo, setMotivo] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState("");

  const aberto = item !== null;
  const receita = item ? oQueAReceitaDiz(item) : null;

  const enviar = async () => {
    if (!item) return;
    setEnviando(true);
    setErro("");
    try {
      const res = await authFetch(
        `/api/patients/${item.patientId}/treatments/${item.treatmentId}/uso`,
        {
          method: "POST",
          body: JSON.stringify({
            // O campo começa em "agora" e quase sempre fica nele. Quando a
            // pessoa não mexeu, mandar o valor do campo ou não mandar nada dá
            // no mesmo — e não mandar deixa o relógio do SERVIDOR decidir, que
            // é a única fonte confiável de "agora".
            ...(quando === agoraParaOCampo() ? {} : { takenAt: new Date(quando).toISOString() }),
            ...(motivo.trim() ? { justification: motivo.trim() } : {}),
          }),
        },
      );
      if (!res.ok) {
        const dados = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(dados.error ?? "Não foi possível registrar.");
      }
      setMotivo("");
      setQuando(agoraParaOCampo());
      aoRegistrar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível registrar.");
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Dialog
      open={aberto}
      onOpenChange={(a) => {
        if (!a) { setErro(""); setQuando(agoraParaOCampo()); setMotivo(""); aoFechar(); }
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Dei {item?.medicationName}</DialogTitle>
          <DialogDescription>
            {item?.dose ? `${item.dose}. ` : ""}
            Registrar não muda a adesão deste ou de nenhum outro remédio.
          </DialogDescription>
        </DialogHeader>

        {/* O retrato, e nunca o veredito. Os três fatos lado a lado é tudo o
            que o app tem a dizer — a leitura é de quem está lá. */}
        {item && (
          <div className="rounded-lg border bg-muted/40 p-3 text-sm space-y-1">
            <p>
              {item.ultimoUso ? `A última foi ${quandoFoi(item.ultimoUso)}.` : "Nenhuma vez registrada ainda."}
            </p>
            {item.usosHoje > 0 && (
              <p>Hoje já foram {item.usosHoje}{item.horariosDeHoje.length > 0 ? ` (${item.horariosDeHoje.join(", ")})` : ""}.</p>
            )}
            {receita && <p className="text-muted-foreground">A receita diz: {receita}.</p>}
          </div>
        )}

        <div className="space-y-2">
          <Label htmlFor="uso-quando">Quando foi</Label>
          <Input
            id="uso-quando"
            type="datetime-local"
            value={quando}
            onChange={(e) => setQuando(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            Já vem no horário de agora. Mude se foi em outro.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="uso-motivo">Por que precisou (opcional)</Label>
          {/* Texto livre, e nunca uma lista de motivos: uma lista escolhe por
              quem escreve e vira julgamento de quem cuida. */}
          <Textarea
            id="uso-motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={2}
            maxLength={500}
            placeholder="Dor de cabeça, por exemplo"
          />
          <p className="text-xs text-muted-foreground">
            Isto aparece no relatório do médico, com a data e a hora.
          </p>
        </div>

        {erro && <p className="text-sm text-zelo-amber-fg">{erro}</p>}

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={aoFechar} disabled={enviando}>
            Cancelar
          </Button>
          <Button type="button" onClick={() => void enviar()} disabled={enviando}>
            {enviando ? "Registrando…" : "Registrar"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
