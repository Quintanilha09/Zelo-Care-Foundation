/**
 * Aviso de momento novo — QUI-10 (projeto ZELO — Momentos).
 *
 * ── O que este arquivo existe para garantir ───────────────────────────────
 *
 * **O texto do aviso nunca carrega o conteúdo do momento.** Nem a legenda da
 * foto, nem o que a pessoa falou no recado, nem nome de medicamento. O aviso
 * diz que **existe** algo novo e quem publicou — nada mais.
 *
 * Isso não é preciosismo. Uma notificação aparece na tela bloqueada do
 * celular, onde qualquer um que passe por perto lê. "Dona Maria mandou um
 * recado" não expõe ninguém; a transcrição do recado exporia (CON-008,
 * CON-009).
 *
 * A construção do texto é por TEMPLATE FIXO, e é de propósito: não existe
 * caminho no código onde a legenda entre por interpolação. É a mesma
 * disciplina do feed de atividade (Issue #13).
 *
 * ── Quando o aviso NÃO sai ────────────────────────────────────────────────
 *
 *   1. para quem publicou. Ninguém precisa ser avisado do próprio gesto;
 *   2. para quem desligou a categoria "moment" desse paciente;
 *   3. durante o silêncio noturno da família (ZELO-30);
 *   4. para cuidador sem conta vinculada — convite pendente não tem aparelho.
 *
 * ── Por que o silêncio noturno CANCELA em vez de adiar ────────────────────
 *
 * Adiar exigiria fila, e fila exigiria decidir o que fazer quando cinco fotos
 * chegam de madrugada — mandar cinco avisos às 7h é pior que não mandar
 * nenhum. **A foto continua no mural de manhã.** Um momento não é uma dose:
 * perder o aviso não custa nada a ninguém, e é por isso que a resposta certa
 * aqui é simplesmente não enviar.
 *
 * ── Falhar aqui não pode derrubar a publicação ────────────────────────────
 *
 * Quem chama já gravou o objeto e a linha do catálogo. Se o push falhar, a
 * foto **continua publicada** — quem enviou fez o que queria fazer. Por isso
 * nada aqui lança para fora.
 */
import { and, eq, isNull, or } from "drizzle-orm";
import { db } from "@workspace/db";
import {
  mediaAssetsTable, patientsTable, caregiversTable, familiesTable,
  notificationsTable, notificationPreferencesTable,
} from "@workspace/db";
import { Clock } from "./clock.ts";
import { sendPushToUser } from "./push.ts";
import { estaEmSilencioNoturno } from "./silencio-noturno.ts";
import { safeLog } from "./safe-logger.ts";

/**
 * O texto do aviso. **Template fixo, sempre.**
 *
 * `kind` decide a frase porque um recado de voz e uma foto são gestos
 * diferentes, e a frase certa muda quem se sente convidado a abrir. O que
 * NÃO muda é o que entra: nome de quem publicou, nome do paciente, e nada
 * mais. `caption` não é parâmetro desta função de propósito — não dá para
 * vazar o que não se recebe.
 */
export function textoDoAviso(
  kind: "image" | "video" | "audio",
  nomeDoPaciente: string,
  nomeDeQuemPublicou: string | null
): string {
  // Autor nulo = o próprio paciente publicou, do aparelho dele (QUI-8).
  if (nomeDeQuemPublicou === null) {
    return kind === "audio"
      ? `${nomeDoPaciente} mandou um recado.`
      : `${nomeDoPaciente} compartilhou um momento.`;
  }

  if (kind === "audio") return `${nomeDeQuemPublicou} publicou um recado de ${nomeDoPaciente}.`;
  if (kind === "video") return `${nomeDeQuemPublicou} publicou um vídeo de ${nomeDoPaciente}.`;
  return `${nomeDeQuemPublicou} publicou uma foto de ${nomeDoPaciente}.`;
}

interface Contexto {
  familyId: number;
  patientId: number;
  nomeDoPaciente: string;
  fuso: string;
  kind: "image" | "video" | "audio";
  autorCaregiverId: number | null;
  nomeDoAutor: string | null;
  silencio: { quietHoursEnabled: boolean; quietHoursStart: string; quietHoursEnd: string };
}

