import { useEffect, useState } from "react";
import { temaGuardado, guardarTema, observarOAparelho, type Tema } from "@/lib/tema";
import { cn } from "@/lib/utils";
import { Sun, Moon, SunMoon, Check } from "lucide-react";

/**
 * Ajustes — Aparência — Issue #138.
 *
 * ── Três estados, e o padrão é "igual ao aparelho" ────────────────────────
 *
 * O pedido do fundador foi *"minha visão dói nesse modo claro"*. O motivo é
 * dor, não gosto — então quem já pôs o celular no modo noturno abre o app e
 * ele já nasce escuro, sem descobrir botão nenhum. A escolha manual existe
 * para quem quer o **contrário** do sistema.
 *
 * ── Por que não é um interruptor de dois estados ──────────────────────────
 *
 * Um interruptor claro/escuro obriga a escolher, e some com a opção mais
 * útil: acompanhar o modo noturno agendado do celular. Com ele, o app
 * escurece sozinho no fim da tarde junto com todo o resto do aparelho.
 */

const OPCOES: Array<{ valor: Tema; rotulo: string; explicacao: string; icone: typeof Sun }> = [
  {
    valor: "sistema",
    rotulo: "Igual ao aparelho",
    explicacao: "Acompanha o modo noturno do seu celular, inclusive quando ele troca sozinho.",
    icone: SunMoon,
  },
  { valor: "claro", rotulo: "Claro", explicacao: "Sempre claro, mesmo à noite.", icone: Sun },
  { valor: "escuro", rotulo: "Escuro", explicacao: "Sempre escuro, mesmo de dia.", icone: Moon },
];

export default function SettingsAppearancePage() {
  const [escolha, setEscolha] = useState<Tema>(() => temaGuardado());

  // Enquanto a escolha for "sistema", o app segue o aparelho ao vivo — o
  // modo noturno agendado do celular troca com o app aberto, no fim da tarde.
  useEffect(() => observarOAparelho(() => escolha), [escolha]);

  const escolher = (valor: Tema) => {
    setEscolha(valor);
    guardarTema(valor);
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Aparência</h2>
        <p className="text-muted-foreground text-[17px]">
          Como o ZELO se apresenta neste aparelho.
        </p>
      </div>

      <section className="p-4 rounded-xl border bg-card shadow-sm space-y-3">
        <div>
          <h3 className="font-medium">Tema</h3>
          <p className="text-sm text-muted-foreground">
            Vale só neste aparelho. Se você usa o ZELO no celular e no
            computador, pode escolher diferente em cada um.
          </p>
        </div>

        {/* `radiogroup` e não uma lista de botões: são opções mutuamente
            exclusivas, e é assim que o leitor de tela anuncia "1 de 3". */}
        <div role="radiogroup" aria-label="Tema" className="space-y-2">
          {OPCOES.map((o) => {
            const ativa = escolha === o.valor;
            return (
              <button
                key={o.valor}
                type="button"
                role="radio"
                aria-checked={ativa}
                onClick={() => escolher(o.valor)}
                className={cn(
                  "flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors",
                  ativa
                    ? "border-primary bg-muted"
                    : "border-border hover:bg-muted/60",
                )}
              >
                <o.icone className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{o.rotulo}</span>
                  <span className="block text-sm text-muted-foreground">{o.explicacao}</span>
                </span>
                {ativa && <Check className="h-5 w-5 shrink-0 text-primary" aria-hidden />}
              </button>
            );
          })}
        </div>
      </section>
    </div>
  );
}
