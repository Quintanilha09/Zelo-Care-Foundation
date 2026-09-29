/**
 * Claro, escuro, ou igual ao aparelho — Issues #138 e #225.
 *
 * ── Duas decisões do fundador, e a segunda revisou a primeira ─────────────
 *
 * **10/09/2026 (#138):** *"implemente o modo noturno, pois minha visão dói
 * nesse modo claro"*. O motivo era **dor**, não gosto — e por isso o padrão
 * nasceu como "seguir o aparelho": quem tem sensibilidade à luz normalmente
 * já configurou o celular no escuro, e abriria o app já escuro, sem descobrir
 * botão nenhum.
 *
 * **29/09/2026 (#225):** *"Somente no primeiro acesso será o modo claro por
 * padrão. Caso o usuário consiga logar, e em sua conta o modo escuro estiver
 * configurado como preferência, ele já entra logado no modo escuro."*
 *
 * O padrão passou a ser **claro**, e o aparelho só manda quando a pessoa
 * escolhe "Igual ao aparelho" com todas as letras.
 *
 * **O que isso custa, e foi dito antes de mudar:** quem tem o celular no
 * escuro por sensibilidade à luz recebe uma tela branca na primeira abertura
 * e precisa achar Ajustes → Aparência. Num app usado de madrugada, é o
 * cenário para o qual o modo escuro foi feito. O fundador foi avisado e
 * confirmou; as duas versões ficam aqui para quem chegar depois não achar que
 * a primeira foi esquecida.
 *
 * ── A armadilha: "sistema" precisa ser GRAVADO ────────────────────────────
 *
 * Até a #225, `guardarTema("sistema")` apagava a chave, porque ausência já
 * significava "sistema". Com ausência significando "claro", apagar passaria a
 * ser o mesmo que escolher "Claro" — e a opção "Igual ao aparelho"
 * continuaria na tela fazendo outra coisa, em silêncio, só na próxima
 * abertura. Por isso ela grava.
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

/** O que está guardado, ou "claro" quando não há nada (ou o valor é lixo). */
export function temaGuardado(): Tema {
  try {
    const bruto = localStorage.getItem(CHAVE_DO_TEMA);
    if (bruto === "claro" || bruto === "escuro" || bruto === "sistema") return bruto;
    return "claro";
  } catch {
    // Navegador com armazenamento bloqueado: não há escolha para ler, então
    // vale o padrão de quem nunca escolheu. É também o que o CSS já pinta e o
    // que o script do `index.html` faz quando o `localStorage` lança.
    return "claro";
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
    // As três gravam, inclusive "sistema" — ver a armadilha no topo do arquivo.
    localStorage.setItem(CHAVE_DO_TEMA, escolha);
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
