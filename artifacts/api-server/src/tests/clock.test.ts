/**
 * Testes do relógio controlável — Clock
 *
 * Verifica que o mecanismo de adiantar o relógio artificialmente funciona.
 * Isso é essencial para testar o escalonamento de alertas (15/30/60 min)
 * sem esperar de verdade.
 */

import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Clock } from "../lib/clock.ts";

describe("Clock — relógio controlável para testes", () => {
  beforeEach(() => Clock.reset());
  afterEach(() => Clock.reset());

  it("retorna uma data próxima ao Date.now() sem offset", () => {
    const before = Date.now();
    const clockNow = Clock.now().getTime();
    const after = Date.now();
    assert.ok(clockNow >= before, "Clock.now() deve ser >= ao tempo antes da chamada");
    assert.ok(clockNow <= after + 5, "Clock.now() deve ser próximo ao Date.now()");
  });

  it("advance() avança o relógio por milissegundos", () => {
    const before = Clock.now().getTime();
    Clock.advance(15 * 60 * 1000); // 15 minutos
    const after = Clock.now().getTime();
    const diff = after - before;
    assert.ok(diff >= 15 * 60 * 1000, "Deve ter avançado pelo menos 15 minutos");
    assert.ok(diff < 15 * 60 * 1000 + 100, "Deve ter avançado no máximo 15 minutos + 100ms");
  });

  it("advance() é acumulativo — chamadas sucessivas somam os offsets", () => {
    Clock.advance(10 * 60 * 1000); // +10min
    Clock.advance(5 * 60 * 1000);  // +5min = total 15min
    const offset = Clock.currentOffsetMs();
    assert.equal(offset, 15 * 60 * 1000, "Offset acumulado deve ser 15 minutos");
  });

  it("setOffset() define um offset absoluto", () => {
    Clock.advance(30 * 60 * 1000); // +30min primeiro
    Clock.setOffset(60 * 60 * 1000); // redefine para exatamente 60min
    assert.equal(Clock.currentOffsetMs(), 60 * 60 * 1000, "Offset deve ser 60 minutos");
  });

  it("freezeAt() congela o relógio em uma data específica", () => {
    const fixedDate = new Date("2025-06-15T08:00:00.000Z");
    Clock.freezeAt(fixedDate);
    const t1 = Clock.now().getTime();
    const t2 = Clock.now().getTime();
    assert.equal(t1, fixedDate.getTime(), "Deve retornar a data fixada");
    assert.equal(t2, fixedDate.getTime(), "Deve retornar a mesma data em chamadas sucessivas");
  });

  it("reset() restaura o relógio real", () => {
    Clock.advance(999 * 60 * 1000); // +999 minutos
    Clock.reset();
    assert.equal(Clock.currentOffsetMs(), 0, "Offset deve ser zero após reset");
    assert.equal(Clock.isInTestMode(), false, "isInTestMode deve ser false após reset");

    const clockNow = Clock.now().getTime();
    const realNow = Date.now();
    const diff = Math.abs(clockNow - realNow);
    assert.ok(diff < 100, `Clock.now() deve ser próximo ao tempo real após reset, diff=${diff}ms`);
  });

  it("isInTestMode() detecta corretamente o modo de teste", () => {
    assert.equal(Clock.isInTestMode(), false, "Modo normal não é modo de teste");
    Clock.advance(1);
    assert.equal(Clock.isInTestMode(), true, "Com offset, é modo de teste");
    Clock.reset();
    assert.equal(Clock.isInTestMode(), false, "Após reset, não é mais modo de teste");
  });

  it("todayInTimezone() retorna data correta no fuso do paciente", () => {
    // Congela em meia-noite UTC — em São Paulo (UTC-3) ainda é dia anterior
    Clock.freezeAt(new Date("2025-06-15T02:30:00.000Z")); // 02:30 UTC = 23:30 do dia 14 em SP
    const spDate = Clock.todayInTimezone("America/Sao_Paulo");
    assert.equal(spDate, "2025-06-14", `Em São Paulo deve ser 2025-06-14, mas foi ${spDate}`);
  });

  it("simula escalamento de alerta em 15 minutos", () => {
    // Caso de uso central: dose agendada às 08:00, sem registro
    // Deve escalar após 15 minutos — testável sem esperar de verdade
    Clock.freezeAt(new Date("2025-06-15T08:00:00.000Z"));
    const doseScheduledAt = Clock.now();

    Clock.advance(14 * 60 * 1000); // avança 14 minutos
    const elapsed14min = Clock.now().getTime() - doseScheduledAt.getTime();
    assert.ok(elapsed14min < 15 * 60 * 1000, "Antes de 15 minutos — não deve escalar");

    Clock.advance(60 * 1000); // mais 1 minuto = total 15 minutos
    const elapsed15min = Clock.now().getTime() - doseScheduledAt.getTime();
    assert.ok(elapsed15min >= 15 * 60 * 1000, "Após 15 minutos — deve escalar nível 1");
  });
});
