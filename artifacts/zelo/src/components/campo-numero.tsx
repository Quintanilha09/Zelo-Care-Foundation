import { Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Campo numérico com botões de aumentar e diminuir.
 *
 * ── Por que não usar `<input type="number">` ──────────────────────────────
 *
 * Dois defeitos reais, os dois relatados pelo fundador em 24/08/2026:
 *
 * 1. **As setinhas nativas.** Minúsculas, empilhadas, do tamanho de um grão de
 *    arroz. Num app cujo público é cuidador de 30 a 60 anos, muitas vezes no
 *    celular, elas são um alvo impossível de acertar.
 *
 * 2. **Ele aceita letras e mente sobre isso.** Digitando "ff" num campo
 *    `type="number"`, o navegador MOSTRA "ff" mas reporta `value === ""`.
 *    A tela e o estado discordam: a pessoa vê o que escreveu e o app acha que
 *    está vazio. Foi exatamente o que apareceu em "Quantidade na caixa".
 *
 * ── O que este componente faz ─────────────────────────────────────────────
 *
 * `type="text"` com `inputMode="numeric"`: o celular abre o teclado numérico,
 * o navegador não desenha setinha nenhuma, e o filtro deixa passar só dígito.
 * O que aparece na tela é sempre o que está no estado.
 *
 * Os botões têm área de toque de 36px, o mínimo confortável, e ficam nas
 * pontas — longe um do outro, para não errar o alvo.
 */
export function CampoNumero({
  value,
  onChange,
  min = 0,
  max,
  step = 1,
  id,
  placeholder,
  sufixo,
  className,
}: {
  /** Sempre string: campo vazio é `""`, não `0`. Zero é um valor legítimo. */
  value: string;
  onChange: (valor: string) => void;
  min?: number;
  max?: number;
  step?: number;
  id?: string;
  placeholder?: string;
  /** Texto curto à direita do número, ex.: "horas", "dias". */
  sufixo?: string;
  className?: string;
}) {
  const numero = value === "" ? null : Number(value);

  const limitar = (n: number): number => {
    if (max !== undefined && n > max) return max;
    if (n < min) return min;
    return n;
  };

  const ajustar = (delta: number) => {
    // Campo vazio + "aumentar" começa do mínimo, não de zero — se o mínimo é 1,
    // o primeiro toque tem que dar 1, não 0 (que seria inválido).
    const base = numero ?? (delta > 0 ? min - step : min);
    onChange(String(limitar(base + delta)));
  };

  const aoDigitar = (texto: string) => {
    // Só dígito. Nada de "e", "+", "-" ou letra — que é o que o type="number"
    // deixa passar enquanto finge que o campo está vazio.
    const limpo = texto.replace(/\D/g, "");
    if (limpo === "") { onChange(""); return; }
    onChange(String(limitar(Number(limpo))));
  };

  const noMinimo = numero !== null && numero <= min;
  const noMaximo = max !== undefined && numero !== null && numero >= max;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => ajustar(-step)}
        disabled={noMinimo}
        aria-label="Diminuir"
      >
        <Minus className="h-4 w-4" />
      </Button>

      <div className="relative flex-1 min-w-0">
        <input
          id={id}
          type="text"
          inputMode="numeric"
          // `pattern` faz o teclado numérico aparecer também no iOS antigo.
          pattern="[0-9]*"
          value={value}
          onChange={(e) => aoDigitar(e.target.value)}
          placeholder={placeholder}
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-sm transition-colors",
            "text-center tabular-nums",
            "placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
            "disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
            sufixo && "pr-12"
          )}
        />
        {sufixo && (
          <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
            {sufixo}
          </span>
        )}
      </div>

      <Button
        type="button"
        variant="outline"
        size="icon"
        className="h-9 w-9 shrink-0"
        onClick={() => ajustar(step)}
        disabled={noMaximo}
        aria-label="Aumentar"
      >
        <Plus className="h-4 w-4" />
      </Button>
    </div>
  );
}
