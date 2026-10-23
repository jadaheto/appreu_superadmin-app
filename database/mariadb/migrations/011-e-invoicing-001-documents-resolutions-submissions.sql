-- e-invoicing-001: facturación electrónica DIAN (análisis 05, §10 y §11).
-- MariaDB 10.11, idempotente.
--  * Resoluciones de numeración con vigencia, clave técnica, ambiente y ciclo de numeración
--    (NC/ND con prefijo y rango propios; reinicio de habilitación sin borrar documentos).
--  * Documentos: estados nuevos (draft/signed/submitted/accepted/accepted_with_notices/rejected/send_error),
--    referencia explícita de notas, forma de pago, vínculo con el pago de cartera, ApplicationResponse,
--    AttachedDocument, reintentos y número único por (prefijo, tipo, consecutivo, ciclo).
--  * Historial de envíos a la DIAN.

-- 1. Resoluciones / consecutivos -------------------------------------------------------------
ALTER TABLE `dian_consecutives`
  ADD COLUMN IF NOT EXISTS `valid_from` DATE NULL DEFAULT NULL AFTER `resolution_number`,
  ADD COLUMN IF NOT EXISTS `valid_to` DATE NULL DEFAULT NULL AFTER `valid_from`,
  ADD COLUMN IF NOT EXISTS `technical_key` VARCHAR(512) NULL DEFAULT NULL COMMENT 'Clave técnica (cifrada AES-GCM, prefijo enc:v1:)' AFTER `valid_to`,
  ADD COLUMN IF NOT EXISTS `environment` ENUM('1','2') NOT NULL DEFAULT '2' AFTER `technical_key`,
  ADD COLUMN IF NOT EXISTS `numbering_cycle` INT(10) UNSIGNED NOT NULL DEFAULT 0 AFTER `environment`,
  ADD COLUMN IF NOT EXISTS `updated_at` TIMESTAMP NULL DEFAULT CURRENT_TIMESTAMP() ON UPDATE CURRENT_TIMESTAMP() AFTER `created_at`;

-- Crea la numeración de facturas desde los settings legacy si no existe (antes la autocreaba generate_invoice.php).
INSERT IGNORE INTO `dian_consecutives` (`prefix`, `doc_type`, `range_from`, `range_to`, `current_consecutive`, `resolution_number`, `is_active`)
SELECT p.`value`, 'fv', CAST(f.`value` AS UNSIGNED), CAST(t.`value` AS UNSIGNED), CAST(f.`value` AS UNSIGNED) - 1, r.`value`, 1
FROM `settings` p
JOIN `settings` f ON f.`key` = 'dian_range_from' AND f.`value` REGEXP '^[0-9]+$'
JOIN `settings` t ON t.`key` = 'dian_range_to' AND t.`value` REGEXP '^[0-9]+$'
LEFT JOIN `settings` r ON r.`key` = 'dian_resolution_number'
WHERE p.`key` = 'dian_prefix' AND p.`value` <> '';

-- Copia vigencia, clave técnica y ambiente (antes solo en settings) a la numeración de facturas.
UPDATE `dian_consecutives` c
LEFT JOIN `settings` df ON df.`key` = 'dian_resolution_date_from'
LEFT JOIN `settings` dt ON dt.`key` = 'dian_resolution_date_to'
LEFT JOIN `settings` tk ON tk.`key` = 'dian_technical_key'
LEFT JOIN `settings` env ON env.`key` = 'dian_environment'
SET c.`valid_from` = COALESCE(c.`valid_from`, STR_TO_DATE(NULLIF(df.`value`, ''), '%Y-%m-%d')),
    c.`valid_to` = COALESCE(c.`valid_to`, STR_TO_DATE(NULLIF(dt.`value`, ''), '%Y-%m-%d')),
    c.`technical_key` = COALESCE(c.`technical_key`, NULLIF(tk.`value`, '')),
    c.`environment` = IF(env.`value` IN ('1', '2'), env.`value`, c.`environment`)
WHERE c.`doc_type` = 'fv';

-- Las NC/ND legacy copiaban el prefijo de la FV: se desactivan para exigir una numeración propia.
UPDATE `dian_consecutives` c
JOIN `dian_consecutives` f ON f.`doc_type` = 'fv' AND f.`prefix` = c.`prefix`
SET c.`is_active` = 0
WHERE c.`doc_type` IN ('nc', 'nd');

