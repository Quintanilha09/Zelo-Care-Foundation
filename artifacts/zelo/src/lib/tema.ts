/**
 * Claro, escuro, ou igual ao aparelho — Issue #138.
 *
 * ── O pedido, e por que ele muda o padrão ─────────────────────────────────
 *
 * Do fundador, em 10/09/2026: *"implemente o modo noturno, pois minha visão
 * dói nesse modo claro"*.
 *
 * O motivo é **dor**, não gosto. Por isso o padrão é **seguir o aparelho**:
 * quem já configurou o celular no modo noturno — e quem tem sensibilidade à
 * luz normalmente já configurou — abre o app e ele nasce escuro, sem ter de
 * descobrir botão nenhum. A escolha manual existe para quem quer o contrário
 * do sistema, não para quem quer o óbvio.
 *
 * ── Por que a preferência é local, e não do servidor ──────────────────────
 *
 * Ela precisa valer **antes de qualquer requisição**. Guardada no servidor,
 * o app abriria claro, esperaria o `/account/me` e só então escureceria — o
 * lampejo branco a cada abertura, que para quem tem dor de vista é o
 * problema inteiro acontecendo de novo.
 */

export type Tema = "claro" | "escuro" | "sistema";

export const CHAVE_DO_TEMA = "zelo_tema";

/** O que está guardado, ou "sistema" quando não há nada (ou o valor é lixo). */
export function temaGuardado(): Tema {
  try {
    const bruto = localStorage.getItem(CHAVE_DO_TEMA);
    return bruto === "claro" || bruto === "escuro" ? bruto : "sistema";
  } catch {
    // Navegador com armazenamento bloqueado. Seguir o aparelho é o melhor
    // palpite possível, e nunca é pior que travar em claro.
    return "sistema";
  }
}

/** O aparelho está no escuro agora? */
export function aparelhoNoEscuro(): boolean {
  return typeof matchMedia === "function" && matchMedia("(prefers-color-scheme: dark)").matches;
}

/** O tema que de fato vai para a tela, resolvendo "sistema". */
export function temaEfetivo(escolha: Tema): "claro" | "escuro" {
  if (escolha !== "sistema") return escolha;
  return aparelhoNoEscuro() ? "escuro" : "claro";
}

/**
 * Põe (ou tira) a classe `.dark` e acerta a barra de status do celular.
 *
 * O `theme-color` acompanha de propósito: sem ele o app fica escuro e a barra
 * do sistema continua clara, o que num PWA em tela cheia é uma faixa branca
 * no topo — exatamente o que a pessoa estava tentando evitar.
 */
export function aplicarTema(escolha: Tema): void {
  const efetivo = temaEfetivo(escolha);
  document.documentElement.classList.toggle("dark", efetivo === "escuro");

  const meta = document.querySelector('meta[name="theme-color"]');
  // Os mesmos valores de `--background` nos dois temas, em hex: o `meta` não
  // aceita `var()`, então este é o único lugar do app onde a cor aparece
  // duplicada. Se `--background` mudar no `index.css`, muda aqui também.
  if (meta) meta.setAttribute("content", efetivo === "escuro" ? "#282725" : "#f9f7f3");
}

/** Guarda a escolha e aplica. Silencioso se o armazenamento estiver bloqueado. */
export function guardarTema(escolha: Tema): void {
  try {
    if (escolha === "sistema") localStorage.removeItem(CHAVE_DO_TEMA);
    else localStorage.setItem(CHAVE_DO_TEMA, escolha);
  } catch {
    // Sem persistir, mas a sessão atual ainda obedece.
  }
  aplicarTema(escolha);
}

/**
 * Segue o aparelho enquanto a escolha for "sistema".
 *
 * Sem isto, quem usa o modo noturno agendado do celular veria o app trocar só
 * na próxima abertura — e a troca automática do sistema acontece justamente
 * no fim da tarde, com o app aberto.
 */
export function observarOAparelho(obterEscolha: () => Tema): () => void {
  if (typeof matchMedia !== "function") return () => {};
  const consulta = matchMedia("(prefers-color-scheme: dark)");
  const aoMudar = () => {
    if (obterEscolha() === "sistema") aplicarTema("sistema");
  };
  consulta.addEventListener("change", aoMudar);
  return () => consulta.removeEventListener("change", aoMudar);
}
