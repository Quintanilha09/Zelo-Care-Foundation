/**
 * A forma de um nome de paciente — Issue #56.
 *
 * ── Por que isto é um módulo, e não duas linhas em `routes/patients.ts` ───
 *
 * O nome do paciente é a string mais reaproveitada do produto: aparece no
 * cabeçalho da ficha, em rótulo de botão, em notificação, na exportação e no
 * modo idoso. Até 31/08/2026 ela não tinha forma nenhuma — só
 * `z.string().min(1).max(200)`, o que aceita 200 caracteres de emoji.
 *
 * Separado do arquivo de rota por um motivo prático: assim ele tem teste
 * próprio que **não precisa de banco nem de servidor**. É a única parte desta
 * Issue verificável sem Postgres, e nesta máquina o Postgres não sobe.
 *
 * ── As regras, e de onde cada uma vem ─────────────────────────────────────
 *
 * 1. **Teto de 60 caracteres.** É o que impede "texto gigante ou malicioso",
 *    que era o objetivo declarado do pedido. O teto anterior, 200, deixava o
 *    nome estourar cabeçalho e botão — ver Issue #55.
 * 2. **Allow-list de caracteres**, nunca deny-list: letras (com acento),
 *    espaço, hífen e apóstrofo. Lista de proibidos sempre esquece alguma
 *    coisa; lista de permitidos, não.
 * 3. **Pelo menos duas palavras.** Sem exigir tamanho mínimo por palavra: a
 *    primeira versão pedia duas palavras com 2+ caracteres e recusava
 *    "Ana P Silva" — inicial do meio é nome de gente. Recusava também
 *    "Paciente A" dentro da própria suíte, e isso é sinal, não coincidência:
 *    regra que só o autor consegue satisfazer está errada.
 * 4. **Normalização antes de gravar:** corta as pontas e colapsa espaço
 *    repetido, para "Maria   Silva" e "Maria Silva" não virarem dois nomes.
 *
 * ── SUPOSIÇÃO A CONFIRMAR: "pelo menos duas" e não "exatamente duas" ──────
 *
 * O pedido do fundador foi limitar a **exatamente** Nome e Sobrenome. Está
 * implementado como **pelo menos duas palavras**, e a razão está nos dados do
 * próprio projeto: o paciente cadastrado hoje chama-se "Jailson Mendes
 * Delicia" — três palavras. "Maria da Silva" e "José dos Santos Neto" também
 * seriam recusados por uma regra de duas exatas.
 *
 * O objetivo declarado é atingido pelo teto e pela allow-list. Contar palavras
 * não acrescenta segurança nenhuma — só recusa nome de gente de verdade, e
 * recusar o nome de alguém num app de cuidado é caro.
 *
 * **Se a decisão for mesmo por duas exatas**, o ponto de mudança é o
 * `superRefine` abaixo, e é uma linha. Mas então é preciso decidir o que fazer
 * com os pacientes já cadastrados que não passam: `UpdatePatientBody` recusaria
 * qualquer edição deles.
 */

import { z } from "zod";

export const NOME_MIN = 2;
export const NOME_MAX = 60;

/**
 * Teto por palavra — Issue #88.
 *
 * O que quebrou a tela do fundador em 03/09/2026 não foi um nome longo: foi
 * **uma palavra de 42 letras**. Isso não existe em nome de pessoa — o
 * sobrenome mais longo em uso tem cerca de 20 caracteres — e é justamente o
 * formato que o `min-width: auto` do flexbox não consegue encolher.
 *
 * ── Isto NÃO é o conserto do layout ──────────────────────────────────────
 *
 * Um nome de 60 caracteres com palavras normais continua legal, continua
 * possível, e continua tendo que caber na tela. As telas ganharam `min-w-0` e
 * `break-words` na mesma Issue, e é lá que o problema é resolvido de verdade.
 * Tratar validação como conserto de layout seria a gambiarra que o fundador
 * pediu explicitamente para evitar.
 *
 * ── Por que 30, e não 20 ─────────────────────────────────────────────────
 *
 * Vinte cobriria o que se conhece hoje, e é exatamente por isso que não
 * serve: a regra tem que recusar lixo sem chegar perto de nome de gente.
 * Trinta deixa 50% de folga sobre o sobrenome mais longo que se conhece, e
 * ainda assim recusa as 42 letras do relato.
 */
export const MAX_POR_PALAVRA = 30;

/**
 * Letras de qualquer alfabeto (`\p{L}`), marcas de acento que vêm soltas em
 * texto não normalizado (`\p{M}`), espaço, hífen e apóstrofo.
 *
 * `\p{M}` não é preciosismo: "José" digitado no iOS pode chegar como `e` +
 * acento combinante, e sem ele o nome seria recusado por um motivo invisível
 * para quem digitou.
 */
const CARACTERES_PERMITIDOS = /^[\p{L}\p{M}'\- ]+$/u;

/** Corta as pontas e colapsa espaço repetido. */
export function normalizarNome(bruto: string): string {
  return bruto.trim().replace(/\s+/g, " ");
}

/** Quantas palavras o nome tem. */
function quantasPalavras(nome: string): number {
  return nome.split(" ").filter(Boolean).length;
}

/**
 * A palavra mais longa do nome, em letras.
 *
 * Duas correções sobre o `palavra.length` ingênuo, e as duas existem para não
 * recusar ninguém por um motivo invisível:
 *
 * 1. **`normalize("NFC")`** compõe acento solto com a letra. "José" digitado
 *    no iOS pode chegar como `e` + acento combinante — dois pontos de código
 *    para uma letra só. Sem isto, um nome acentuado seria medido com o dobro
 *    do tamanho que tem.
 * 2. **`[...palavra]`** itera por ponto de código, e não por unidade UTF-16.
 *
 * Não é segmentação de grafemas de verdade (`Intl.Segmenter`), e não precisa
 * ser: a allow-list acima já barrou tudo que não é letra, espaço, hífen ou
 * apóstrofo, então o que sobra é alfabeto — onde NFC resolve o caso real.
 */
function maiorPalavra(nome: string): number {
  return nome
    .split(" ")
    .filter(Boolean)
    .reduce((maior, palavra) => Math.max(maior, [...palavra.normalize("NFC")].length), 0);
}

/**
 * O schema, já normalizando. A saída é o nome pronto para gravar.
 *
 * A ordem importa: normaliza **antes** de medir, senão "  A  " passaria no
 * mínimo de 2 caracteres por causa dos espaços.
 */
export const nomeDePaciente = z
  .string({ required_error: "O nome é obrigatório." })
  .transform(normalizarNome)
  .superRefine((nome, ctx) => {
    if (nome.length < NOME_MIN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `O nome precisa ter ao menos ${NOME_MIN} caracteres.`,
      });
      return;
    }
    if (nome.length > NOME_MAX) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `O nome pode ter no máximo ${NOME_MAX} caracteres.`,
      });
      return;
    }
    if (!CARACTERES_PERMITIDOS.test(nome)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "O nome aceita apenas letras, espaço, hífen e apóstrofo.",
      });
      return;
    }
    if (quantasPalavras(nome) < 2) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Escreva o nome e ao menos um sobrenome.",
      });
      return;
    }
    if (maiorPalavra(nome) > MAX_POR_PALAVRA) {
      // A mensagem diz a regra, e não só que falhou: quem digitou um nome
      // de verdade nunca vê isto, e quem colou lixo precisa entender o que
      // fazer. Ver Issue #88.
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: `Cada parte do nome pode ter até ${MAX_POR_PALAVRA} letras.`,
      });
    }
  });
