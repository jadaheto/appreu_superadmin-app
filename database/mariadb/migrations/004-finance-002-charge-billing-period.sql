-- finance-002 · Mes facturado explícito en los cargos.
-- La deduplicación legacy comparaba el mes del vencimiento con el mes facturado y
-- duplicaba cargos cuando el vencimiento caía en otro mes (bug B12).
-- Idempotente (MariaDB 10.11).

ALTER TABLE `student_charges`
  ADD COLUMN IF NOT EXISTS `billing_period` char(7) DEFAULT NULL COMMENT 'Mes facturado YYYY-MM' AFTER `due_date`;

UPDATE `student_charges`
   SET `billing_period` = DATE_FORMAT(`due_date`, '%Y-%m')
 WHERE `billing_period` IS NULL;

CREATE INDEX IF NOT EXISTS `idx_charge_concept_period`
  ON `student_charges` (`concept_id`, `billing_period`, `student_id`);
