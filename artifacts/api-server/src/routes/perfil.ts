/**
 * Foto de perfil do cuidador — Issue #116.
 *
 *   POST   /api/account/avatar          troca a própria foto
 *   DELETE /api/account/avatar          remove a própria foto
 *   GET    /api/caregivers/foto/:token  serve os bytes
 *
 * ── Por que não reaproveitar o /api/media ────────────────────────────────
 *
 * A infraestrutura de mídia é toda amarrada a **paciente + consentimento de
 * imagem + expiração de 90 dias**. A foto de um cuidador não tem nenhuma das
 * três: não há consentimento a pedir de quem posta o próprio rosto, ela não
 * expira, e não é do mural de ninguém. Entrar como `media_asset` traria junto
 * o portão de consentimento e o job de expurgo, e os dois estariam errados.
 *
 * O que ela **reaproveita** é a camada de armazenamento (`media-storage.ts`),
 * o teto do multer (`receber-arquivo.ts`) e o desenho do link assinado
 * (`media-links.ts`). Os bytes vivem no mesmo bucket privado.
 *
 * ── Por que o link é assinado, e não `requireAuth` ───────────────────────
 *
 * Porque **`<img src>` não manda header nenhum**. Uma rota de imagem atrás de
 * `Authorization: Bearer` não renderiza numa tag `<img>` — é o mesmo problema
 * que a QUI-5 encontrou, e está escrito por extenso no `media-links.ts`.
 *
 * Quem autoriza é a rota que **emite** o link: `GET /caregivers` e
 * `/account/me` só devolvem a URL de quem é da família de quem perguntou. O
 * token carrega o id e a validade, vale 10 minutos, e é assinado com uma
 * chave derivada própria — um token de mídia não abre foto de perfil.
 */

import { Router } from "express";
import { eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { usersTable, caregiversTable } from "@workspace/db";
import { requireAuth } from "../middleware/require-auth";
import { receberArquivo } from "../middleware/receber-arquivo.ts";
import { getAuth } from "../lib/auth-types.ts";
import { obterArmazenamento, novaChaveDeObjeto } from "../lib/media-storage.ts";
import { mediaUploadLimiter, mediaContentLimiter } from "../lib/rate-limit";
import { safeLog } from "../lib/safe-logger";
import { audit } from "../lib/audit";
import { Clock } from "../lib/clock";
import { gerarTokenDeFoto, lerTokenDeFoto } from "../lib/media-links.ts";

const router = Router();

/**
 * Só imagem, e só os três formatos que o navegador comprime no aparelho.
 *
 * Sem SVG de propósito: SVG é documento executável, e servir um do mesmo
 * domínio é XSS armado — mesmo com `nosniff`.
 */
const TIPOS_DE_FOTO = new Set(["image/jpeg", "image/png", "image/webp"]);

/**
 * Teto de 2 MB, bem abaixo do teto de mídia.
 *
 * A compressão acontece no aparelho, como em todo o resto da mídia do ZELO —
 * uma foto de rosto comprimida não chega perto disto. O teto existe para o
 * caso de alguém pular o cliente, e é apertado porque **não há razão** para
 * uma foto de perfil ser grande.
 */
const TETO_DA_FOTO = 2 * 1024 * 1024;

/**
 * A URL que a tela usa, ou `null` quando a pessoa não tem foto.
 *
 * ── Por que um token na URL, e não `requireAuth` ─────────────────────────
 *
 * `<img src="...">` **não manda header nenhum**. Uma rota de imagem atrás de
 * `Authorization: Bearer` simplesmente não renderiza numa tag `<img>` — é o
 * mesmo problema que a QUI-5 resolveu para a mídia do mural, e a solução é a
 * mesma: um link curto e assinado, sem estado, que expira em 10 minutos.
 *
 * O token é assinado com uma chave **própria** (ver `media-links.ts`): um
 * token de mídia não abre foto de perfil, e vice-versa.
 *
 * Como o token muda a cada leitura, ele também resolve o cache sozinho — não
 * há URL estável para o navegador servir desatualizada depois de uma troca.
 */
export function urlDaFoto(caregiverId: number, chave: string | null): string | null {
  if (!chave) return null;
  return `/api/caregivers/foto/${gerarTokenDeFoto(caregiverId)}`;
}

// ── Trocar a própria foto ─────────────────────────────────────────────────

router.post(
  "/account/avatar",
  requireAuth,
  mediaUploadLimiter,
  receberArquivo,
  async (req, res): Promise<void> => {
    if (!req.file) {
      res.status(400).json({ error: "Envie uma imagem JPEG, PNG ou WebP.", code: "FOTO_AUSENTE" });
      return;
    }

    if (!TIPOS_DE_FOTO.has(req.file.mimetype)) {
      res.status(415).json({
        error: "A foto precisa ser JPEG, PNG ou WebP.",
        code: "FOTO_TIPO_INVALIDO",
      });
      return;
    }

    if (req.file.size > TETO_DA_FOTO) {
      res.status(413).json({
        error: "A foto pode ter até 2 MB. Escolha outra, ou tire uma nova.",
        code: "FOTO_GRANDE_DEMAIS",
      });
      return;
    }

    const armazenamento = obterArmazenamento();
    if (!armazenamento) {
      res.status(503).json({
        error: "Não é possível guardar a foto agora.",
        code: "ARMAZENAMENTO_INDISPONIVEL",
      });
      return;
    }

    const userId = getAuth(req).userId;
    const [antes] = await db
      .select({ chave: usersTable.avatarObjectKey })
      .from(usersTable)
      .where(eq(usersTable.id, userId))
      .limit(1);

    if (!antes) {
      res.status(404).json({ error: "Conta não encontrada" });
      return;
    }

    // ORDEM: grava o novo, aponta para ele, e só então apaga o antigo. Se
    // apagasse primeiro e a gravação falhasse, a pessoa ficaria sem foto
    // nenhuma — perdendo o que tinha por causa de uma troca que não
    // aconteceu.
    const chaveNova = novaChaveDeObjeto("image");
    try {
      await armazenamento.guardar(chaveNova, req.file.buffer, req.file.mimetype);
    } catch (err) {
      safeLog.error({ action: "avatar_guardar_falhou", err }, "Falha ao gravar a foto de perfil");
      res.status(502).json({ error: "Não conseguimos guardar a foto. Tente de novo.", code: "FOTO_FALHOU" });
      return;
    }

    await db
      .update(usersTable)
      .set({ avatarObjectKey: chaveNova, updatedAt: Clock.now() })
      .where(eq(usersTable.id, userId));

    if (antes.chave) {
      // Falhar aqui deixa um objeto órfão, e isso é melhor que devolver erro
      // numa troca que já deu certo do ponto de vista de quem trocou.
      try {
        await armazenamento.apagar(antes.chave);
      } catch (err) {
        safeLog.warn({ action: "avatar_antigo_orfao", err }, "Foto antiga nao pode ser apagada");
      }
    }

    await audit({
      familyId: getAuth(req).familyId,
      entityType: "user",
      entityId: String(userId),
      action: "updated",
      actorType: "caregiver",
      actorId: String(getAuth(req).caregiverId),
    });

    res.status(201).json({ fotoUrl: urlDaFoto(getAuth(req).caregiverId, chaveNova) });
  },
);

// ── Remover a própria foto ────────────────────────────────────────────────

router.delete("/account/avatar", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  const [atual] = await db
    .select({ chave: usersTable.avatarObjectKey })
    .from(usersTable)
    .where(eq(usersTable.id, userId))
    .limit(1);

  if (!atual) {
    res.status(404).json({ error: "Conta não encontrada" });
    return;
  }

  // Limpa a coluna primeiro: o que importa para quem pediu é a foto sumir da
  // tela. Objeto órfão é custo; foto que continua aparecendo é o pedido
  // ignorado.
  await db
    .update(usersTable)
    .set({ avatarObjectKey: null, updatedAt: Clock.now() })
    .where(eq(usersTable.id, userId));

  if (atual.chave) {
    const armazenamento = obterArmazenamento();
    try {
      await armazenamento?.apagar(atual.chave);
    } catch (err) {
      safeLog.warn({ action: "avatar_apagar_orfao", err }, "Foto removida da conta mas nao do armazenamento");
    }
  }

  await audit({
    familyId: getAuth(req).familyId,
    entityType: "user",
    entityId: String(userId),
    action: "updated",
    actorType: "caregiver",
    actorId: String(getAuth(req).caregiverId),
  });

  res.status(204).end();
});

