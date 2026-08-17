/**
 * Tipos de posologia — espelham exatamente o JSONB de treatments.scheduleConfig
 * (lib/db/src/schema/treatments.ts). Mudar um lado exige mudar o outro.
 */

export type ScheduleType =
  | "times_per_day"
  | "every_n_hours"
  | "specific_weekdays"
  | "alternate_days"
  | "cycle_with_pause";

/** "HH:mm", 24h, sempre no relógio de parede do paciente. */
export type TimeOfDay = string;

export interface TimesPerDayConfig {
  times: TimeOfDay[];
}

export interface EveryNHoursConfig {
  intervalHours: number;
  startTime: TimeOfDay;
}

/** weekdays: 0=domingo .. 6=sábado — convenção JS Date.getDay(), não ISO. */
export interface SpecificWeekdaysConfig {
  weekdays: number[];
  times: TimeOfDay[];
}

export interface AlternateDaysConfig {
  times: TimeOfDay[];
  startDate: string; // "YYYY-MM-DD" — referência da paridade, pode diferir de treatment.startDate
}

export interface CycleWithPauseConfig {
  onDays: number;
  offDays: number;
  times: TimeOfDay[];
}

export type ScheduleConfig =
  | ({ scheduleType: "times_per_day" } & TimesPerDayConfig)
  | ({ scheduleType: "every_n_hours" } & EveryNHoursConfig)
  | ({ scheduleType: "specific_weekdays" } & SpecificWeekdaysConfig)
  | ({ scheduleType: "alternate_days" } & AlternateDaysConfig)
  | ({ scheduleType: "cycle_with_pause" } & CycleWithPauseConfig);

export interface RecurrenceInput {
  schedule: ScheduleConfig;
  /** "YYYY-MM-DD", no fuso do paciente. */
  treatmentStartDate: string;
  /** "YYYY-MM-DD" ou null para tratamento contínuo, sem fim definido. */
  treatmentEndDate: string | null;
  /** IANA, ex: "America/Sao_Paulo". Todo horário de posologia é interpretado aqui. */
  timezone: string;
}