async function carregarContexto(mediaAssetId: number): Promise<Contexto | null> {
  const [linha] = await db
    .select({
      familyId: mediaAssetsTable.familyId,
      patientId: mediaAssetsTable.patientId,
      kind: mediaAssetsTable.kind,
      autorCaregiverId: mediaAssetsTable.uploadedByCaregiverId,
      nomeDoPaciente: patientsTable.name,
      fuso: patientsTable.timezone,
      quietHoursEnabled: familiesTable.quietHoursEnabled,
      quietHoursStart: familiesTable.quietHoursStart,
      quietHoursEnd: familiesTable.quietHoursEnd,
    })
    .from(mediaAssetsTable)
    .innerJoin(patientsTable, eq(patientsTable.id, mediaAssetsTable.patientId))
    .innerJoin(familiesTable, eq(familiesTable.id, mediaAssetsTable.familyId))
    .where(eq(mediaAssetsTable.id, mediaAssetId))
    .limit(1);

  if (!linha) return null;

  let nomeDoAutor: string | null = null;
  if (linha.autorCaregiverId !== null) {
    const [autor] = await db
      .select({ name: caregiversTable.name })
      .from(caregiversTable)
      .where(eq(caregiversTable.id, linha.autorCaregiverId))
      .limit(1);
    nomeDoAutor = autor?.name ?? null;
  }

  return {
    familyId: linha.familyId,
    patientId: linha.patientId,
    nomeDoPaciente: linha.nomeDoPaciente,
    fuso: linha.fuso,
    kind: linha.kind as "image" | "video" | "audio",
    autorCaregiverId: linha.autorCaregiverId,
    nomeDoAutor,
    silencio: {
      quietHoursEnabled: linha.quietHoursEnabled,
      quietHoursStart: linha.quietHoursStart,
      quietHoursEnd: linha.quietHoursEnd,
    },
  };
}

/**
 * Quem recebe: todo cuidador da família, menos quem publicou, menos quem
 * desligou a categoria "moment" para este paciente.
 *
 * Ausência de linha em `notification_preferences` significa ATIVADO — é o
 * padrão do projeto desde a ZELO-26, e por isso o join é `left` com
 * `isNull(enabled) OR enabled`.
 *
 * **Observador entra.** Diferente da cascata de dose, que filtra por
 * capacidade de registrar, ver a mãe não exige poder nenhum — é justamente
 * o parente distante, que só observa, quem mais precisa deste aviso.
 */
async function destinatarios(
  ctx: Contexto
): Promise<Array<{ caregiverId: number; userId: number | null }>> {
  const linhas = await db
    .select({ caregiverId: caregiversTable.id, userId: caregiversTable.userId })
    .from(caregiversTable)
    .leftJoin(
      notificationPreferencesTable,
      and(
        eq(notificationPreferencesTable.caregiverId, caregiversTable.id),
        eq(notificationPreferencesTable.patientId, ctx.patientId),
        eq(notificationPreferencesTable.category, "moment")
      )
    )
    .where(
      and(
        eq(caregiversTable.familyId, ctx.familyId),
        or(isNull(notificationPreferencesTable.enabled), eq(notificationPreferencesTable.enabled, true))
      )
    );

  return linhas.filter((l) => l.caregiverId !== ctx.autorCaregiverId);
}

export interface ResultadoDoAviso {
  enviados: number;
  /** Por que ninguém foi avisado, quando ninguém foi. Só para diagnóstico. */
  motivo?: "midia_inexistente" | "silencio_noturno" | "sem_destinatario";
}

/**
 * Avisa a família que há momento novo. **Nunca lança.**
 */
export async function avisarMomentoNovo(mediaAssetId: number): Promise<ResultadoDoAviso> {
  try {
    const ctx = await carregarContexto(mediaAssetId);
    if (!ctx) return { enviados: 0, motivo: "midia_inexistente" };

    if (estaEmSilencioNoturno(ctx.fuso, ctx.silencio)) {
      return { enviados: 0, motivo: "silencio_noturno" };
    }

    const alvos = await destinatarios(ctx);
    if (alvos.length === 0) return { enviados: 0, motivo: "sem_destinatario" };

    const corpo = textoDoAviso(ctx.kind, ctx.nomeDoPaciente, ctx.nomeDoAutor);
    let enviados = 0;

    for (const alvo of alvos) {
      // Cuidador convidado que ainda não criou conta não tem aparelho para
      // receber. A linha em `notifications` também não faz sentido: ela é o
      // registro de um envio, e não houve envio nenhum.
      if (!alvo.userId) continue;

      const [notificacao] = await db
        .insert(notificationsTable)
        .values({
          familyId: ctx.familyId,
          patientId: ctx.patientId,
          caregiverId: alvo.caregiverId,
          type: "moment_new",
          title: "ZELO",
          body: corpo,
          sentAt: Clock.now(),
        })
        .returning({ id: notificationsTable.id });

      const resultado = await sendPushToUser(alvo.userId, {
        title: "ZELO",
        body: corpo,
        // `tag` por paciente: cinco fotos seguidas viram UM aviso na tela,
        // não cinco. O celular substitui a notificação anterior de mesma tag.
        tag: `momento-${ctx.patientId}`,
        url: `/pacientes/${ctx.patientId}`,
        patientId: ctx.patientId,
        notificationId: notificacao.id,
      });
      if (resultado.sent > 0) enviados++;
    }

    return { enviados };
  } catch (err) {
    // Publicar já deu certo. O aviso é o extra, e o extra não derruba o
    // principal — quem enviou a foto fez o que queria fazer.
    safeLog.error({ action: "momento_aviso_failed", err }, "Falha ao avisar momento novo");
    return { enviados: 0 };
  }
}
