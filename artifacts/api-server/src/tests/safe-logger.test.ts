/**
 * Testes do logger com lista de permissão de campos — safeLog
 *
 * Verifica que campos sensíveis são REALMENTE ocultados dos logs.
 * Este é o teste mais crítico de privacidade do produto.
 *
 * Campos que NUNCA podem aparecer em logs:
 * - medicationName (nome de medicamento)
 * - patientName (nome do paciente)
 * - birthDate (data de nascimento)
 * - condition (condição de saúde)
 * - measurementValue (valor de aferição)
 * - doctorName (nome do médico)
 * - activeIngredient (princípio ativo)
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sanitizeLogContext, SAFE_LOG_FIELDS } from "../lib/safe-logger.ts";

describe("safeLog — proteção de privacidade nos logs", () => {

  describe("sanitizeLogContext()", () => {
    it("mantém campos seguros intactos", () => {
      const ctx = {
        familyId: 42,
        action: "dose_recorded",
        status: "taken",
        scheduledDoseId: 7,
      };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.familyId, 42, "familyId deve ser mantido");
      assert.equal(sanitized.action, "dose_recorded", "action deve ser mantido");
      assert.equal(sanitized.status, "taken", "status deve ser mantido");
      assert.equal(sanitized.scheduledDoseId, 7, "scheduledDoseId deve ser mantido");
    });

    it("oculta nome de medicamento — campo mais sensível", () => {
      const ctx = { medicationName: "Cardiolex 25mg", familyId: 1 };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(
        sanitized.medicationName,
        "[REDACTED]",
        "medicationName NUNCA pode aparecer em logs"
      );
      assert.equal(sanitized.familyId, 1, "familyId deve ser mantido");
    });

    it("oculta nome do paciente", () => {
      const ctx = { patientName: "Dona Maria Teste", familyId: 2 };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.patientName, "[REDACTED]", "patientName NUNCA pode aparecer em logs");
    });

    it("oculta data de nascimento do paciente", () => {
      const ctx = { birthDate: "1947-03-22", familyId: 3 };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.birthDate, "[REDACTED]", "birthDate é dado clínico sensível");
    });

    it("oculta condição de saúde / diagnóstico", () => {
      const ctx = { condition: "hipertensão", diagnosis: "diabetes tipo 2", familyId: 4 };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.condition, "[REDACTED]", "condição de saúde não pode aparecer em logs");
      assert.equal(sanitized.diagnosis, "[REDACTED]", "diagnóstico não pode aparecer em logs");
    });

    it("oculta valores de aferição de saúde", () => {
      const ctx = {
        measurementValue: "120/80",
        bloodPressure: "120/80",
        bloodGlucose: "98",
        weight: "72.5kg",
        familyId: 5,
      };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.measurementValue, "[REDACTED]", "valor de aferição não pode aparecer");
      assert.equal(sanitized.bloodPressure, "[REDACTED]", "pressão arterial não pode aparecer");
      assert.equal(sanitized.bloodGlucose, "[REDACTED]", "glicemia não pode aparecer");
      assert.equal(sanitized.weight, "[REDACTED]", "peso não pode aparecer");
    });

    it("oculta nome de medicamento mesmo em contexto misto com campos seguros", () => {
      const ctx = {
        familyId: 10,
        caregiverId: 3,
        scheduledDoseId: 99,
        medicationName: "Prexoral 10mg",   // SENSÍVEL
        patientName: "Dona Maria Teste",   // SENSÍVEL
        action: "dose_recorded",           // SEGURO
        outcome: "taken",                  // SEGURO
      };
      const sanitized = sanitizeLogContext(ctx);
      // Campos seguros mantidos
      assert.equal(sanitized.familyId, 10);
      assert.equal(sanitized.caregiverId, 3);
      assert.equal(sanitized.scheduledDoseId, 99);
      assert.equal(sanitized.action, "dose_recorded");
      assert.equal(sanitized.outcome, "taken");
      // Campos sensíveis ocultados
      assert.equal(sanitized.medicationName, "[REDACTED]");
      assert.equal(sanitized.patientName, "[REDACTED]");
    });

    it("oculta princípio ativo do medicamento", () => {
      const ctx = { activeIngredient: "losartana potássica", familyId: 6 };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.activeIngredient, "[REDACTED]", "princípio ativo não pode aparecer em logs");
    });

    it("oculta nome do médico", () => {
      const ctx = { doctorName: "Dr. Fictício da Silva", familyId: 7 };
      const sanitized = sanitizeLogContext(ctx);
      assert.equal(sanitized.doctorName, "[REDACTED]", "nome de médico é dado sensível");
    });

    it("objeto vazio produz objeto vazio sanitizado", () => {
      const sanitized = sanitizeLogContext({});
      assert.deepEqual(sanitized, {}, "objeto vazio retorna objeto vazio");
    });

    it("todos os campos sensíveis conhecidos são ocultados automaticamente", () => {
      const sensitiveFields = [
        "medicationName", "patientName", "birthDate", "condition", "diagnosis",
        "measurementValue", "bloodPressure", "bloodGlucose", "weight", "temperature",
        "activeIngredient", "doctorName", "specialty", "instructions",
        "medicalNotes", "clinicalNotes", "healthCondition",
      ];

      for (const field of sensitiveFields) {
        const ctx = { [field]: "DADO_SENSÍVEL_QUE_NÃO_DEVE_APARECER" };
        const sanitized = sanitizeLogContext(ctx);
        assert.equal(
          sanitized[field],
          "[REDACTED]",
          `Campo "${field}" deve ser ocultado mas apareceu nos logs`
        );
        // Garantia extra: o valor real nunca aparece
        assert.notEqual(
          sanitized[field],
          "DADO_SENSÍVEL_QUE_NÃO_DEVE_APARECER",
          `Valor real de "${field}" NUNCA pode aparecer no objeto de log`
        );
      }
    });

    it("SAFE_LOG_FIELDS não contém campos sensíveis", () => {
      const definitelyUnsafe = [
        "medicationName", "patientName", "birthDate", "condition",
        "diagnosis", "bloodPressure", "bloodGlucose", "weight",
        "activeIngredient", "doctorName", "measurementValue",
      ];
      for (const unsafe of definitelyUnsafe) {
        assert.ok(
          !SAFE_LOG_FIELDS.has(unsafe),
          `"${unsafe}" NÃO deve estar na allowlist de campos seguros`
        );
      }
    });
  });
});
