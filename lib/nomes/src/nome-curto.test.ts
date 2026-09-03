import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { nomeCurto, foiEncurtado } from "./nome-curto.ts";

/**
 * Os dois nomes do relato original da Issue #88. Não são inventados: foi com
 * eles que a tela quebrou no celular do fundador, e são nomes de gente.
 */
describe("os nomes que geraram a Issue", () => {
  it("Maria Aparecida da Conceição Gonçalves de Oliveira → Maria Oliveira", () => {
    assert.equal(
      nomeCurto("Maria Aparecida da Conceição Gonçalves de Oliveira"),
      "Maria Oliveira",
    );
  });

  it("Antonio Carlos de Vasconcelos Nascimento → Antonio Nascimento", () => {
    assert.equal(
      nomeCurto("Antonio Carlos de Vasconcelos Nascimento"),
      "Antonio Nascimento",
    );
  });
});

describe("partícula não é sobrenome", () => {
  it("pega a palavra depois do 'de', não o 'de'", () => {
    assert.equal(nomeCurto("Maria Aparecida de Oliveira"), "Maria Oliveira");
  });

  for (const particula of ["de", "da", "do", "das", "dos", "e"]) {
    it(`"${particula}" é ignorada como sobrenome`, () => {
      const curto = nomeCurto(`Ana Cristina ${particula} Souza`);
      assert.equal(curto, "Ana Souza");
    });
  }

  it("nome que é só partícula depois do primeiro devolve o completo — não inventa 'Maria de'", () => {
    // Ninguém se chama assim, mas a validação de hoje aceita (letras + duas
    // palavras). Devolver o completo é mais honesto que produzir um nome falso.
    assert.equal(nomeCurto("Maria de da"), "Maria de da");
  });
});

describe("sufixo de geração vai junto — é o caso que quebra a regra ingênua", () => {
  it("José de Souza Filho → José Souza Filho, e NÃO 'José Filho'", () => {
    assert.equal(nomeCurto("José de Souza Filho"), "José Souza Filho");
  });

  it("Carlos Eduardo Lima Neto → Carlos Lima Neto", () => {
    assert.equal(nomeCurto("Carlos Eduardo Lima Neto"), "Carlos Lima Neto");
  });

  it("Paulo Roberto Dias Júnior → Paulo Dias Júnior, com acento e tudo", () => {
    assert.equal(nomeCurto("Paulo Roberto Dias Júnior"), "Paulo Dias Júnior");
  });

  it("'Junior' sem acento é a mesma palavra", () => {
    assert.equal(nomeCurto("Paulo Roberto Dias Junior"), "Paulo Dias Junior");
  });

  it("sufixo depois de partícula: Antonio Carlos de Vasconcelos Nascimento Filho", () => {
    assert.equal(
      nomeCurto("Antonio Carlos de Vasconcelos Nascimento Filho"),
      "Antonio Nascimento Filho",
    );
  });

  it("dois sufixos seguidos saem os dois, na ordem", () => {
    assert.equal(nomeCurto("João Carlos Silva Neto Júnior"), "João Silva Neto Júnior");
  });

  it("'Maria Silva Filho' não perde o sobrenome ao tirar o sufixo", () => {
    // Aqui o `resto` tem só duas palavras. Tirar "Filho" deixaria "Silva"
    // sozinho — o que está certo — mas o teste existe para travar o caso de
    // borda do laço, que poderia esvaziar a lista.
    assert.equal(nomeCurto("Maria Silva Filho"), "Maria Silva Filho");
  });

  it("numeral romano curto conta como sufixo", () => {
    assert.equal(nomeCurto("Pedro Henrique Alves III"), "Pedro Alves III");
  });

  it("mas inicial do meio NÃO é numeral romano", () => {
    // "Ana V Silva" é nome de gente e a validação aceita (Issue #56 já
    // aprendeu isso). Se `V` entrasse na lista de sufixos, esta função comeria
    // a inicial de alguém.
    assert.equal(nomeCurto("Ana V Silva"), "Ana Silva");
    assert.equal(nomeCurto("Ana Paula V"), "Ana V");
  });
});

describe("nomes que não devem mudar", () => {
  it("nome já curto passa inteiro", () => {
    assert.equal(nomeCurto("Ana Silva"), "Ana Silva");
  });

  it("uma palavra só passa inteira", () => {
    assert.equal(nomeCurto("Jack"), "Jack");
  });

  it("vazio devolve vazio, sem estourar", () => {
    assert.equal(nomeCurto(""), "");
    assert.equal(nomeCurto("   "), "");
  });

  it("espaço repetido é colapsado, não vira palavra vazia", () => {
    assert.equal(nomeCurto("Maria   Aparecida   Oliveira"), "Maria Oliveira");
  });

  it("nome com hífen no sobrenome fica inteiro — é uma palavra só", () => {
    assert.equal(nomeCurto("Ana Maria Silva-Costa"), "Ana Silva-Costa");
  });

  it("apóstrofo idem", () => {
    assert.equal(nomeCurto("Maria Fernanda D'Ávila"), "Maria D'Ávila");
  });
});

describe("o pior caso legal continua sendo pior caso", () => {
  it("uma palavra de 60 letras sai inteira — encurtar não resolve layout", () => {
    // É a razão de o `min-w-0` nas telas continuar obrigatório. Se este teste
    // um dia passar a devolver algo menor, é porque alguém tratou validação
    // como conserto de layout, e a Issue #88 pede explicitamente para não.
    const monstro = "W".repeat(60);
    assert.equal(nomeCurto(monstro), monstro);
  });

  it("primeiro nome enorme + sobrenome enorme continuam os dois", () => {
    const nome = `${"W".repeat(30)} ${"X".repeat(29)}`;
    assert.equal(nomeCurto(nome), nome);
  });
});

describe("foiEncurtado", () => {
  it("é falso quando nada mudou", () => {
    assert.equal(foiEncurtado("Ana Silva"), false);
    assert.equal(foiEncurtado("Jack"), false);
  });

  it("é verdadeiro quando o nome completo tem mais coisa", () => {
    assert.equal(foiEncurtado("Maria Aparecida de Oliveira"), true);
  });

  it("espaço a mais sozinho não conta como encurtamento", () => {
    assert.equal(foiEncurtado("  Ana   Silva  "), false);
  });
});
