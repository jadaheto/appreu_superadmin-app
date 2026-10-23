-- Contexto: accounting (contabilidad)
-- Migración idempotente (MariaDB 10.11).
--  * Auditoría de contabilización / anulación / reversión y origen de asientos automáticos.
--  * Auditoría de cierre y reapertura de periodos.
--  * Consecutivos con bloqueo por tipo de comprobante (corrige la condición de carrera MAX+1).
--  * Parametrización de cuentas para asientos automáticos (eventos de finanzas y nómina).

ALTER TABLE `accounting_journal_entries`
  ADD COLUMN IF NOT EXISTS `posted_at` DATETIME NULL DEFAULT NULL AFTER `created_at`,
  ADD COLUMN IF NOT EXISTS `posted_by` INT(10) UNSIGNED NULL DEFAULT NULL AFTER `posted_at`,
  ADD COLUMN IF NOT EXISTS `voided_at` DATETIME NULL DEFAULT NULL AFTER `posted_by`,
  ADD COLUMN IF NOT EXISTS `voided_by` INT(10) UNSIGNED NULL DEFAULT NULL AFTER `voided_at`,
  ADD COLUMN IF NOT EXISTS `void_reason` VARCHAR(255) NULL DEFAULT NULL AFTER `voided_by`,
  ADD COLUMN IF NOT EXISTS `source_type` VARCHAR(50) NULL DEFAULT NULL AFTER `void_reason`,
  ADD COLUMN IF NOT EXISTS `source_id` VARCHAR(50) NULL DEFAULT NULL AFTER `source_type`,
  ADD COLUMN IF NOT EXISTS `reversal_of_id` INT(10) UNSIGNED NULL DEFAULT NULL AFTER `source_id`;

ALTER TABLE `accounting_journal_entries`
  ADD UNIQUE INDEX IF NOT EXISTS `idx_entry_source` (`source_type`, `source_id`),
  ADD INDEX IF NOT EXISTS `idx_entry_reversal` (`reversal_of_id`),
  ADD INDEX IF NOT EXISTS `idx_entry_status_date` (`status`, `entry_date`);

ALTER TABLE `accounting_periods`
  ADD COLUMN IF NOT EXISTS `closed_at` DATETIME NULL DEFAULT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `closed_by` INT(10) UNSIGNED NULL DEFAULT NULL AFTER `closed_at`,
  ADD COLUMN IF NOT EXISTS `reopened_at` DATETIME NULL DEFAULT NULL AFTER `closed_by`,
  ADD COLUMN IF NOT EXISTS `reopened_by` INT(10) UNSIGNED NULL DEFAULT NULL AFTER `reopened_at`,
  ADD COLUMN IF NOT EXISTS `reopen_reason` VARCHAR(255) NULL DEFAULT NULL AFTER `reopened_by`;

CREATE TABLE IF NOT EXISTS `accounting_sequences` (
  `entry_type` ENUM('RC','CE','FC','FV','NC','ND','NI','SALA') NOT NULL,
  `last_number` INT(10) UNSIGNED NOT NULL DEFAULT 0,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  PRIMARY KEY (`entry_type`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Inicializa los consecutivos con el máximo existente (no retrocede si ya existen).
INSERT IGNORE INTO `accounting_sequences` (`entry_type`, `last_number`)
SELECT `entry_type`, MAX(CAST(`entry_number` AS UNSIGNED))
FROM `accounting_journal_entries`
GROUP BY `entry_type`;

CREATE TABLE IF NOT EXISTS `accounting_posting_rules` (
  `rule_key` VARCHAR(100) NOT NULL COMMENT 'Ej: payment.debit.method.efectivo, payroll.credit.net',
  `account_id` INT(10) UNSIGNED NOT NULL,
  `updated_by` INT(10) UNSIGNED NULL DEFAULT NULL,
  `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP(),
  PRIMARY KEY (`rule_key`),
  KEY `idx_posting_rule_account` (`account_id`),
  CONSTRAINT `accounting_posting_rules_account_fk` FOREIGN KEY (`account_id`) REFERENCES `accounting_accounts` (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
