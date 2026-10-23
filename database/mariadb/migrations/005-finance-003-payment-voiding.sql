-- finance-003 · Auditoría de anulación de pagos (estado `reversed`, no implementado en legacy, bug B52).
-- Idempotente (MariaDB 10.11).

ALTER TABLE `payments`
  ADD COLUMN IF NOT EXISTS `voided_at` datetime DEFAULT NULL AFTER `reconciled_by`,
  ADD COLUMN IF NOT EXISTS `voided_by` int(10) unsigned DEFAULT NULL AFTER `voided_at`,
  ADD COLUMN IF NOT EXISTS `void_reason` varchar(255) DEFAULT NULL AFTER `voided_by`;

ALTER TABLE `payments`
  ADD CONSTRAINT `fk_payments_voided_by` FOREIGN KEY IF NOT EXISTS (`voided_by`) REFERENCES `users` (`id`) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS `idx_payments_student_status` ON `payments` (`student_id`, `status`);
CREATE INDEX IF NOT EXISTS `idx_payments_bank_ref` ON `payments` (`bank_ref`);
