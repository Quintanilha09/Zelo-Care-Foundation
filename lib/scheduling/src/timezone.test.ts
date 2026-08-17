import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { toLocalDateTime, localDayBoundsUtc } from "./timezone.ts";

const SP = "America/Sao_Paulo";
const NY = "America/New_York";

describe("toLocalDateTime", () => {
  it("deriva data e hora civis no fuso do paciente a partir de um instante UTC", () => {
    // 08:00 em São Paulo (UTC-3, sem DST hoje) = 11:00 UTC
    const result = toLocalDateTime(new Date("2026-01-10T11:00:00.000Z"), SP);
    assert.deepEqual(result, { localDate: "2026-01-10", localTime: "08:00" });
  });

  it("mesmo instante UTC produz data/hora locais diferentes em fusos diferentes", () => {
    const utc = new Date("2026-06-01T11:00:00.000Z");
    const inSP = toLocalDateTime(utc, SP);
    const inNY = toLocalDateTime(utc, NY);
    assert.notEqual(inSP.localTime, inNY.localTime);
  });

  it("reflete o instante deslizado por DST (spring-forward), não a intenção original inexistente", () => {
    // 02:30 em NY não existe em 08/03/2026 (pula para 03:00) — o instante UTC
    // resultante, quando derivado de volta, deve ser 03:30 (não 02:30).
    const utc = new Date("2026-03-08T07:30:00.000Z"); // 02:30 EST -> desliza para 03:30 EDT
    const result = toLocalDateTime(utc, NY);
    assert.deepEqual(result, { localDate: "2026-03-08", localTime: "03:30" });
  });
});

describe("localDayBoundsUtc", () => {
  it("delimita o dia civil no fuso do paciente, não no do processo", () => {
    const originalTZ = process.env.TZ;
    process.env.TZ = "Asia/Tokyo";
    try {
      const { start, end } = localDayBoundsUtc("2026-01-10", SP);
      // 00:00 SP = 03:00 UTC; 23:59:59.999 SP = 02:59:59.999 UTC do dia seguinte
      assert.equal(start.toISOString(), "2026-01-10T03:00:00.000Z");
      assert.equal(end.toISOString(), "2026-01-11T02:59:59.999Z");
    } finally {
      process.env.TZ = originalTZ;
    }
  });

  it("dia com 23 horas reais (spring-forward) ainda delimita o dia civil inteiro", () => {
    const { start, end } = localDayBoundsUtc("2026-03-08", NY);
    assert.ok(end.getTime() > start.getTime());
    // 23h reais, não 24h: a diferença deve ser menor que um dia completo
    assert.ok(end.getTime() - start.getTime() < 24 * 3_600_000);
  });
});
