-- =============================================================================
-- academic-001 · Correcciones de integridad del contexto académico
-- MariaDB 10.11 · idempotente (puede ejecutarse varias veces)
-- Ver docs/analysis/02-academico.md §7.1
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1) student_grades — B1
--    El UNIQUE legacy (student_id, subject_id, academic_year, period) usaba la
--    columna `period` que nunca se escribía. La clave real es period_id.
--    El índice nuevo se crea antes de borrar el viejo para que la FK de
--    student_id siempre tenga un índice que la respalde.
-- -----------------------------------------------------------------------------
ALTER TABLE `student_grades`
  MODIFY COLUMN `period` TINYINT(3) UNSIGNED NOT NULL DEFAULT 0
  COMMENT 'Legacy: número del período en el año (la clave real es period_id)';

ALTER TABLE `student_grades`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_student_subject_period` (`student_id`, `subject_id`, `period_id`);

ALTER TABLE `student_grades` DROP INDEX IF EXISTS `unique_grade`;

-- -----------------------------------------------------------------------------
-- 2) group_directors — B5
--    UNIQUE (classroom_id, is_active) impedía tener más de una fila inactiva
--    por salón (no se podía reasignar ni quitar director por segunda vez).
--    Se reemplaza por un UNIQUE sobre una columna generada que solo tiene
--    valor para la fila activa: "un director activo por salón" + historial.
-- -----------------------------------------------------------------------------
ALTER TABLE `group_directors`
  ADD COLUMN IF NOT EXISTS `active_classroom_id` INT(10) UNSIGNED
  AS (IF(`is_active` = 1, `classroom_id`, NULL)) PERSISTENT;

ALTER TABLE `group_directors`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_one_active_director` (`active_classroom_id`);

ALTER TABLE `group_directors`
  ADD INDEX IF NOT EXISTS `idx_group_directors_classroom` (`classroom_id`);

ALTER TABLE `group_directors` DROP INDEX IF EXISTS `idx_active_director`;

-- -----------------------------------------------------------------------------
-- 3) teacher_assignments — regla 7: un docente por (materia, salón, año)
--    Solo la aplicación lo validaba. Si existen duplicados se conserva la
--    asignación más reciente (la que el legacy mostraba al editar).
-- -----------------------------------------------------------------------------
DELETE older
  FROM `teacher_assignments` older
  JOIN `teacher_assignments` newer
    ON newer.`subject_id` = older.`subject_id`
   AND newer.`classroom_id` = older.`classroom_id`
   AND newer.`academic_year` = older.`academic_year`
   AND newer.`id` > older.`id`;

ALTER TABLE `teacher_assignments`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_subject_classroom_year` (`subject_id`, `classroom_id`, `academic_year`);

-- -----------------------------------------------------------------------------
-- 4) attendance_records — reglas 28-30
--    `source` distingue escaneo QR de pase de lista manual (nuevo).
--    Un registro por (alumno, materia, salón, fecha); si hay duplicados se
--    conserva el primero (el escaneo original).
-- -----------------------------------------------------------------------------
ALTER TABLE `attendance_records`
  ADD COLUMN IF NOT EXISTS `source` ENUM('qr', 'manual') NOT NULL DEFAULT 'qr' AFTER `status`;

DELETE later
  FROM `attendance_records` later
  JOIN `attendance_records` earlier
    ON earlier.`student_id` = later.`student_id`
   AND earlier.`subject_id` <=> later.`subject_id`
   AND earlier.`classroom_id` <=> later.`classroom_id`
   AND earlier.`attendance_date` = later.`attendance_date`
   AND earlier.`id` < later.`id`;

ALTER TABLE `attendance_records`
  ADD UNIQUE INDEX IF NOT EXISTS `uk_attendance_class_day` (`student_id`, `subject_id`, `classroom_id`, `attendance_date`);

-- -----------------------------------------------------------------------------
-- 5) Índices de consulta frecuente
-- -----------------------------------------------------------------------------
ALTER TABLE `academic_periods`
  ADD INDEX IF NOT EXISTS `idx_periods_year_start` (`academic_year`, `start_date`);

ALTER TABLE `classrooms`
  ADD INDEX IF NOT EXISTS `idx_classrooms_year` (`academic_year`);

ALTER TABLE `teacher_assignments`
  ADD INDEX IF NOT EXISTS `idx_assignments_employee_year` (`employee_id`, `academic_year`);

ALTER TABLE `attendance_records`
  ADD INDEX IF NOT EXISTS `idx_attendance_date_classroom` (`attendance_date`, `classroom_id`);
