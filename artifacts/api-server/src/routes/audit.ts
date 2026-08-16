import { Router, type IRouter } from "express";
import { eq, and, gte } from "drizzle-orm";
import { db } from "@workspace/db";
import { auditLogTable } from "@workspace/db";
import { ListAuditLogParams, ListAuditLogQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

// Log de auditoria: SOMENTE LEITURA.
// Não há rota de criação/edição/exclusão exposta para clientes.
// Entradas são criadas internamente pelo servidor via audit().
router.get(
  "/families/:familyId/audit-log",
  async (req, res): Promise<void> => {
    const params = ListAuditLogParams.safeParse(req.params);
    const query = ListAuditLogQueryParams.safeParse(req.query);
    if (!params.success || !query.success) {
      res.status(400).json({ error: "Parâmetros inválidos" });
      return;
    }

    const conditions = [eq(auditLogTable.familyId, params.data.familyId)];
    if (query.data.from) {
      conditions.push(gte(auditLogTable.createdAt, new Date(query.data.from)));
    }
    if (query.data.entityType) {
      conditions.push(eq(auditLogTable.entityType, query.data.entityType));
    }

    const limit =
      typeof query.data.limit === "number"
        ? Math.min(query.data.limit, 200)
        : 50;

    const entries = await db
      .select()
      .from(auditLogTable)
      .where(and(...conditions))
      .orderBy(auditLogTable.createdAt)
      .limit(limit);

    res.json(entries);
  }
);

export default router;