-- 2. Documentos ------------------------------------------------------------------------------
ALTER TABLE `dian_invoices`
  ADD COLUMN IF NOT EXISTS `numbering_cycle` INT(10) UNSIGNED NOT NULL DEFAULT 0 AFTER `consecutive`,
  ADD COLUMN IF NOT EXISTS `environment` ENUM('1','2') NULL DEFAULT NULL AFTER `invoice_type`,
  ADD COLUMN IF NOT EXISTS `source_payment_id` INT(10) UNSIGNED NULL DEFAULT NULL COMMENT 'Pago de cartera que originó el documento' AFTER `order_id`,
  ADD COLUMN IF NOT EXISTS `payment_form` ENUM('1','2') NOT NULL DEFAULT '1' COMMENT '1 contado, 2 crédito' AFTER `payment_means_code`,
  ADD COLUMN IF NOT EXISTS `payment_due_date` DATE NULL DEFAULT NULL AFTER `payment_form`,
  ADD COLUMN IF NOT EXISTS `ref_document_id` INT(10) UNSIGNED NULL DEFAULT NULL COMMENT 'Factura referenciada por NC/ND' AFTER `payment_due_date`,
  ADD COLUMN IF NOT EXISTS `ref_invoice_number` VARCHAR(50) NULL DEFAULT NULL AFTER `ref_document_id`,
  ADD COLUMN IF NOT EXISTS `ref_cufe` VARCHAR(200) NULL DEFAULT NULL AFTER `ref_invoice_number`,
  ADD COLUMN IF NOT EXISTS `ref_issue_date` DATE NULL DEFAULT NULL AFTER `ref_cufe`,
  ADD COLUMN IF NOT EXISTS `discrepancy_code` VARCHAR(2) NULL DEFAULT NULL AFTER `ref_issue_date`,
  ADD COLUMN IF NOT EXISTS `discrepancy_description` VARCHAR(255) NULL DEFAULT NULL AFTER `discrepancy_code`,
  ADD COLUMN IF NOT EXISTS `software_security_code` VARCHAR(100) NULL DEFAULT NULL AFTER `cufe`,
  ADD COLUMN IF NOT EXISTS `qr_url` VARCHAR(500) NULL DEFAULT NULL AFTER `software_security_code`,
  ADD COLUMN IF NOT EXISTS `zip_filename` VARCHAR(255) NULL DEFAULT NULL AFTER `xml_filename`,
  ADD COLUMN IF NOT EXISTS `dian_operation` VARCHAR(30) NULL DEFAULT NULL AFTER `dian_track_id`,
  ADD COLUMN IF NOT EXISTS `dian_errors` LONGTEXT NULL DEFAULT NULL COMMENT 'JSON {errors, notices}' AFTER `dian_operation`,
  ADD COLUMN IF NOT EXISTS `application_response` LONGTEXT NULL DEFAULT NULL AFTER `dian_errors`,
  ADD COLUMN IF NOT EXISTS `attached_document` LONGTEXT NULL DEFAULT NULL AFTER `application_response`,
  ADD COLUMN IF NOT EXISTS `submission_attempts` INT(10) UNSIGNED NOT NULL DEFAULT 0 AFTER `attached_document`,
  ADD COLUMN IF NOT EXISTS `last_submission_at` DATETIME NULL DEFAULT NULL AFTER `submission_attempts`;

-- Estados: se amplía el ENUM, se migran los valores legacy y se deja solo el nuevo conjunto.
ALTER TABLE `dian_invoices`
  MODIFY `dian_status` ENUM('pending','sent','error','draft','signed','submitted','accepted','accepted_with_notices','rejected','send_error') DEFAULT 'draft';
UPDATE `dian_invoices` SET `dian_status` = 'draft' WHERE `dian_status` = 'pending';
UPDATE `dian_invoices` SET `dian_status` = 'submitted' WHERE `dian_status` = 'sent';
UPDATE `dian_invoices` SET `dian_status` = 'send_error' WHERE `dian_status` = 'error';
ALTER TABLE `dian_invoices`
  MODIFY `dian_status` ENUM('draft','signed','submitted','accepted','accepted_with_notices','rejected','send_error') DEFAULT 'draft';

-- Números repetidos del legacy (reinicios sin borrado) pasan a ciclos distintos antes del índice único.
UPDATE `dian_invoices` d
JOIN (
  SELECT `id`, ROW_NUMBER() OVER (PARTITION BY `prefix`, `invoice_type`, `consecutive` ORDER BY `id`) - 1 AS `cycle`
  FROM `dian_invoices`
) r ON r.`id` = d.`id`
SET d.`numbering_cycle` = r.`cycle`
WHERE r.`cycle` > 0 AND d.`numbering_cycle` = 0;

UPDATE `dian_consecutives` c
SET c.`numbering_cycle` = GREATEST(c.`numbering_cycle`, (
  SELECT COALESCE(MAX(d.`numbering_cycle`), 0) FROM `dian_invoices` d
  WHERE d.`prefix` = c.`prefix` AND d.`invoice_type` = c.`doc_type`
));

ALTER TABLE `dian_invoices`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_dian_number` (`prefix`, `invoice_type`, `consecutive`, `numbering_cycle`),
  ADD INDEX IF NOT EXISTS `idx_source_payment` (`source_payment_id`),
  ADD INDEX IF NOT EXISTS `idx_ref_document` (`ref_document_id`);

-- 3. Historial de envíos ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS `dian_document_submissions` (
  `id` INT(10) UNSIGNED NOT NULL AUTO_INCREMENT,
  `dian_invoice_id` INT(10) UNSIGNED NOT NULL,
  `operation` VARCHAR(30) NOT NULL,
  `outcome` VARCHAR(30) NOT NULL,
  `status_code` VARCHAR(10) NULL DEFAULT NULL,
  `status_message` TEXT NULL DEFAULT NULL,
  `errors` LONGTEXT NULL DEFAULT NULL COMMENT 'JSON array',
  `track_id` VARCHAR(200) NULL DEFAULT NULL,
  `created_at` DATETIME NOT NULL,
  PRIMARY KEY (`id`),
  KEY `idx_submission_document` (`dian_invoice_id`, `created_at`),
  CONSTRAINT `fk_submission_document` FOREIGN KEY (`dian_invoice_id`) REFERENCES `dian_invoices` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
