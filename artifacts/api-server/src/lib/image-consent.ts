/**
 * Consentimento de imagem — QUI-6.
 *
 * ── Por que é um tipo próprio, e não o consentimento de saúde ─────────────
 *
 * Quem aceitou compartilhar que a mãe toma Losartana **não aceitou, com
 * isso, que ela seja fotografada na cama**. São finalidades diferentes, e a
 * LGPD trata consentimento por finalidade. Reaproveitar o consentimento de
 * saúde "para simplificar" é o atalho que uma auditoria encontra.
 *
 * ── Estado atual sai de uma tabela que só cresce ──────────────────────────
 *
 * `consent_records` é imutável: revogar é um INSERT novo com
 * `consentGiven = "false"`, nunca um UPDATE. Então "há consentimento hoje?"
 * é sempre **o registro mais recente** daquele paciente para este tipo.
 *
 * O desempate é por `createdAt` e, em empate, por `id` — dois registros no
 * mesmo milissegundo existem (conceder e revogar em sequência num teste), e
 * sem o segundo critério a resposta seria não-determinística.
 *
 * ── O que este consentimento cobre, e o que não cobre ─────────────────────
 *
 * Cobre **imagem**: foto e vídeo. **Não cobre áudio.**
 *
 * Voz não é imagem. Um recado em áudio gravado pelo próprio paciente
 * (QUI-8) é ele se expressando, não ele sendo retratado — e exigir
 * consentimento de imagem para isso bloquearia, sem motivo, o único canal
 * que funciona para quem tem dificuldade visual ou motora.
 *
 * Está escrito assim no refinamento
 * (planning/refinamentos/momentos-historias.md, história 4). Se o produto
 * decidir exigir os dois um dia, tem que ser decisão explícita — não efeito
 * colateral de alguém "simplificar" este módulo.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "@workspace/db";
import { consentRecordsTable, type MediaAsset } from "@workspace/db";
import type { TipoDeMidia } from "./media-storage.ts";

export interface EstadoDoConsentimento {
  /** Há consentimento válido agora? */
  consentido: boolean;
  /** "self" (o próprio paciente) ou "legal_representative". Nulo se nunca houve registro. */
  givenBy: "self" | "legal_representative" | null;
  /** Versão do termo aceito. Nulo se nunca houve registro. */
  version: string | null;
  /** Quando o registro mais recente foi feito. Nulo se nunca houve registro. */
  registradoEm: Date | null;
  /** Já houve alguma decisão, mesmo que tenha sido revogar? */
  jaDecidido: boolean;
}

/** Tipos de mídia que este consentimento governa. Áudio NÃO está aqui — ver o cabeçalho. */
const TIPOS_QUE_EXIGEM_CONSENTIMENTO: ReadonlySet<TipoDeMidia> = new Set(["image", "video"]);

export function exigeConsentimentoDeImagem(tipo: TipoDeMidia): boolean {
  return TIPOS_QUE_EXIGEM_CONSENTIMENTO.has(tipo);
}

/** As mídias que uma revogação precisa apagar — as de imagem, não as de áudio. */
export function cobertaPeloConsentimento(midia: Pick<MediaAsset, "kind">): boolean {
  return exigeConsentimentoDeImagem(midia.kind);
}

export async function lerEstadoDoConsentimento(patientId: number): Promise<EstadoDoConsentimento> {
  const [ultimo] = await db
    .select({
      consentGiven: consentRecordsTable.consentGiven,
      givenBy: consentRecordsTable.givenBy,
      version: consentRecordsTable.version,
      createdAt: consentRecordsTable.createdAt,
    })
    .from(consentRecordsTable)
    .where(
      and(
        eq(consentRecordsTable.patientId, patientId),
        eq(consentRecordsTable.consentType, "image_capture")
      )
    )
    .orderBy(desc(consentRecordsTable.createdAt), desc(consentRecordsTable.id))
    .limit(1);

  if (!ultimo) {
    return { consentido: false, givenBy: null, version: null, registradoEm: null, jaDecidido: false };
  }

  return {
    consentido: ultimo.consentGiven === "true",
    givenBy: ultimo.givenBy,
    version: ultimo.version,
    registradoEm: ultimo.createdAt,
    jaDecidido: true,
  };
}

/**
 * Atalho para o guarda da rota de envio.
 *
 * Note que ausência de registro devolve `false`, não erro: **o padrão é NÃO
 * ter consentimento.** Nada de consentimento implícito por uso.
 */
export async function temConsentimentoDeImagem(patientId: number): Promise<boolean> {
  return (await lerEstadoDoConsentimento(patientId)).consentido;
}
