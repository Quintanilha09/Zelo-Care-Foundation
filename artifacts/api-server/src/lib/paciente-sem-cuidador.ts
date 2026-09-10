/**
 * Aviso de paciente sem cuidador responsável — Issue #123.
 *
 * Pedido do fundador em 08/09/2026: *"se chegar um novo paciente e eu como
 * instituição esquecer de vincular um cuidador a ele … isso é grave."*
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ISTO AVISA. NÃO BLOQUEIA, E NÃO É AUTORIZAÇÃO.
 *
 * Paciente sem responsável continua funcionando por inteiro: todo cuidador
 * da família vê e registra dose dele, igual a antes. O e-mail diz "falta
 * apontar alguém", e o próprio texto dele repete isso — senão quem recebe
 * supõe que o app travou o paciente, e agir com base nessa suposição é pior
 * que não ter recebido aviso nenhum.
 * ══════════════════════════════════════════════════════════════════════════
 *
 * ── Este job é o dono do relógio, e as rotas não ─────────────────────────
 *
 * As duas colunas em `patients` (`uncovered_since`, `uncovered_alert_sent_at`)
 * são escritas **só daqui**. O motivo está no schema: o vínculo também some
 * por **cascata** — apagar um cuidador leva as linhas de `caregiver_patients`
 * junto, sem passar por rota nenhuma. Um gatilho na rota de desvincular
 * deixaria esse caminho com o relógio parado para sempre.
 *
 * Aqui o estado real é lido inteiro todo dia, e reescrito.
 *
 * ── Invariante 3, e onde ele vale ────────────────────────────────────────
 *
 * O nome do paciente vai **no e-mail** e nunca **no log**. São coisas
 * diferentes: o e-mail é para quem já cuida daquela pessoa; o log é lido por
 * quem opera o sistema. Por isso todo `safeLog` daqui carrega só contagem —
 * `patientId` nem está na allowlist, e não deve estar.
 */

import { and, eq, inArray, isNull, lte } from "drizzle-orm";
import { db } from "@workspace/db";
import { patientsTable, caregiverPatientsTable, caregiversTable, usersTable } from "@workspace/db";
import { Clock } from "./clock.ts";
import { safeLog } from "./safe-logger.ts";
import { sendPacienteSemCuidadorEmail } from "./email.ts";

/**
 * Quantos dias sem ninguém apontado até o aviso sair.
 *
 * Constante, e não configuração: a Issue #123 pediu explicitamente que não
 * fosse ajustável nesta história. Trocar é esta linha.
 */
export const DIAS_ATE_O_AVISO = 2;

const UM_DIA_MS = 86_400_000;

export interface ResumoDoAviso {
  /** Famílias que receberam um e-mail nesta execução. */
  familiasAvisadas: number;
  /** Pacientes citados nesses e-mails. */
  pacientesAvisados: number;
  /** Pacientes que voltaram a ter responsável e tiveram o relógio zerado. */
  relogiosZerados: number;
}

interface Descoberto {
  id: number;
  familyId: number;
  name: string;
  uncoveredSince: Date;
}

/**
 * Roda uma vez por dia, pela fila (`QUEUE_PACIENTE_SEM_CUIDADOR`).
 *
 * Nunca lança: é um job de manutenção, e uma família com e-mail inválido não
 * pode impedir o aviso das outras.
 */
