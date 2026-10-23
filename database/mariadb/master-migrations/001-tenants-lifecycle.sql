-- ============================================================
-- Apreu · BD maestra · 001 · Ciclo de vida de colegios (superadmin-api)
-- MariaDB 10.11, idempotente.
--  - trial_ends_at: último día del periodo de prueba (status = 'trial').
--  - deleted_at: eliminación lógica. El registro, la BD y el slug se conservan;
--    el colegio queda en status = 'suspended', por lo que apreu-api lo bloquea.
-- ============================================================
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS db_name VARCHAR(64) NULL AFTER tables_created;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS trial_ends_at DATE NULL AFTER db_name;
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMP NULL DEFAULT NULL AFTER updated_at;
CREATE INDEX IF NOT EXISTS idx_deleted_at ON tenants (deleted_at);
