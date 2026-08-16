-- audit_log precisa ser append-only a nivel de banco, nao so por convencao de codigo.
-- Este arquivo nao era rastreado no repositorio antes de 16/08/2026 -- o trigger existia
-- só dentro do banco do Replit, criado uma vez e nunca salvo em lugar nenhum. Se aquele
-- banco fosse resetado, essa protecao sumiria sem ninguem perceber. Agora e reproduzivel:
-- rode via `pnpm run push:raw` (lib/db) depois de todo `drizzle-kit push`.

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

DROP TRIGGER IF EXISTS audit_log_immutable ON audit_log;

CREATE TRIGGER audit_log_immutable
  BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW
  EXECUTE FUNCTION prevent_audit_log_mutation();
