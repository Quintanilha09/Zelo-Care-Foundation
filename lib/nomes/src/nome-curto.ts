/**
 * Como o nome de um paciente aparece na tela — Issue #88.
 *
 * ── O problema, e a decisão do fundador ───────────────────────────────────
 *
 * Nome brasileiro é comprido. "Maria Aparecida da Conceição Gonçalves de
 * Oliveira" tem 49 caracteres, é o nome de alguém, e o limite do cadastro (60)
 * existe justamente para caber gente assim. No celular, esse nome quebrava a
 * tela.
 *
 * A decisão foi dele, em 03/09/2026, e é melhor do que as duas que eu tinha
 * proposto:
 *
 *   > "O usuário pode colocar o nome completo do paciente, mas não deve ser
 *   > mostrado o nome completo na tela, pois é inviável."
 *
 * **Guardar completo, mostrar curto.** As minhas propostas — quebrar em várias
 * linhas, ou truncar com reticências — tratavam o nome como uma string
 * comprida a ser espremida. Nome de pessoa não é isso: ele tem estrutura, e dá
 * para usar.
 *
 * ── Por que não truncar ───────────────────────────────────────────────────
 *
 * Truncar produz "Maria Aparecida da Concei…", que não é o nome de ninguém. O
 * jeito de encurtar nome brasileiro é o que as pessoas já fazem falando:
 * **primeiro nome + último sobrenome**. "Maria Oliveira".
 *
 * ── Isto NÃO é o conserto do layout ───────────────────────────────────────
 *
 * `Jack Wwwwwwwwwwwwwwwwwwwwwwwwwwwwww` continua tendo uma palavra de 30
 * letras depois de encurtado. O `min-w-0` nas telas é o piso, e continua
 * obrigatório — ver a Issue. Encurtar melhora o caso comum; não elimina o
 * pior caso.
 */

/**
 * Palavras de ligação. Não são sobrenome, e pegar "a última palavra" sem
 * tratá-las produziria "Maria De".
 *
 * Só as portuguesas. `van`, `von`, `del`, `di` existem em nomes brasileiros,
 * mas também existem como sobrenome inteiro de alguém — e errar para o lado de
 * mostrar uma palavra a mais é muito melhor que engolir o sobrenome de uma
 * família.
 */
const PARTICULAS = new Set(["de", "da", "do", "das", "dos", "e"]);

/**
 * Sufixo de geração. É o caso que quebra a regra ingênua:
 *
 * | Guardado             | Ingênuo (errado) | Correto              |
 * |----------------------|------------------|----------------------|
 * | José de Souza Filho  | José Filho       | José Souza Filho     |
 * | Carlos Lima Neto     | Carlos Neto      | Carlos Lima Neto     |
 *
 * "Filho" não identifica família nenhuma — sozinho, ele some com a informação
 * que importa. Então o sufixo vai junto, e o sobrenome é a palavra anterior.
 *
 * Numerais romanos ficam de fora de propósito, com uma exceção: `II`, `III` e
 * `IV`. Aceitar `V` ou `X` soltos faria a função comer a inicial do meio de
 * "Ana V Silva", e inicial do meio é nome de gente — a validação aceita, e a
 * Issue #56 já aprendeu essa lição uma vez.
 */
const SUFIXOS_DE_GERACAO = new Set([
  "filho",
  "filha",
  "neto",
  "neta",
  "sobrinho",
  "sobrinha",
  "junior",
  "senior",
  "jr",
  "ii",
  "iii",
  "iv",
]);

/**
 * Tira acento e caixa, para comparar com as listas acima.
 *
 * "Júnior" e "Junior" são a mesma palavra para quem lê, e precisam ser a mesma
 * palavra aqui. O ponto final some junto: "Jr." não passa na validação de
 * hoje, mas nome que veio de importação ou de uma versão futura da regra pode
 * trazer.
 */
function comparavel(palavra: string): string {
  return palavra
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/\.$/, "")
    .toLowerCase();
}

/**
 * O nome como ele aparece na tela: primeiro nome + último sobrenome.
 *
 * Devolve o nome inteiro, sem mexer, quando encurtar não faria sentido: nome
 * vazio, nome de uma palavra só, nome que já tem duas palavras.
 *
 * @param nomeCompleto o nome como está guardado no banco
 */
export function nomeCurto(nomeCompleto: string): string {
  const palavras = nomeCompleto.trim().split(/\s+/).filter(Boolean);

  // Uma ou duas palavras já são a forma curta. Mexer aqui só criaria a chance
  // de estragar um nome que estava certo.
  if (palavras.length <= 2) return palavras.join(" ");

  const primeiro = palavras[0]!;
  const resto = palavras.slice(1);

  // 1) Tira do fim os sufixos de geração, para levá-los junto no resultado.
  //    `resto.length > 1` protege o caso "Maria Filho": ali "Filho" é a única
  //    coisa que resta, e tirá-lo não deixaria sobrenome nenhum.
  const sufixos: string[] = [];
  while (resto.length > 1 && SUFIXOS_DE_GERACAO.has(comparavel(resto[resto.length - 1]!))) {
    sufixos.unshift(resto.pop()!);
  }

  // 2) O sobrenome é a última palavra que não é partícula.
  let i = resto.length - 1;
  while (i > 0 && PARTICULAS.has(comparavel(resto[i]!))) i--;
  const sobrenome = resto[i]!;

  // 3) Se ainda assim sobrou uma partícula — "Maria de da", que a validação
  //    aceita e ninguém se chama — devolver o nome inteiro é mais honesto que
  //    inventar "Maria de".
  if (PARTICULAS.has(comparavel(sobrenome))) return palavras.join(" ");

  return [primeiro, sobrenome, ...sufixos].join(" ");
}

/** `true` quando o nome curto esconde alguma coisa do completo. */
export function foiEncurtado(nomeCompleto: string): boolean {
  return nomeCurto(nomeCompleto) !== nomeCompleto.trim().replace(/\s+/g, " ");
}
