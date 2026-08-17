/**
 * Testes do motor de recorrência — ZELO.
 *
 * Sem banco, sem rede — roda em milissegundos. Cobre os 5 padrões de
 * posologia, casos de calendário (virada de mês, virada de ano), casos
 * degenerados, e os cenários de fuso/DST exigidos pela Fase 04 (ZELO-19).
 *
 * DST usada nos testes: America/New_York, 2026.
 *   Pula uma hora:  08/03/2026, 02:00 -> 03:00 (2:30 não existe)
 *   Repete uma hora: 01/11/2026, 02:00 -> 01:00 (1:30 acontece duas vezes)
 * O Brasil não usa DST hoje, mas já usou e pode voltar a usar — testar contra
 * um fuso real com DST é o que prova que o motor não depende de o país atual
 * ter ou não a regra.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { expandSchedule } from "./recurrence.ts";
import type { RecurrenceInput } from "./types.ts";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";

function utc(iso: string): Date {
  return new Date(iso);
}

function times(dates: Date[]): string[] {
  return dates.map((d) => d.toISOString()).sort();
}

describe("times_per_day", () => {
  it("1x ao dia, 3 dias seguidos", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-01-10",
      treatmentEndDate: "2026-01-12",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 3);
  });

  it("2x ao dia — horários preservados", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00", "20:00"] },
      treatmentStartDate: "2026-01-10",
      treatmentEndDate: "2026-01-10",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 2);
    // 08:00 e 20:00 em São Paulo (UTC-3, sem DST hoje) = 11:00 e 23:00 UTC
    assert.deepEqual(times(result), ["2026-01-10T11:00:00.000Z", "2026-01-10T23:00:00.000Z"]);
  });

  it("mês com 28 dias (fevereiro não bissexto)", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-02-01",
      treatmentEndDate: "2026-02-28",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-03-01T00:00:00Z"));
    assert.equal(result.length, 28);
  });

  it("mês com 30 dias (abril)", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-04-01",
      treatmentEndDate: "2026-04-30",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-03-01T00:00:00Z"), utc("2026-05-01T00:00:00Z"));
    assert.equal(result.length, 30);
  });

  it("mês com 31 dias (janeiro)", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-31",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2025-12-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 31);
  });

  it("virada de ano", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2025-12-30",
      treatmentEndDate: "2026-01-02",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2025-12-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 4);
  });

  it("tratamento contínuo (endDate null) respeita só a janela pedida", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2020-01-01",
      treatmentEndDate: null,
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-01-15T00:00:00Z"));
    assert.equal(result.length, 14);
  });

  it("tratamento que começa hoje à noite — só a dose de hoje à noite entra, não a de amanhã cedo fora da janela", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00", "22:00"] },
      treatmentStartDate: "2026-06-01",
      treatmentEndDate: "2026-06-01",
      timezone: SP,
    };
    // 22:00 SP (UTC-3) = 01:00 UTC do dia seguinte. Janela cobre só esse instante.
    const result = expandSchedule(input, utc("2026-06-01T21:00:00Z"), utc("2026-06-02T02:00:00Z"));
    assert.equal(result.length, 1);
  });
});

describe("every_n_hours", () => {
  it("a cada 8 horas, janela de 36h a partir do início do tratamento = 3 doses", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "every_n_hours", intervalHours: 8, startTime: "08:00" },
      treatmentStartDate: "2026-01-10",
      treatmentEndDate: null,
      timezone: SP,
    };
    // 08:00 SP = 11:00 UTC. Doses em 11:00, 19:00 (dia 10) e 03:00 (dia 11).
    const result = expandSchedule(input, utc("2026-01-10T00:00:00Z"), utc("2026-01-11T06:00:00Z"));
    assert.equal(result.length, 3);
  });

  it("intervalo é duração real, não afetado por DST (fuso com DST)", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "every_n_hours", intervalHours: 6, startTime: "00:00" },
      treatmentStartDate: "2026-03-07",
      treatmentEndDate: null,
      timezone: NY,
    };
    const result = expandSchedule(input, utc("2026-03-07T00:00:00Z"), utc("2026-03-09T00:00:00Z"));
    for (let i = 1; i < result.length; i++) {
      const diffHours = (result[i].getTime() - result[i - 1].getTime()) / 3_600_000;
      assert.equal(diffHours, 6, "cada dose deve ficar exatamente 6h real depois da anterior, mesmo atravessando DST");
    }
  });
});

describe("specific_weekdays", () => {
  it("segunda, quarta, sexta (1,3,5) — 2 semanas = 6 doses", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "specific_weekdays", weekdays: [1, 3, 5], times: ["08:00"] },
      treatmentStartDate: "2026-01-05", // segunda
      treatmentEndDate: "2026-01-18", // domingo, 2 semanas depois
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 6);
  });

  it("domingo (0) é respeitado — convenção JS, não ISO", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "specific_weekdays", weekdays: [0], times: ["08:00"] },
      treatmentStartDate: "2026-01-04", // domingo
      treatmentEndDate: "2026-01-04",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 1);
  });
});

describe("alternate_days", () => {
  it("dias alternados a partir da referência — 10 dias = 5 doses", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "alternate_days", times: ["08:00"], startDate: "2026-01-01" },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-10",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 5);
  });
});

describe("cycle_with_pause", () => {
  it("3 dias tomando, 2 de pausa, 10 dias = 6 doses", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "cycle_with_pause", onDays: 3, offDays: 2, times: ["08:00"] },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-10",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z"));
    assert.equal(result.length, 6); // dias 1,2,3,6,7,8 tomando (0-indexado: 0,1,2,5,6,7)
  });

  it("ciclo atravessando virada de mês", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "cycle_with_pause", onDays: 21, offDays: 7, times: ["08:00"] },
      treatmentStartDate: "2026-01-20",
      treatmentEndDate: "2026-02-15",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-03-01T00:00:00Z"));
    // dias 20/jan a 09/fev (21 dias tomando), pausa 10-16/fev, fim do range em 15/fev (ainda pausa)
    assert.equal(result.length, 21);
  });

  it("fim de tratamento no meio de um dia com 3 doses — só as anteriores ao fim entram", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "cycle_with_pause", onDays: 1, offDays: 0, times: ["06:00", "12:00", "18:00"] },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-01",
      timezone: SP,
    };
    const result = expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-01-01T14:00:00Z"));
    // janela vai até 14:00 UTC = 11:00 SP -> só a dose das 06:00 SP (09:00 UTC) entra
    assert.equal(result.length, 1);
  });
});

describe("casos degenerados", () => {
  it("posologia com 0 horários devolve lista vazia sem lançar", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: [] },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-10",
      timezone: SP,
    };
    assert.deepEqual(expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z")), []);
  });

  it("data de fim anterior à de início devolve lista vazia", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-01-10",
      treatmentEndDate: "2026-01-01",
      timezone: SP,
    };
    assert.deepEqual(expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z")), []);
  });

  it("janela vazia (windowEnd <= windowStart) devolve lista vazia", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-10",
      timezone: SP,
    };
    assert.deepEqual(expandSchedule(input, utc("2026-01-05T00:00:00Z"), utc("2026-01-05T00:00:00Z")), []);
  });

  it("every_n_hours com intervalo 0 devolve lista vazia sem loop infinito", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "every_n_hours", intervalHours: 0, startTime: "08:00" },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: null,
      timezone: SP,
    };
    assert.deepEqual(expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-01-02T00:00:00Z")), []);
  });

  it("cycle_with_pause com onDays 0 devolve lista vazia", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "cycle_with_pause", onDays: 0, offDays: 5, times: ["08:00"] },
      treatmentStartDate: "2026-01-01",
      treatmentEndDate: "2026-01-10",
      timezone: SP,
    };
    assert.deepEqual(expandSchedule(input, utc("2026-01-01T00:00:00Z"), utc("2026-02-01T00:00:00Z")), []);
  });
});

describe("fuso e horário de verão (ZELO-19)", () => {
  it("cenário A — hora que PULA (spring-forward, NY 08/03/2026 02:00->03:00): dose às 02:30 não desaparece", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["02:30"] },
      treatmentStartDate: "2026-03-08",
      treatmentEndDate: "2026-03-08",
      timezone: NY,
    };
    const result = expandSchedule(input, utc("2026-03-08T00:00:00Z"), utc("2026-03-09T00:00:00Z"));
    assert.equal(result.length, 1, "a dose deve existir — deslizada para o instante válido mais próximo, nunca sumir");
  });

  it("cenário B — hora que REPETE (fall-back, NY 01/11/2026 02:00->01:00): dose às 01:30 dispara exatamente uma vez", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["01:30"] },
      treatmentStartDate: "2026-11-01",
      treatmentEndDate: "2026-11-01",
      timezone: NY,
    };
    const result = expandSchedule(input, utc("2026-11-01T00:00:00Z"), utc("2026-11-02T00:00:00Z"));
    assert.equal(result.length, 1, "hora ambígua não pode virar duas doses — o motor sempre produz 1 Date por (dia, horário)");
  });

  it("cenário C — cuidador em fuso diferente do paciente: o motor ignora o fuso de quem chama, só usa o do paciente", () => {
    const input: RecurrenceInput = {
      schedule: { scheduleType: "times_per_day", times: ["08:00"] },
      treatmentStartDate: "2026-06-01",
      treatmentEndDate: "2026-06-01",
      timezone: SP, // paciente em SP
    };
    // A função não recebe fuso do cuidador em nenhum parâmetro — o resultado
    // é sempre o mesmo instante UTC, correto para o paciente, independente
    // de quem consulta e de onde.
    const result = expandSchedule(input, utc("2026-06-01T00:00:00Z"), utc("2026-06-02T00:00:00Z"));
    assert.equal(result.length, 1);
    assert.equal(result[0].toISOString(), "2026-06-01T11:00:00.000Z"); // 08:00 SP = 11:00 UTC
  });

  it("cenário D — paciente muda de fuso no meio do tratamento: cada chamada usa o fuso vigente, não há estado interno", () => {
    const base = {
      schedule: { scheduleType: "times_per_day" as const, times: ["08:00"] },
      treatmentStartDate: "2026-06-01",
      treatmentEndDate: "2026-06-01",
    };
    const beforeMove = expandSchedule({ ...base, timezone: SP }, utc("2026-06-01T00:00:00Z"), utc("2026-06-02T00:00:00Z"));
    const afterMove = expandSchedule({ ...base, timezone: NY }, utc("2026-06-01T00:00:00Z"), utc("2026-06-02T00:00:00Z"));
    assert.notEqual(
      beforeMove[0].toISOString(),
      afterMove[0].toISOString(),
      "o mesmo horário de parede em fusos diferentes produz instantes UTC diferentes — a função é pura por chamada, sem cache do fuso antigo"
    );
  });

  it("mudar o fuso do PROCESSO (servidor) não altera o resultado — motor nunca lê o fuso local do sistema", () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      const input: RecurrenceInput = {
        schedule: { scheduleType: "times_per_day", times: ["08:00"] },
        treatmentStartDate: "2026-06-01",
        treatmentEndDate: "2026-06-01",
        timezone: SP,
      };
      const result = expandSchedule(input, utc("2026-06-01T00:00:00Z"), utc("2026-06-02T00:00:00Z"));
      assert.equal(result[0].toISOString(), "2026-06-01T11:00:00.000Z");
    } finally {
      process.env.TZ = originalTZ;
    }
  });
});
