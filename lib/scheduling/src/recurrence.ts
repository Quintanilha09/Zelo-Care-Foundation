/**
 * Motor de recorrência — ZELO.
 *
 * Função pura: mesma entrada, mesma saída, sempre. Sem banco, sem rede, sem
 * relógio do sistema (o instante "agora" nunca entra aqui — quem chama passa
 * a janela [windowStart, windowEnd) explicitamente). Isso existe para poder
 * ser testada exaustivamente em milissegundos, em vez de depurada dentro do
 * sistema inteiro.
 *
 * Regra de fuso que importa mais que qualquer outra: a dose das 8h é 8h no
 * RELÓGIO DE PAREDE DO PACIENTE, não em UTC absoluto. Por isso os padrões de
 * calendário (times_per_day, specific_weekdays, alternate_days,
 * cycle_with_pause) constroem a data e hora LOCAL primeiro e só depois
 * convertem para o instante UTC — o Luxon preserva "8:00" mesmo atravessando
 * uma virada de horário de verão, ainda que o dia civil tenha tido 23 ou 25
 * horas reais.
 *
 * every_n_hours é a exceção deliberada: "a cada 8 horas" é sobre o efeito
 * farmacológico, não sobre o relógio da parede — usa duração real (exact
 * duration), então DST nunca desloca o intervalo entre doses.
 */

import { DateTime, Interval } from "luxon";
import type { RecurrenceInput, TimeOfDay } from "./types.ts";

function parseTimeOfDay(t: TimeOfDay): { hour: number; minute: number } {
  const [hour, minute] = t.split(":").map(Number);
  return { hour, minute };
}

/** Constrói o instante UTC para uma data civil + hora, no fuso dado. */
export function localToUtc(dateISO: string, time: TimeOfDay, zone: string): Date {
  const { hour, minute } = parseTimeOfDay(time);
  const [year, month, day] = dateISO.split("-").map(Number);
  const dt = DateTime.fromObject({ year, month, day, hour, minute }, { zone });
  // dt.isValid é false só em erro de construção grosseiro (fuso inválido etc.);
  // hora inexistente por DST é normalizada automaticamente pelo Luxon (avança
  // para o próximo instante válido) — é o comportamento que queremos: a dose
  // não desaparece, só desliza para o instante mais próximo que existe.
  return dt.toJSDate();
}

function* eachDate(startISO: string, endISO: string): Generator<string> {
  let d = DateTime.fromISO(startISO);
  const end = DateTime.fromISO(endISO);
  while (d <= end) {
    yield d.toISODate()!;
    d = d.plus({ days: 1 }); // dia CIVIL — 23/24/25h reais conforme DST, de propósito
  }
}

function clampWindow(
  input: RecurrenceInput,
  windowStart: Date,
  windowEnd: Date
): { startISO: string; endISO: string } | null {
  if (windowEnd <= windowStart) return null;

  const zone = input.timezone;
  const windowStartLocalDate = DateTime.fromJSDate(windowStart, { zone }).toISODate()!;
  const windowEndLocalDate = DateTime.fromJSDate(windowEnd, { zone }).toISODate()!;

  const startISO = input.treatmentStartDate > windowStartLocalDate
    ? input.treatmentStartDate
    : windowStartLocalDate;
  const endISO = input.treatmentEndDate && input.treatmentEndDate < windowEndLocalDate
    ? input.treatmentEndDate
    : windowEndLocalDate;

  if (startISO > endISO) return null;
  return { startISO, endISO };
}

