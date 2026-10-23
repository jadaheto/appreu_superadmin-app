-- ============================================================
-- Apreu · BD maestra (registro de colegios / tenants)
-- Propiedad de superadmin-api; apreu-api solo la lee.
-- Compatible con la tabla creada por superadmin/setup.php,
-- más la columna opcional db_name (si es NULL se usa apreu_<slug>).
-- ============================================================
CREATE TABLE IF NOT EXISTS tenants (
  id             INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  slug           VARCHAR(60)  NOT NULL UNIQUE,
  name           VARCHAR(200) NOT NULL,
  admin_email    VARCHAR(150) NULL,
  admin_phone    VARCHAR(30)  NULL,
  status         ENUM('active','suspended','trial') NOT NULL DEFAULT 'active',
  tables_created TINYINT(1)   NOT NULL DEFAULT 0,
  db_name        VARCHAR(64)  NULL,
  created_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_status (status),
  INDEX idx_slug (slug)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Migración para BD maestras existentes (MariaDB):
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS db_name VARCHAR(64) NULL AFTER tables_created;