export async function avisarPacientesSemCuidador(): Promise<ResumoDoAviso> {
  const agora = Clock.now();

  // ── 1. Quem está coberto tem o relógio zerado ───────────────────────────
  //
  // Passo primeiro de propósito: é o que faz o aviso poder acontecer de novo
  // depois, e o que conserta sozinho o estado de um paciente cujo vínculo
  // sumiu e voltou entre duas execuções.
  const zerados = await db
    .update(patientsTable)
    .set({ uncoveredSince: agora, uncoveredAlertSentAt: null })
    .where(
      and(
        eq(patientsTable.archived, false),
        inArray(
          patientsTable.id,
          db.selectDistinct({ id: caregiverPatientsTable.patientId }).from(caregiverPatientsTable),
        ),
      ),
    )
    .returning({ id: patientsTable.id });

  // ── 2. Quem está descoberto há tempo demais, e ainda não foi avisado ────
  //
  // Anti-join: `leftJoin` + `isNull` na chave do vínculo é "paciente sem
  // nenhuma linha em caregiver_patients". Arquivado fica de fora — arquivar
  // é justamente parar de acompanhar aquela pessoa.
  const corte = new Date(agora.getTime() - DIAS_ATE_O_AVISO * UM_DIA_MS);

  const descobertos: Descoberto[] = await db
    .select({
      id: patientsTable.id,
      familyId: patientsTable.familyId,
      name: patientsTable.name,
      uncoveredSince: patientsTable.uncoveredSince,
    })
    .from(patientsTable)
    .leftJoin(caregiverPatientsTable, eq(caregiverPatientsTable.patientId, patientsTable.id))
    .where(
      and(
        eq(patientsTable.archived, false),
        isNull(caregiverPatientsTable.id),
        isNull(patientsTable.uncoveredAlertSentAt),
        lte(patientsTable.uncoveredSince, corte),
      ),
    )
    .orderBy(patientsTable.familyId, patientsTable.name);

  if (descobertos.length === 0) {
    return { familiasAvisadas: 0, pacientesAvisados: 0, relogiosZerados: zerados.length };
  }

  // ── 3. Um e-mail por família, nunca um por paciente ─────────────────────
  //
  // Três pacientes descobertos na mesma casa são um problema só, e três
  // e-mails seguidos sobre o mesmo problema é o começo de uma regra de
  // filtro na caixa de entrada.
  const porFamilia = new Map<number, Descoberto[]>();
  for (const p of descobertos) {
    const lista = porFamilia.get(p.familyId) ?? [];
    lista.push(p);
    porFamilia.set(p.familyId, lista);
  }

  let familiasAvisadas = 0;
  const avisados: number[] = [];

  for (const [familyId, pacientes] of porFamilia) {
    const destino = await emailDoPrincipal(familyId);
    if (!destino) {
      // Família sem cuidador principal com e-mail é um estado estranho, e a
      // resposta certa é registrar e seguir — não travar o aviso das outras.
      safeLog.warn(
        { action: "aviso_sem_cuidador_sem_destino", familyId, count: pacientes.length },
        "Familia sem endereco de cuidador principal para o aviso",
      );
      continue;
    }

    const aceito = await sendPacienteSemCuidadorEmail(
      destino,
      pacientes.map((p) => ({ nome: p.name, dias: diasDescoberto(p.uncoveredSince, agora) })),
    );

    // Marcar só quando o provedor aceitou. Marcar antes silenciaria o aviso
    // para sempre num dia em que o e-mail simplesmente não saiu — e é
    // exatamente o que acontece em desenvolvimento, onde não há provedor.
    if (!aceito) continue;

    familiasAvisadas += 1;
    for (const p of pacientes) avisados.push(p.id);
  }

  if (avisados.length > 0) {
    await db
      .update(patientsTable)
      .set({ uncoveredAlertSentAt: agora })
      .where(inArray(patientsTable.id, avisados));
  }

  safeLog.info(
    {
      action: "aviso_sem_cuidador",
      count: avisados.length,
      total: descobertos.length,
    },
    "Aviso de paciente sem cuidador processado",
  );

  return {
    familiasAvisadas,
    pacientesAvisados: avisados.length,
    relogiosZerados: zerados.length,
  };
}

/** Dias inteiros desde que o paciente ficou descoberto. */
function diasDescoberto(desde: Date, agora: Date): number {
  return Math.floor((agora.getTime() - desde.getTime()) / UM_DIA_MS);
}

/**
 * O endereço do cuidador principal da família.
 *
 * Só o principal, e a Issue foi explícita: espalhar aviso operacional para
 * quem não pode resolver é ruído. Vincular é ação de cuidador principal, então
 * é ele quem recebe o pedido de vincular.
 *
 * `users.email` primeiro: é o endereço com que a pessoa entra, e é o que
 * existe com certeza. `caregivers.email` é o do convite, que pode ter sido
 * digitado errado por quem convidou e nunca corrigido.
 */
async function emailDoPrincipal(familyId: number): Promise<string | null> {
  const [linha] = await db
    .select({
      emailDoUsuario: usersTable.email,
      emailDoCuidador: caregiversTable.email,
    })
    .from(caregiversTable)
    .leftJoin(usersTable, eq(usersTable.id, caregiversTable.userId))
    .where(
      and(
        eq(caregiversTable.familyId, familyId),
        eq(caregiversTable.role, "primary_caregiver"),
      ),
    )
    .orderBy(caregiversTable.id)
    .limit(1);

  if (!linha) return null;
  return linha.emailDoUsuario ?? linha.emailDoCuidador ?? null;
}
