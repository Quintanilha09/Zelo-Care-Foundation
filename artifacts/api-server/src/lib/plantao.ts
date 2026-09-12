/**
 * De quem é a vez — Issue #177.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * ESTE ARQUIVO RESPONDE UMA PERGUNTA SÓ, E É O ÚNICO QUE A RESPONDE.
 *
 * "Quem está de plantão para este paciente neste instante?" A tela inicial
 * pergunta, o lembrete pergunta, a ficha pergunta. Três donos da mesma conta
 * é como eles um dia passam a discordar — e aí a tela diz que a vez é sua e
 * o aviso vai para outra pessoa.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── O que ele NUNCA faz ──────────────────────────────────────────────────
 *
 * Não filtra acesso. Não esconde paciente, dose ou tela. Não tira capacidade
 * de ninguém. A escala responde *de quem é a vez*, nunca *quem pode* — se um
 * dia ela virar filtro, uma família inteira perde o app numa noite em que
 * ninguém marcou plantão. É a regra da #120, e vale aqui inteira.
 *
 * ── Sem escala, `null` ───────────────────────────────────────────────────
 *
 * E `null` não é um estado de erro: é a esmagadora maioria das famílias. Quem
 * chama trata `null` como "continua como sempre foi" — o lembrete volta para
 * o cuidador principal, e a tela não mostra linha nenhuma.
 */
import { eq, and, or } from "drizzle-orm";
import { db } from "@workspace/db";
import { shiftsTable, caregiversTable } from "@workspace/db";
import { toLocalDateTime } from "@workspace/scheduling";

export interface DePlantao {
  caregiverId: number;
  caregiverName: string;
  userId: number | null;
  /** "HH:mm" — o começo do turno, no relógio do paciente. */
  startTime: string;
  endTime: string;
  /** true quando veio de uma troca pontual, e não da recorrência semanal. */
  troca: boolean;
}

/** "HH:mm" → minutos desde a meia-noite. */
function emMinutos(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

/**
 * O turno cobre este minuto do dia?
 *
 * ── O turno que vira a noite ─────────────────────────────────────────────
 *
 * 22:00 → 06:00 é o exemplo canônico de plantão, e nele `fim < inicio`. Aí o
 * turno cobre "das 22:00 até a meia-noite" **ou** "da meia-noite até as
 * 06:00" — e quem está de plantão às 02:00 é quem pegou o turno às 22:00 de
 * ONTEM.
 *
 * É por isso que a função recebe o minuto e não a data: a decisão de qual dia
 * civil consultar é de quem chama, que sabe se está olhando o turno de hoje
 * ou a ponta do de ontem.
 */
function cobre(minuto: number, inicio: string, fim: string): boolean {
  const de = emMinutos(inicio);
  const ate = emMinutos(fim);
  if (de <= ate) return minuto >= de && minuto <= ate;
  return minuto >= de || minuto <= ate;
}

/** O dia civil anterior a "YYYY-MM-DD", em UTC para não pular fuso. */
function ontem(dia: string): string {
  return new Date(Date.parse(`${dia}T00:00:00Z`) - 86_400_000).toISOString().slice(0, 10);
}

/** 0=domingo .. 6=sábado, do dia civil — sem passar pelo fuso do processo. */
function diaDaSemana(dia: string): number {
  return new Date(`${dia}T00:00:00Z`).getUTCDay();
}

/**
 * Quem está de plantão para este paciente agora.
 *
 * ── A ordem de precedência, e por que ela é essa ─────────────────────────
 *
 *   1. troca pontual de HOJE
 *   2. recorrência semanal de HOJE
 *   3. troca pontual de ONTEM que ainda não acabou (turno da noite)
 *   4. recorrência semanal de ONTEM que ainda não acabou
 *
 * A troca vence a recorrência porque foi o último combinado: quem escreveu
 * "este sábado eu troco com você" estava justamente dizendo que o sábado de
 * sempre não vale desta vez.
 *
 * O dia de hoje vence o de ontem porque um turno que começou hoje é mais
 * recente que a ponta de um que começou ontem. Na prática os dois raramente
 * se encavalam — quando se encavalam, vale quem entrou por último.
 */
export async function quemEstaDePlantao(
  patientId: number,
  timezone: string,
  agora: Date,
): Promise<DePlantao | null> {
  const { localDate, localTime } = toLocalDateTime(agora, timezone);
  const minuto = emMinutos(localTime);
  const diaDeOntem = ontem(localDate);

  const linhas = await db
    .select({
      caregiverId: shiftsTable.caregiverId,
      caregiverName: caregiversTable.name,
      userId: caregiversTable.userId,
      weekday: shiftsTable.weekday,
      onDate: shiftsTable.onDate,
      startTime: shiftsTable.startTime,
      endTime: shiftsTable.endTime,
    })
    .from(shiftsTable)
    .innerJoin(caregiversTable, eq(shiftsTable.caregiverId, caregiversTable.id))
    .where(and(
      eq(shiftsTable.patientId, patientId),
      or(
        eq(shiftsTable.onDate, localDate),
        eq(shiftsTable.onDate, diaDeOntem),
        eq(shiftsTable.weekday, diaDaSemana(localDate)),
        eq(shiftsTable.weekday, diaDaSemana(diaDeOntem)),
      ),
    ));

  if (linhas.length === 0) return null;

  const candidatos = [
    linhas.filter((l) => l.onDate === localDate),
    linhas.filter((l) => l.onDate === null && l.weekday === diaDaSemana(localDate)),
    // As duas listas de ontem só interessam quando o turno vira a noite: um
    // turno de ontem que terminou ontem mesmo (`inicio <= fim`) não alcança
    // hoje, e incluí-lo faria a pessoa de ontem aparecer como a da vez.
    linhas.filter((l) => l.onDate === diaDeOntem && emMinutos(l.endTime) < emMinutos(l.startTime)),
    linhas.filter(
      (l) =>
        l.onDate === null &&
        l.weekday === diaDaSemana(diaDeOntem) &&
        emMinutos(l.endTime) < emMinutos(l.startTime),
    ),
  ];

  for (const grupo of candidatos) {
    const achou = grupo.find((l) => cobre(minuto, l.startTime, l.endTime));
    if (achou) {
      return {
        caregiverId: achou.caregiverId,
        caregiverName: achou.caregiverName,
        userId: achou.userId,
        startTime: achou.startTime,
        endTime: achou.endTime,
        troca: achou.onDate !== null,
      };
    }
  }

  return null;
}
