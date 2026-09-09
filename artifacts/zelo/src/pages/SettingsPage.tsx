/**
 * Ajustes — o painel do índice — ZELO (Issue #114).
 *
 * ── O que sobrou desta tela ───────────────────────────────────────────────
 *
 * Ela era o hub inteiro: os cartões de cada categoria, agrupados em quatro
 * seções (QUI-19). A lista de seções virou a barra fixa à esquerda
 * (`ajustes-shell.tsx`), e a identidade da conta subiu para a casca — ela
 * precisa aparecer no celular, onde este painel nem é renderizado.
 *
 * O que resta é o painel direito de `/ajustes`, que **só existe no desktop**:
 * no celular a lista ocupa a tela toda e este componente fica escondido.
 * Por isso ele é uma frase, e não uma tela — quem está aqui já tem a lista
 * do lado, e o próximo passo é escolher uma seção nela.
 */
import { Settings } from "lucide-react";

export default function SettingsPage() {
  return (
    <div className="flex min-h-40 flex-col items-center justify-center rounded-xl border border-dashed px-6 py-10 text-center">
      <Settings className="mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
      <p className="text-[16px] font-medium">Escolha uma seção</p>
      <p className="mt-1 max-w-xs text-sm text-muted-foreground">
        As seções estão na lista à esquerda, agrupadas por de quem é a coisa —
        sua conta, a família, seus dados.
      </p>
    </div>
  );
}
