-- Atualização de schema de PRODUÇÃO — ZELO-40, ZELO-56 e ZELO-58.
--
-- Por que este arquivo existe: no Replit, `drizzle-kit push` contra o banco
-- de produção morre em silêncio no "Pulling schema" (o processo é encerrado
-- antes de terminar). Este SQL faz exatamente as mesmas quatro mudanças, de
-- forma que dá pra ler e conferir antes de aplicar.
--
-- TUDO AQUI É ADITIVO E IDEMPOTENTE: nenhum DROP, nenhum TRUNCATE, nenhuma
-- coluna alterada. Rodar duas vezes não causa erro nem efeito diferente.
-- Nenhuma linha existente é tocada — as colunas novas entram com DEFAULT.

-- ── ZELO-56: novo tier de plano ───────────────────────────────────────────
-- IF NOT EXISTS evita erro se já tiver sido aplicado. Precisa rodar sozinho,
-- fora de bloco de transação, por ser ALTER TYPE.
ALTER TYPE subscription_plan ADD VALUE IF NOT EXISTS 'professional';

-- ── ZELO-40: modo idoso ───────────────────────────────────────────────────
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS elder_mode_enabled boolean NOT NULL DEFAULT false;

ALTER TABLE dose_records
  ADD COLUMN IF NOT EXISTS registered_via_elder_mode boolean NOT NULL DEFAULT false;

-- ── ZELO-37: contato de emergência ────────────────────────────────────────
-- Provavelmente já existe em produção (a tabela `activities` da mesma
-- história está lá), mas IF NOT EXISTS torna a checagem desnecessária.
ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS emergency_contact_name text;

ALTER TABLE patients
  ADD COLUMN IF NOT EXISTS emergency_contact_phone text;

-- ── ZELO-58: acesso do paciente no próprio aparelho ───────────────────────
-- CREATE TYPE não aceita IF NOT EXISTS — o bloco abaixo faz o equivalente.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'patient_access_status') THEN
    CREATE TYPE patient_access_status AS ENUM ('pending', 'active', 'revoked');
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS patient_access_tokens (
  id serial PRIMARY KEY,
  patient_id integer NOT NULL REFERENCES patients(id) ON DELETE CASCADE,
  family_id integer NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  status patient_access_status NOT NULL DEFAULT 'pending',
  expires_at timestamp with time zone,
  activated_at timestamp with time zone,
  revoked_at timestamp with time zone,
  device_label text,
  last_used_at timestamp with time zone,
  created_by_caregiver_id integer NOT NULL REFERENCES caregivers(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now()
);
