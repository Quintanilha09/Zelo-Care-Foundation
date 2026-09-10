/**
 * O link da foto de perfil e o cache que ele autoriza — Issue #132.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * A REGRA QUE ESTE ARQUIVO GUARDA
 *
 * **O token da foto tem que viver pelo menos tanto quanto o `max-age` que a
 * própria rota manda o navegador guardar.**
 *
 * Um link que morre antes do cache que ele mesmo autorizou é uma contradição,
 * não uma escolha de segurança — e foi o que existiu entre a #116 e a #132:
 * `Cache-Control: private, max-age=86400` (24 h) numa rota cujo token durava
 * **600 segundos**. 144× de diferença, na mesma resposta.
 *
 * O sintoma não parecia um bug de cache. Quando o navegador não tinha a URL
 * guardada — janela anônima, cache limpo, DevTools com *Disable cache*, outro
 * aparelho, ou simplesmente a foto sendo pedida pela primeira vez depois de
 * dez minutos de app aberto — a imagem tomava **410** e o Radix caía no
 * `AvatarFallback`. A foto **voltava a ser as iniciais, sem erro nenhum na
 * tela**, e quem estava olhando concluía que ela não tinha sido salva.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── E a separação da mídia continua valendo ──────────────────────────────
 *
 * A validade da foto ser maior **não** aproxima os dois mundos: as chaves
 * derivadas continuam diferentes (#116), e os dois últimos casos aqui
 * embaixo provam isso nos dois sentidos.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  VALIDADE_DO_LINK_SEGUNDOS,
  VALIDADE_DA_FOTO_SEGUNDOS,
  gerarTokenDeFoto,
  lerTokenDeFoto,
  gerarTokenDeMidia,
  lerTokenDeMidia,
} from "../lib/media-links.ts";

describe("Link da foto de perfil", () => {
  it("a validade do token cobre o `max-age` que a rota manda guardar", () => {
    // O `max-age` é lido da FONTE, e não copiado para cá: um teste que
    // repetisse o número passaria a concordar consigo mesmo e pararia de
    // vigiar a rota.
    const fonte = readFileSync(
      fileURLToPath(new URL("../routes/perfil.ts", import.meta.url)),
      "utf8",
    );

    const linha = fonte.match(/Cache-Control["'`],\s*`private, max-age=\$\{([A-Z_]+)\}`/);
    assert.ok(
      linha,
      "o Cache-Control da foto deixou de ser derivado de uma constante — se ele voltar a ser um número solto, esta regra deixa de ser verificável",
    );
    assert.equal(
      linha![1],
      "VALIDADE_DA_FOTO_SEGUNDOS",
      "o max-age tem que sair da MESMA constante que assina o token",
    );

    // E, por via das dúvidas, a relação que interessa dita por extenso.
    assert.ok(
      VALIDADE_DA_FOTO_SEGUNDOS >= 24 * 60 * 60,
      "a foto de perfil é remontada o tempo todo pela navegação; validade curta a faz sumir sozinha",
    );
  });

  it("a foto dura MAIS que a midia do mural — sao casos de uso diferentes", () => {
    // Não é o mesmo número por acidente: mídia do mural são muitas fotos, de
    // paciente, abertas uma vez. A de perfil é uma só, da própria pessoa, em
    // toda tela. Igualar as duas constantes é o erro que isto pega.
    assert.ok(
      VALIDADE_DA_FOTO_SEGUNDOS > VALIDADE_DO_LINK_SEGUNDOS,
      "se as duas ficarem iguais, ou a foto volta a sumir ou o link do mural fica longo demais",
    );
    assert.equal(VALIDADE_DO_LINK_SEGUNDOS, 600, "o link do mural continua curto");
  });

  it("um token de foto abre foto, e um token de midia NAO", () => {
    const daFoto = gerarTokenDeFoto(7);
    assert.equal(lerTokenDeFoto(daFoto), 7);
    assert.equal(
      lerTokenDeMidia(daFoto),
      null,
      "chave derivada própria (#116): um token de foto não pode abrir mídia",
    );
  });

  it("um token de midia NAO abre a foto do cuidador de mesmo id", () => {
    const { token } = gerarTokenDeMidia(7);
    assert.equal(lerTokenDeMidia(token), 7);
    assert.equal(
      lerTokenDeFoto(token),
      null,
      "sem separação de domínio, o asset 7 abriria a foto do cuidador 7",
    );
  });
});
