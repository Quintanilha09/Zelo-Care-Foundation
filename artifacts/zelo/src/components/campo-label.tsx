import { Label } from "@/components/ui/label";

/**
 * Rótulo de campo com marcação de obrigatório.
 *
 * Pedido do fundador em 24/08/2026, testando ao vivo: "os campos obrigatórios e
 * não obrigatórios não estão claros". Vale para o app inteiro, não só para uma tela.
 *
 * O asterisco é `aria-hidden` porque quem usa leitor de tela não deve ouvir
 * "asterisco" — o `required` no próprio input já anuncia a obrigatoriedade, e o
 * texto oculto complementa para quem navega só pelo rótulo.
 *
 * A cor é âmbar, não vermelha: o vermelho neste produto é reservado a ação
 * destrutiva (invariante 5 do FOUNDATION.md), e um campo a preencher não é erro
 * nem perigo — é só informação de preenchimento.
 */
export function CampoLabel({
  children,
  obrigatorio = false,
  htmlFor,
}: {
  children: React.ReactNode;
  obrigatorio?: boolean;
  htmlFor?: string;
}) {
  return (
    <Label htmlFor={htmlFor}>
      {children}
      {obrigatorio && (
        <>
          <span className="text-zelo-amber-fg ml-0.5" aria-hidden="true">
            *
          </span>
          <span className="sr-only"> (obrigatório)</span>
        </>
      )}
    </Label>
  );
}
