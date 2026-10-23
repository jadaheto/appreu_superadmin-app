-- =============================================================================
-- hr-001 · Employees, payroll state machine, legal parameters, leave workflow,
--          novelties and verifiable documents
-- Context: hr (analysis docs/analysis/07-rrhh-nomina.md)
-- MariaDB 10.11 · idempotent (safe to run more than once)
-- Requires identity-001 (users.must_change_password) to be applied first.
-- =============================================================================

-- 1. Employees: ARL risk class, integral salary, garnishment type, withholding
--    data (procedimiento 1) and logical retirement (B-27, D-8, L-5, L-7).
ALTER TABLE `employees`
  ADD COLUMN IF NOT EXISTS `arl_risk_class` tinyint(3) unsigned NOT NULL DEFAULT 1 AFTER `arl`,
  ADD COLUMN IF NOT EXISTS `integral_salary` tinyint(1) NOT NULL DEFAULT 0 AFTER `base_salary`,
  ADD COLUMN IF NOT EXISTS `embargo_alimony` tinyint(1) NOT NULL DEFAULT 0 AFTER `fixed_embargo`,
  ADD COLUMN IF NOT EXISTS `withholding_dependents` tinyint(1) NOT NULL DEFAULT 0 AFTER `arl_risk_class`,
  ADD COLUMN IF NOT EXISTS `withholding_prepaid_health` decimal(10,2) NOT NULL DEFAULT 0.00 AFTER `withholding_dependents`,
  ADD COLUMN IF NOT EXISTS `withholding_housing_interest` decimal(10,2) NOT NULL DEFAULT 0.00 AFTER `withholding_prepaid_health`,
  ADD COLUMN IF NOT EXISTS `voluntary_pension` decimal(10,2) NOT NULL DEFAULT 0.00 AFTER `withholding_housing_interest`,
  ADD COLUMN IF NOT EXISTS `retirement_date` date DEFAULT NULL AFTER `hire_date`,
  ADD COLUMN IF NOT EXISTS `retirement_reason` varchar(255) DEFAULT NULL AFTER `retirement_date`,
  ADD COLUMN IF NOT EXISTS `updated_at` timestamp NULL DEFAULT NULL ON UPDATE current_timestamp() AFTER `created_at`;

-- Link legacy employees to their user by e-mail (B-2; analysis §6.7). Only staff accounts.
UPDATE `employees` e
  JOIN `users` u ON u.`email` = e.`email`
  SET e.`user_id` = u.`id`
  WHERE e.`user_id` IS NULL
    AND e.`email` IS NOT NULL AND e.`email` <> ''
    AND u.`role` NOT IN ('student', 'parent')
    AND NOT EXISTS (SELECT 1 FROM (SELECT `user_id` FROM `employees` WHERE `user_id` IS NOT NULL) linked WHERE linked.`user_id` = u.`id`);

