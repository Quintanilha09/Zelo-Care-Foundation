-- O audit_log é append-only, e isso é garantido pelo BANCO — Issue #198.
--
-- ═══════════════════════════════════════════════════════════════════════════
-- ISTO ERA UM PASSO SEPARADO QUE DAVA PARA ESQUECER.
--
-- Até aqui o gatilho vinha de `pnpm --filter @workspace/db push:raw`, um
-- comando à parte que tinha de ser lembrado DEPOIS de todo `push`. Esquecê-lo
-- não dava erro nenhum: o banco subia inteiro, os testes passavam, e a
-- imutabilidade do log de auditoria simplesmente não existia.
--
-- Um log de auditoria que pode ser alterado não é log de auditoria. Ele existe
-- justamente para o caso em que alguém tem motivo para reescrever a história.
--
-- Como migração, ele deixa de ser lembrado e passa a ser aplicado — na ordem,
-- uma vez, por quem quer que crie o banco.
-- ═══════════════════════════════════════════════════════════════════════════
--
-- ── Por que a proteção é no banco, e não no código ────────────────────────
--
-- O código já não emite UPDATE nem DELETE nesta tabela. Mas "o código não faz"
-- é uma promessa sobre o código de hoje. O gatilho é uma propriedade da
-- tabela: vale para o psql aberto às duas da manhã, para o script de correção
-- escrito às pressas, e para qualquer credencial que um dia tenha escrita.
--
-- Histórico: o gatilho existiu por um tempo apenas dentro do banco do Replit,
-- criado uma vez à mão e salvo em lugar nenhum. Se aquele banco fosse
-- recriado, a proteção sumiria sem ninguém perceber. Virou arquivo em
-- 16/08/2026, e migração agora.

CREATE OR REPLACE FUNCTION prevent_audit_log_mutation()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'audit_log é append-only: UPDATE e DELETE são proibidos. Tentativa de UPDATE na tabela audit_log.';
  ELSIF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'audit_log é append-only: UPDATE e DELETE são proibidos. Tentativa de DELETE na tabela audit_log.';
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint

-- `DROP IF EXISTS` antes de criar: a migração precisa ser aplicável num banco
-- que já tenha o gatilho vindo do antigo `push:raw`, sem falhar por duplicata.
DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;
--> statement-breakpoint

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();
