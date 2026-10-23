-- identity-001: forced password change after an administrator assigns a temporary password (ADR-0005).
-- MariaDB 10.11, idempotent.
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `must_change_password` tinyint(1) NOT NULL DEFAULT 0 AFTER `last_login`;
