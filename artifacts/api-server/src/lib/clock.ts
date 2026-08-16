/**
 * Abstração de relógio controlável para o ZELO.
 *
 * Por que isso existe:
 * O escalonamento de alertas dispara em 15, 30 e 60 minutos após uma dose
 * não registrada. Sem esta abstração, precisaríamos esperar de verdade para
 * testar — o que é impraticável. Com ela, adiantamos o relógio artificialmente
 * nos testes e simulamos horas passando em milissegundos.
 *
 * Em produção: usa new Date() normalmente — sem overhead, sem diferença.
 * Em desenvolvimento/teste: chame Clock.advance(ms) para adiantar o relógio.
 *
 * NUNCA chame new Date() ou Date.now() diretamente no código da aplicação.
 * Sempre use Clock.now() e Clock.today() para que os testes funcionem.
 *
 * Exemplo de uso em teste:
 *   Clock.setOffset(15 * 60 * 1000); // simula 15 minutos no futuro
 *   triggerEscalation();              // deve escalar nível 1
 *   Clock.reset();                    // volta ao relógio real
 */

let _offsetMs = 0;
let _fixedNow: Date | null = null;

export const Clock = {
  /** Retorna o "agora" controlável. Use em vez de new Date(). */
  now(): Date {
    // O offset é aplicado SOBRE a data congelada quando ambos estão ativos.
    // Isso permite freezeAt(base) + advance(ms) nos testes de escalonamento.
    if (_fixedNow !== null) return new Date(_fixedNow.getTime() + _offsetMs);
    return new Date(Date.now() + _offsetMs);
  },

  /** Data de hoje no fuso UTC como string YYYY-MM-DD. */
  todayUtc(): string {
    return Clock.now().toISOString().slice(0, 10);
  },

  /**
   * Retorna data de hoje no fuso especificado como string YYYY-MM-DD.
   * Essencial porque a "dose das 8h" precisa ser 8h no relógio DO PACIENTE.
   */
  todayInTimezone(tz: string): string {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    })
      .format(Clock.now())
      .replace(/\//g, "-"); // en-CA usa YYYY-MM-DD
  },

  // ── Controles de teste ───────────────────────────────────────────────────

  /**
   * Avança o relógio por `ms` milissegundos.
   * Acumulativo: chamadas sucessivas somam os offsets.
   * Use em testes para simular tempo passando sem esperar de verdade.
   */
  advance(ms: number): void {
    _offsetMs += ms;
  },

  /** Define um offset absoluto em milissegundos a partir do tempo real. */
  setOffset(ms: number): void {
    _offsetMs = ms;
  },

  /** Fixa o relógio em uma data específica (útil para testes determinísticos). */
  freezeAt(date: Date): void {
    _fixedNow = new Date(date.getTime());
  },

  /** Restaura o relógio real. Chame em afterEach/afterAll nos testes. */
  reset(): void {
    _offsetMs = 0;
    _fixedNow = null;
  },

  /** Retorna o offset atual em ms (útil para inspeção em testes). */
  currentOffsetMs(): number {
    return _offsetMs;
  },

  /** True quando o relógio está em modo de teste (offset ≠ 0 ou fixedNow ≠ null). */
  isInTestMode(): boolean {
    return _offsetMs !== 0 || _fixedNow !== null;
  },
};
