/**
 * Utilitários de fuso — ZELO (ZELO-19).
 *
 * Complementam expandSchedule: aqui não é sobre GERAR o horário, é sobre
 * REPRESENTAR e DELIMITAR no fuso do paciente um instante UTC já calculado.
 * Mesma regra de sempre: nunca ler o fuso do processo (Date.getHours() etc.),
 * sempre receber o fuso IANA do paciente como parâmetro explícito.
 */
import { DateTime } from "luxon";

/**
 * Deriva a data e hora civis (no fuso do paciente) de um instante UTC já
 * resolvido. Usado para popular scheduled_local_date/scheduled_local_time —
 * a intenção do usuário ("8:00"), imune a uma futura mudança de regra de
 * fuso, guardada ao lado do scheduled_at (UTC, usado pela fila).
 *
 * Deriva DEPOIS da conversão (não antes) de propósito: se o instante caiu
 * numa hora inexistente por DST (spring-forward), expandSchedule já
 * deslizou para o instante válido mais próximo — o local aqui reflete o
 * horário real que vai disparar, não a intenção original que nunca existiu.
 */
export function toLocalDateTime(utc: Date, zone: string): { localDate: string; localTime: string } {
  const dt = DateTime.fromJSDate(utc, { zone });
  return { localDate: dt.toISODate()!, localTime: dt.toFormat("HH:mm") };
}

/**
 * Início e fim do dia civil `dateISO` no fuso do paciente, como instantes
 * UTC — para consultas de intervalo (ex: "doses de hoje"). Nunca construa
 * isso com `new Date(`${dateISO}T00:00:00`)`: uma string ISO de data+hora
 * SEM offset é interpretada pelo motor JS no fuso do PROCESSO, não no do
 * paciente — o resultado mudaria conforme o TZ do servidor, exatamente o
 * bug que ZELO-19 existe para eliminar.
 */
export function localDayBoundsUtc(dateISO: string, zone: string): { start: Date; end: Date } {
  const day = DateTime.fromISO(dateISO, { zone });
  return { start: day.startOf("day").toJSDate(), end: day.endOf("day").toJSDate() };
}