// ── Servir os bytes ───────────────────────────────────────────────────────

/**
 * Declarada com o segmento literal `foto` ANTES do parâmetro, e montada antes
 * do `caregiversRouter` — a armadilha que engoliu `/patients/today-summary`
 * uma vez. Sem isso, `/caregivers/:caregiverId/resgate` poderia capturar esta.
 *
 * **Sem `requireAuth` de propósito:** o token É a autorização, porque `<img>`
 * não manda header. Quem tem o token já passou por uma rota autenticada que
 * o emitiu — mesmo modelo do `/media/content/:token`.
 */
router.get<{ token: string }>(
  "/caregivers/foto/:token",
  mediaContentLimiter,
  async (req, res): Promise<void> => {
    const id = lerTokenDeFoto(req.params.token);
    if (id === null) {
      // 410, e não 404: o link existiu e venceu. É o mesmo código que a
      // mídia usa, e diz à tela que recarregar a lista resolve.
      res.status(410).json({ error: "Link expirado ou inválido" });
      return;
    }

    const [linha] = await db
      .select({ chave: usersTable.avatarObjectKey })
      .from(caregiversTable)
      .innerJoin(usersTable, eq(usersTable.id, caregiversTable.userId))
      .where(eq(caregiversTable.id, id))
      .limit(1);

    if (!linha?.chave) {
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    const armazenamento = obterArmazenamento();
    const bytes = armazenamento ? await armazenamento.ler(linha.chave) : null;
    if (!bytes) {
      safeLog.error({ action: "avatar_objeto_ausente" }, "Conta aponta para foto que nao existe no armazenamento");
      res.status(404).json({ error: "Recurso não encontrado" });
      return;
    }

    // O tipo não é guardado, e não precisa ser: os três formatos aceitos são
    // detectáveis pelos primeiros bytes, e `nosniff` impede o navegador de
    // reinterpretar o que a gente declarar.
    const tipo = bytes[0] === 0x89 ? "image/png" : bytes[0] === 0x52 ? "image/webp" : "image/jpeg";

    res.setHeader("Content-Type", tipo);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Content-Disposition", "inline");
    // `private`: nunca em cache compartilhado — é rosto de pessoa, dentro de
    // uma família. O `v` da URL é quem invalida quando a foto troca, então o
    // cache do navegador pode ser longo sem servir imagem velha.
    res.setHeader("Cache-Control", "private, max-age=86400");
    res.send(bytes);
  },
);

export default router;
