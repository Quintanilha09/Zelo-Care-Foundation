/**
 * Esqueletos de carregamento — Issue #5.
 *
 * ── Por que esqueleto e não "Carregando…" ─────────────────────────────────
 *
 * Um texto de carregando diz que algo está acontecendo. Um esqueleto diz
 * **o que** está chegando, e onde. A tela não pula quando o conteúdo entra,
 * porque o espaço já estava reservado no formato certo.
 *
 * Para quem lê devagar, isso importa mais do que parece: a página que se
 * reorganiza embaixo do olho obriga a começar de novo.
 *
 * ── Por que não o `<Skeleton>` do shadcn ──────────────────────────────────
 *
 * Aquele usa `animate-pulse`, que pisca a opacidade entre 1 e 0,5 em laço
 * infinito. É o padrão que a literatura de movimento chama de *pulsing
 * indicator*, e num app usado por gente com sensibilidade visual ele cansa.
 *
 * O `.zelo-esqueleto` (em index.css) é um brilho que atravessa uma vez a cada
 * 1,6s, com contraste baixo — e que **para de se mover, sem sumir**, quando o
 * sistema pede movimento reduzido.
 */
import { cn } from "@/lib/utils";

export function Esqueleto({ className }: { className?: string }) {
  return <div className={cn("zelo-esqueleto", className)} aria-hidden="true" />;
}

/**
 * Envelope de qualquer área que carrega.
 *
 * `aria-busy` e o texto para leitor de tela existem porque o esqueleto é
 * `aria-hidden`: sem isto, quem usa leitor de tela ouviria silêncio absoluto
 * enquanto a tela carrega, sem saber se travou.
 */
export function AreaCarregando({
  children,
  rotulo = "Carregando",
}: {
  children: React.ReactNode;
  rotulo?: string;
}) {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="sr-only">{rotulo}</span>
      {children}
    </div>
  );
}

/** Esqueleto de um momento do mural: imagem, legenda, autor. */
export function EsqueletoDeMomento() {
  // QUI-18 — quadrado, porque o mural virou grade. Um retângulo alto aqui
  // reservaria um espaço que a lista real não vai ocupar, e a página pularia
  // ao chegar o conteúdo — que é exatamente o que o esqueleto existe para
  // evitar.
  return (
    <li>
      <Esqueleto className="w-full aspect-square" />
    </li>
  );
}

/** Esqueleto de um cartão de dose da tela inicial. */
export function EsqueletoDeDose() {
  return (
    <div className="rounded-xl border p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <Esqueleto className="h-5 w-40" />
        <Esqueleto className="h-5 w-14" />
      </div>
      <Esqueleto className="h-4 w-24" />
      <Esqueleto className="h-9 w-full" />
    </div>
  );
}

/** Esqueleto de uma linha de lista simples — tratamento, consulta, cuidador. */
export function EsqueletoDeLinha() {
  return (
    <div className="rounded-lg border p-3 space-y-2">
      <Esqueleto className="h-4 w-1/2" />
      <Esqueleto className="h-3 w-1/4" />
    </div>
  );
}

/**
 * Barra de progresso indeterminada, para envio de arquivo.
 *
 * Indeterminada porque `fetch` não entrega progresso de upload sem trocar
 * para `XMLHttpRequest` — e trocar a camada de rede inteira para mostrar um
 * percentual não vale o risco. O que a pessoa precisa saber é "está indo, não
 * travou", e isso a barra responde.
 */
export function BarraDeProgresso({ rotulo }: { rotulo: string }) {
  return (
    <div className="space-y-1.5">
      <div
        className="zelo-progresso-trilho h-1.5 w-full"
        role="progressbar"
        aria-label={rotulo}
        // Sem valuenow: é indeterminada, e fingir um número seria mentir para
        // o leitor de tela.
      >
        <div className="zelo-progresso-barra" />
      </div>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}