export function expandSchedule(
  input: RecurrenceInput,
  windowStart: Date,
  windowEnd: Date
): Date[] {
  const schedule = input.schedule;
  const zone = input.timezone;
  const results: Date[] = [];
  const interval = Interval.fromDateTimes(windowStart, windowEnd);

  const pushIfInWindow = (utc: Date) => {
    if (interval.contains(DateTime.fromJSDate(utc))) results.push(utc);
  };

  switch (schedule.scheduleType) {
    case "times_per_day": {
      if (schedule.times.length === 0) return [];
      const range = clampWindow(input, windowStart, windowEnd);
      if (!range) return [];
      for (const dateISO of eachDate(range.startISO, range.endISO)) {
        for (const time of schedule.times) {
          pushIfInWindow(localToUtc(dateISO, time, zone));
        }
      }
      break;
    }

    case "specific_weekdays": {
      if (schedule.times.length === 0 || schedule.weekdays.length === 0) return [];
      const range = clampWindow(input, windowStart, windowEnd);
      if (!range) return [];
      const weekdaySet = new Set(schedule.weekdays);
      for (const dateISO of eachDate(range.startISO, range.endISO)) {
        const jsWeekday = DateTime.fromISO(dateISO).weekday % 7; // luxon: 1=seg..7=dom -> 0=dom..6=sab
        if (!weekdaySet.has(jsWeekday)) continue;
        for (const time of schedule.times) {
          pushIfInWindow(localToUtc(dateISO, time, zone));
        }
      }
      break;
    }

    case "alternate_days": {
      if (schedule.times.length === 0) return [];
      const range = clampWindow(input, windowStart, windowEnd);
      if (!range) return [];
      const refDate = DateTime.fromISO(schedule.startDate);
      for (const dateISO of eachDate(range.startISO, range.endISO)) {
        const daysSinceRef = Math.floor(
          DateTime.fromISO(dateISO).diff(refDate, "days").days
        );
        if (daysSinceRef < 0 || daysSinceRef % 2 !== 0) continue;
        for (const time of schedule.times) {
          pushIfInWindow(localToUtc(dateISO, time, zone));
        }
      }
      break;
    }

    case "cycle_with_pause": {
      if (schedule.times.length === 0) return [];
      const cycleLength = schedule.onDays + schedule.offDays;
      if (cycleLength <= 0 || schedule.onDays <= 0) return [];
      const range = clampWindow(input, windowStart, windowEnd);
      if (!range) return [];
      const start = DateTime.fromISO(input.treatmentStartDate);
      for (const dateISO of eachDate(range.startISO, range.endISO)) {
        const dayIndex = Math.floor(DateTime.fromISO(dateISO).diff(start, "days").days);
        if (dayIndex < 0) continue;
        const positionInCycle = dayIndex % cycleLength;
        if (positionInCycle >= schedule.onDays) continue; // dia de pausa
        for (const time of schedule.times) {
          pushIfInWindow(localToUtc(dateISO, time, zone));
        }
      }
      break;
    }

    case "every_n_hours": {
      if (schedule.intervalHours <= 0) return [];
      // Duração real, não civil: cada dose é exatamente N horas de tempo
      // decorrido após a anterior, independente de DST.
      let cursor = DateTime.fromJSDate(
        localToUtc(input.treatmentStartDate, schedule.startTime, zone)
      );
      const treatmentEnd = input.treatmentEndDate
        ? DateTime.fromISO(`${input.treatmentEndDate}T23:59:59`, { zone })
        : null;
      const windowEndDt = DateTime.fromJSDate(windowEnd);

      // Avança direto até perto da janela em vez de iterar desde o início do
      // tratamento — importante quando o tratamento é antigo e a janela é
      // só os próximos 14 dias.
      const windowStartDt = DateTime.fromJSDate(windowStart);
      if (cursor < windowStartDt) {
        const hoursToSkip = windowStartDt.diff(cursor, "hours").hours;
        const steps = Math.floor(hoursToSkip / schedule.intervalHours);
        if (steps > 0) cursor = cursor.plus({ hours: steps * schedule.intervalHours });
      }

      let guard = 0;
      while (cursor < windowEndDt && guard < 100_000) {
        guard++;
        if (treatmentEnd && cursor > treatmentEnd) break;
        pushIfInWindow(cursor.toJSDate());
        cursor = cursor.plus({ hours: schedule.intervalHours });
      }
      break;
    }
  }

  results.sort((a, b) => a.getTime() - b.getTime());
  return results;
}
