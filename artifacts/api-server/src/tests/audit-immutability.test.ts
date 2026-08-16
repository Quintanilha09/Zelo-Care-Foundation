/**
 * Teste de imutabilidade do log de auditoria — ZELO
 *
 * Verifica que UPDATE e DELETE na tabela audit_log são bloqueados
 * pelo próprio banco de dados (trigger BEFORE UPDATE OR DELETE),
 * independentemente de qualquer convenção no código da aplicação.
 *
 * Este teste conecta diretamente ao banco via SQL puro para simular
 * um acesso que contorna a camada de aplicação — exatamente o cenário
 * que o trigger deve bloquear.
 */

import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

let insertedId: number;

before(async () => {
  // Insere uma entrada legítima para tentar modificar depois
  const [entry] = await db
    .insert(auditLogTable)
    .values({
      familyId: 999,
      entityType: "test_entity",
      entityId: "audit-immutability-test",
      action: "created",
      actorType: "system",
    })
    .returning();
  insertedId = entry.id;
});

after(async () => {
  // A limpeza via DELETE deve TAMBÉM falhar se o trigger estiver ativo.
  // Usamos SQL direto para contornar a camada Drizzle e testar o trigger.
  // Se o trigger bloquear, não tem problema — o dado de teste fica,
  // mas é claramente identificável pelo entityId "audit-immutability-test".
  try {
    await db.execute(
      sql`DELETE FROM audit_log WHERE entity_id = 'audit-immutability-test'`
    );
  } catch {
    // esperado se o trigger estiver ativo — ignora
  }
});

describe("Audit log — imutabilidade garantida por trigger do banco", () => {
  it("INSERT no audit_log funciona normalmente", async () => {
    assert.ok(insertedId > 0, "INSERT deve ter sido bem-sucedido");
  });

  it("UPDATE no audit_log é bloqueado pelo trigger do banco", async () => {
    await assert.rejects(
      async () => {
        await db
          .update(auditLogTable)
          .set({ entityType: "tentativa_de_alteracao" })
          .where(eq(auditLogTable.id, insertedId));
      },
      (err: unknown) => {
        const e = err as { message?: string; cause?: { message?: string } };
        const msg = (e.message ?? "") + (e.cause?.message ?? "");
        assert.ok(
          msg.toLowerCase().includes("audit_log") ||
            msg.toLowerCase().includes("append-only") ||
            msg.toLowerCase().includes("forbidden") ||
            msg.toLowerCase().includes("imutável") ||
            msg.toLowerCase().includes("proibido"),
          `UPDATE deveria ter sido bloqueado pelo trigger, mas a mensagem foi: "${msg}"`
        );
        return true;
      },
      "UPDATE no audit_log deve ser bloqueado pelo trigger do banco"
    );
  });

  it("DELETE no audit_log é bloqueado pelo trigger do banco", async () => {
    await assert.rejects(
      async () => {
        await db
          .delete(auditLogTable)
          .where(eq(auditLogTable.id, insertedId));
      },
      (err: unknown) => {
        const e = err as { message?: string; cause?: { message?: string } };
        const msg = (e.message ?? "") + (e.cause?.message ?? "");
        assert.ok(
          msg.toLowerCase().includes("audit_log") ||
            msg.toLowerCase().includes("append-only") ||
            msg.toLowerCase().includes("forbidden") ||
            msg.toLowerCase().includes("imutável") ||
            msg.toLowerCase().includes("proibido"),
          `DELETE deveria ter sido bloqueado pelo trigger, mas a mensagem foi: "${msg}"`
        );
        return true;
      },
      "DELETE no audit_log deve ser bloqueado pelo trigger do banco"
    );
  });

  it("UPDATE via SQL puro (contornando Drizzle) também é bloqueado", async () => {
    await assert.rejects(
      async () => {
        await db.execute(
          sql`UPDATE audit_log SET entity_type = 'bypass_attempt' WHERE id = ${insertedId}`
        );
      },
      (err: unknown) => {
        const e = err as { message?: string; cause?: { message?: string } };
        const msg = (e.message ?? "") + (e.cause?.message ?? "");
        assert.ok(
          msg.length > 0,
          "Deve ter lançado algum erro ao tentar UPDATE via SQL puro"
        );
        return true;
      },
      "UPDATE via SQL puro deve ser bloqueado pelo trigger"
    );
  });
});
