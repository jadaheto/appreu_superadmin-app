-- =============================================================================
-- students-001 · Portal account links, certificate verification and code sequence
-- Context: students (analysis docs/analysis/03-estudiantes-incidencias.md)
-- MariaDB 10.11 · idempotent (safe to run more than once)
-- =============================================================================

-- 1. Guardian ↔ user link (bug B14: the legacy portal queried `guardians.user_id`,
--    which did not exist, so guardians could never use the portal).
ALTER TABLE `guardians`
  ADD COLUMN IF NOT EXISTS `user_id` int(10) unsigned DEFAULT NULL AFTER `relationship`;
ALTER TABLE `guardians`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_guardians_user` (`user_id`);
ALTER TABLE `guardians`
  ADD CONSTRAINT `fk_guardians_user` FOREIGN KEY IF NOT EXISTS (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL;

-- 2. Certificate verification code and data snapshot frozen at issuance.
ALTER TABLE `certificates`
  ADD COLUMN IF NOT EXISTS `verification_code` varchar(64) DEFAULT NULL AFTER `created_at`,
  ADD COLUMN IF NOT EXISTS `snapshot` longtext DEFAULT NULL COMMENT 'JSON: datos del estudiante al emitir' AFTER `verification_code`;
ALTER TABLE `certificates`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_certificates_verification_code` (`verification_code`),
  ADD INDEX IF NOT EXISTS `idx_certificates_payment` (`payment_id`);

-- 3. Transactional counter of student codes AL{YYYY}{NNNN} (bug B11).
CREATE TABLE IF NOT EXISTS `student_code_sequences` (
  `year` smallint(5) unsigned NOT NULL,
  `last_value` int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`year`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- Seed the counters with the highest sequence already used per year.
INSERT IGNORE INTO `student_code_sequences` (`year`, `last_value`)
SELECT CAST(SUBSTRING(`code`, 3, 4) AS UNSIGNED), MAX(CAST(SUBSTRING(`code`, 7) AS UNSIGNED))
FROM `students`
WHERE `code` REGEXP '^AL[0-9]{4}[0-9]+$'
GROUP BY SUBSTRING(`code`, 3, 4);

-- 4. Backfill of portal links using the legacy e-mail convention (bug B12):
--    students got `email` or `{code}@apreu.co`; guardians their own e-mail.
--    Ambiguous e-mails (shared by several records) are left for manual linking.
UPDATE `students` s
JOIN `users` u ON u.role = 'student' AND (u.email = s.email OR u.email = CONCAT(LOWER(s.code), '@apreu.co'))
SET s.user_id = u.id
WHERE s.user_id IS NULL
  AND (s.email IS NULL OR (SELECT COUNT(*) FROM (SELECT email FROM `students`) same WHERE same.email = s.email) = 1)
  AND NOT EXISTS (SELECT 1 FROM (SELECT user_id FROM `students` WHERE user_id IS NOT NULL) linked WHERE linked.user_id = u.id);

UPDATE `guardians` g
JOIN `users` u ON u.role = 'parent' AND u.email = g.email
SET g.user_id = u.id
WHERE g.user_id IS NULL
  AND g.email IS NOT NULL AND g.email <> ''
  AND (SELECT COUNT(*) FROM (SELECT email FROM `guardians`) same WHERE same.email = g.email) = 1
  AND NOT EXISTS (SELECT 1 FROM (SELECT user_id FROM `guardians` WHERE user_id IS NOT NULL) linked WHERE linked.user_id = u.id);