-- Collision-free employee codes (B-1): counter initialised with the highest EMP#### in use.
CREATE TABLE IF NOT EXISTS `hr_sequences` (
  `name` varchar(50) NOT NULL,
  `last_value` int(10) unsigned NOT NULL DEFAULT 0,
  PRIMARY KEY (`name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
INSERT IGNORE INTO `hr_sequences` (`name`, `last_value`)
  SELECT 'employee_code', COALESCE(MAX(CAST(SUBSTRING(`code`, 4) AS UNSIGNED)), 0)
  FROM `employees` WHERE `code` REGEXP '^EMP[0-9]+$';

-- 2. Payroll periods: explicit frequency and the DRAFT → CALCULATED → APPROVED → PAID
--    machine (+ CANCELLED). Unused legacy states are mapped (B-12).
ALTER TABLE `payroll_periods`
  MODIFY COLUMN `status` enum('draft','open','closed','calculated','approved','paid','cancelled') DEFAULT 'draft';
UPDATE `payroll_periods` SET `status` = 'draft' WHERE `status` = 'open';
UPDATE `payroll_periods` SET `status` = 'approved' WHERE `status` = 'closed';
ALTER TABLE `payroll_periods`
  ADD COLUMN IF NOT EXISTS `frequency` enum('monthly','biweekly') NOT NULL DEFAULT 'monthly' AFTER `payment_date`,
  ADD COLUMN IF NOT EXISTS `calculated_by` int(10) unsigned DEFAULT NULL AFTER `created_by`,
  ADD COLUMN IF NOT EXISTS `calculated_at` datetime DEFAULT NULL AFTER `calculated_by`,
  ADD COLUMN IF NOT EXISTS `approved_by` int(10) unsigned DEFAULT NULL AFTER `calculated_at`,
  ADD COLUMN IF NOT EXISTS `approved_at` datetime DEFAULT NULL AFTER `approved_by`,
  ADD COLUMN IF NOT EXISTS `paid_at` datetime DEFAULT NULL AFTER `approved_at`,
  ADD COLUMN IF NOT EXISTS `cancelled_at` datetime DEFAULT NULL AFTER `paid_at`,
  ADD COLUMN IF NOT EXISTS `cancellation_reason` varchar(255) DEFAULT NULL AFTER `cancelled_at`;
UPDATE `payroll_periods` SET `frequency` = 'biweekly'
  WHERE DATEDIFF(`period_end`, `period_start`) BETWEEN 1 AND 16 AND `frequency` = 'monthly';
ALTER TABLE `payroll_periods`
  ADD INDEX IF NOT EXISTS `idx_payroll_periods_range` (`period_start`, `period_end`),
  ADD INDEX IF NOT EXISTS `idx_payroll_periods_year_status` (`year`, `status`);

-- 3. Payslips: traceability columns (worked days, IBC, FSP, other deductions, notes).
ALTER TABLE `payroll_payments`
  ADD COLUMN IF NOT EXISTS `worked_days` tinyint(3) unsigned NOT NULL DEFAULT 30 AFTER `payroll_period_id`,
  ADD COLUMN IF NOT EXISTS `ibc` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `worked_days`,
  ADD COLUMN IF NOT EXISTS `leave_pay` decimal(12,2) NOT NULL DEFAULT 0.00 AFTER `base_salary`,
  ADD COLUMN IF NOT EXISTS `solidarity_fund_deduction` decimal(10,2) NOT NULL DEFAULT 0.00 AFTER `health_deduction`,
  ADD COLUMN IF NOT EXISTS `other_deductions` decimal(10,2) NOT NULL DEFAULT 0.00 AFTER `embargo_deduction`,
  ADD COLUMN IF NOT EXISTS `calculation_notes` text DEFAULT NULL COMMENT 'JSON: ajustes por límites de descuentos' AFTER `status`;

-- Payroll history must never disappear with an employee or a period (B-27).
ALTER TABLE `payroll_payments` DROP FOREIGN KEY IF EXISTS `payroll_payments_ibfk_1`;
ALTER TABLE `payroll_payments` DROP FOREIGN KEY IF EXISTS `payroll_payments_ibfk_2`;
ALTER TABLE `payroll_payments`
  ADD CONSTRAINT `fk_payroll_payments_employee` FOREIGN KEY IF NOT EXISTS (`employee_id`)
    REFERENCES `employees` (`id`) ON DELETE RESTRICT;
ALTER TABLE `payroll_payments`
  ADD CONSTRAINT `fk_payroll_payments_period` FOREIGN KEY IF NOT EXISTS (`payroll_period_id`)
    REFERENCES `payroll_periods` (`id`) ON DELETE RESTRICT;

-- 4. Legal payroll parameters per year (D-5, L-1). 2025 and 2026 legal values.
CREATE TABLE IF NOT EXISTS `payroll_parameters` (
  `year` smallint(5) unsigned NOT NULL,
  `minimum_wage` decimal(12,2) NOT NULL,
  `transport_allowance` decimal(12,2) NOT NULL,
  `uvt` decimal(12,2) NOT NULL,
  `rates` longtext NOT NULL COMMENT 'JSON: tasas de salud, pensión, parafiscales y ARL por clase',
  `employer_contribution_exemption` tinyint(1) NOT NULL DEFAULT 0 COMMENT 'Art. 114-1 ET',
  `updated_by` int(10) unsigned DEFAULT NULL,
  `updated_at` timestamp NULL DEFAULT current_timestamp() ON UPDATE current_timestamp(),
  PRIMARY KEY (`year`),
  CONSTRAINT `fk_payroll_parameters_user` FOREIGN KEY (`updated_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
INSERT IGNORE INTO `payroll_parameters` (`year`, `minimum_wage`, `transport_allowance`, `uvt`, `rates`) VALUES
  (2025, 1423500.00, 200000.00, 49799.00,
   '{"healthEmployee":4,"pensionEmployee":4,"healthEmployer":8.5,"pensionEmployer":12,"sena":2,"icbf":3,"ccf":4,"arl":{"1":0.522,"2":1.044,"3":2.436,"4":4.35,"5":6.96}}'),
  (2026, 1750905.00, 249095.00, 52374.00,
   '{"healthEmployee":4,"pensionEmployee":4,"healthEmployer":8.5,"pensionEmployer":12,"sena":2,"icbf":3,"ccf":4,"arl":{"1":0.522,"2":1.044,"3":2.436,"4":4.35,"5":6.96}}');

-- 5. Payroll novelties (one-off earnings and deductions per period and employee).
CREATE TABLE IF NOT EXISTS `payroll_novelties` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `payroll_period_id` int(10) unsigned NOT NULL,
  `employee_id` int(10) unsigned NOT NULL,
  `type` enum('overtime','bonus_salary','bonus_non_salary','libranza','sindicato','embargo','other_deduction') NOT NULL,
  `amount` decimal(12,2) NOT NULL,
  `description` varchar(255) DEFAULT NULL,
  `created_by` int(10) unsigned DEFAULT NULL,
  `created_at` timestamp NULL DEFAULT current_timestamp(),
  PRIMARY KEY (`id`),
  KEY `idx_payroll_novelties_period` (`payroll_period_id`),
  KEY `idx_payroll_novelties_employee` (`employee_id`),
  CONSTRAINT `fk_payroll_novelties_period` FOREIGN KEY (`payroll_period_id`) REFERENCES `payroll_periods` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_payroll_novelties_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_payroll_novelties_user` FOREIGN KEY (`created_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;

-- 6. Leave approval workflow (B-22, B-35): new types, cancelled state and decision data.
ALTER TABLE `employee_leaves`
  MODIFY COLUMN `leave_type` enum('vacaciones','licencia_medica','licencia_maternidad','licencia_paternidad',
    'licencia_no_remunerada','permiso_sindical','calamidad','comision','otro') NOT NULL,
  MODIFY COLUMN `status` enum('pending','approved','rejected','cancelled') DEFAULT 'pending';
ALTER TABLE `employee_leaves`
  ADD COLUMN IF NOT EXISTS `requested_by` int(10) unsigned DEFAULT NULL AFTER `status`,
  ADD COLUMN IF NOT EXISTS `decided_by` int(10) unsigned DEFAULT NULL AFTER `requested_by`,
  ADD COLUMN IF NOT EXISTS `decided_at` datetime DEFAULT NULL AFTER `decided_by`,
  ADD COLUMN IF NOT EXISTS `decision_note` varchar(255) DEFAULT NULL AFTER `decided_at`;
ALTER TABLE `employee_leaves`
  ADD INDEX IF NOT EXISTS `idx_employee_leaves_range` (`employee_id`, `status`, `start_date`, `end_date`);
ALTER TABLE `employee_leaves` DROP FOREIGN KEY IF EXISTS `employee_leaves_ibfk_1`;
ALTER TABLE `employee_leaves`
  ADD CONSTRAINT `fk_employee_leaves_employee` FOREIGN KEY IF NOT EXISTS (`employee_id`)
    REFERENCES `employees` (`id`) ON DELETE RESTRICT;

-- 7. Issued documents with verification code (S-15, D-10).
CREATE TABLE IF NOT EXISTS `hr_issued_documents` (
  `id` int(10) unsigned NOT NULL AUTO_INCREMENT,
  `code` varchar(40) NOT NULL,
  `type` varchar(40) NOT NULL,
  `employee_id` int(10) unsigned NOT NULL,
  `content` longtext NOT NULL COMMENT 'JSON: contenido congelado del documento',
  `issued_by` int(10) unsigned DEFAULT NULL,
  `issued_at` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uk_hr_issued_documents_code` (`code`),
  KEY `idx_hr_issued_documents_employee` (`employee_id`),
  CONSTRAINT `fk_hr_issued_documents_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE RESTRICT,
  CONSTRAINT `fk_hr_issued_documents_user` FOREIGN KEY (`issued_by`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_general_ci;
