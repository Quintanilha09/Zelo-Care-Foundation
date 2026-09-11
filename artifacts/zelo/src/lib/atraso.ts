/**
 * Quando uma dose passou da hora — Issue #153.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * "PENDENTE" E "ATRASADO" SÃO ESTADOS DIFERENTES.
 *
 * Uma dose pendente não pede nada de ninguém. Uma atrasada pede ação agora.
 * Até 11/09/2026 o app chamava as duas de "Pendente" — apagando a única
 * distinção que ele existe para mostrar.
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * ── Por que a tela decide isto, e não o banco ────────────────────────────
 *
 * O status `late` do banco é decidido por um job: carência de 30 minutos mais
 * um cron a cada 15. Somando, **uma dose atrasada podia parecer "Pendente"
 * por até 45 minutos** — foi o que o fundador fotografou às 09:58, com uma
 * dose das 09:00.
 *
 * O servidor manda `atrasadaApartirDe`, um instante pronto. A tela compara com
 * o relógio dela e acerta na hora.
 *
 * **O `late` do banco continua valendo** para a cascata de lembretes, o
 * relatório de adesão e o histórico. O que mudou é só a exibição.
 */

/** A dose já passou da carência? */
export function estaAtrasada(
  atrasadaApartirDe: string | null | undefined,
  agora: number,
): boolean {
  if (!atrasadaApartirDe) return false;
  const limite = new Date(atrasadaApartirDe).getTime();
  return Number.isFinite(limite) && agora > limite;
}

/**
 * Há quanto tempo a dose devia ter sido dada — a partir do horário AGENDADO,
 * não do fim da carência.
 *
 * A carência existe para o app não cobrar cedo demais; ela não muda a hora que
 * a pessoa combinou com o médico. Contar dali diria "há 28 minutos" para uma
 * dose de uma hora atrás, e quem lê sabe que não é verdade.
 *
 * ── Por que não "há 1h 3min" ─────────────────────────────────────────────
 *
 * Precisão que ninguém usa. O que muda a decisão de quem cuida é a ordem de
 * grandeza — minutos, horas, ontem —, e frase curta se lê de relance, que é
 * como esta tela é lida.
 */
export function textoDoAtraso(scheduledAt: string, agora: number): string {
  const minutos = Math.floor((agora - new Date(scheduledAt).getTime()) / 60_000);
  if (!Number.isFinite(minutos) || minutos < 1) return "agora há pouco";
  if (minutos < 60) return `há ${minutos} ${minutos === 1 ? "minuto" : "minutos"}`;

  const horas = Math.floor(minutos / 60);
  if (horas < 24) return `há ${horas} ${horas === 1 ? "hora" : "horas"}`;

  const dias = Math.floor(horas / 24);
  return dias === 1 ? "desde ontem" : `há ${dias} dias`;
}
