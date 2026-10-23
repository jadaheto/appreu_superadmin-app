# Mapa de tipos MariaDB → PostgreSQL (columnas con cambio relevante)

Generado al convertir el esquema final de MariaDB (`apreu_demo` = baseline + migraciones 001–011, y `apreu_master`) a `tenant-schema.sql` / `master-schema.sql`, según [ADR-0008](../../docs/adr/0008-postgresql.md). Lo usan los agentes de backend (entidades ORM y SQL) y la herramienta de importación `database/tools/mariadb-to-postgres/`.

Cambios generales que **no** se listan columna por columna:

- `int`/`int unsigned` → `integer`; `decimal(p,s)` → `numeric(p,s)`; `text`/`mediumtext`/`longtext` sin JSON → `text`; `varchar`/`char`/`date`/`time` sin cambio.
- Se pierde `unsigned` (no se añadieron `CHECK (col >= 0)`); ningún valor actual supera 2^31.
- Nombres de tablas y columnas idénticos. Nombres de índices/restricciones nuevos (`<tabla>_<cols>_key|_idx|_fkey|_check`, `<tabla>_pkey`).
- Unicidad de `users.email` (colegio y maestra) ahora es `UNIQUE (lower(email))`: guardar en minúscula; `ON CONFLICT` debe usar `((lower(email)))`.
- Comparaciones de texto pasan a ser sensibles a mayúsculas y tildes: buscar con `f_unaccent(col) ILIKE f_unaccent($1)`.

## 1. `tinyint(1)` → `boolean`

Todas las `tinyint(1)` eran banderas (verificado: solo valores 0/1 en `apreu_demo` y `apreu_colegio_norte`, y las entidades ORM las mapean a `boolean`). Importación: `0→false`, `1→true`, `NULL→NULL`. SQL: `col = true` / `col IS TRUE`, nunca `= 1`.

| Columna | MariaDB | PostgreSQL | NULL | Default |
|---|---|---|---|---|
| `access_log.allowed` | `tinyint(1)` | `boolean` | NOT NULL | true |
| `accounting_accounts.is_transactional` | `tinyint(1)` | `boolean` | NULL | false |
| `accounting_third_parties.is_active` | `tinyint(1)` | `boolean` | NULL | true |
| `billing_concepts.is_active` | `tinyint(1)` | `boolean` | NULL | true |
| `dian_consecutives.is_active` | `tinyint(1)` | `boolean` | NOT NULL | true |
| `dian_invoices.email_sent` | `tinyint(1)` | `boolean` | NULL | false |
| `employee_stickers.is_read` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `employees.embargo_alimony` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `employees.integral_salary` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `employees.withholding_dependents` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `group_directors.is_active` | `tinyint(1)` | `boolean` | NULL | true |
| `inventory_items.is_active` | `tinyint(1)` | `boolean` | NOT NULL | true |
| `notifications.is_read` | `tinyint(1)` | `boolean` | NULL | false |
| `payments.reconciled` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `payroll_parameters.employer_contribution_exemption` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `users.is_active` | `tinyint(1)` | `boolean` | NOT NULL | true |
| `users.must_change_password` | `tinyint(1)` | `boolean` | NOT NULL | false |
| `tenants.tables_created` (maestra) | `tinyint(1)` | `boolean` | NOT NULL | false |
| `users.is_active` (maestra) | `tinyint(1)` | `boolean` | NOT NULL | true |
| `users.must_change_password` (maestra) | `tinyint(1)` | `boolean` | NOT NULL | false |

Total: 20 columnas.

## 2. `tinyint(3) unsigned` / `smallint unsigned` (no banderas) → `smallint`

Contadores o números pequeños; siguen siendo enteros. En las entidades: `type: 'smallint'` (sin `unsigned`).

| Columna | MariaDB | PostgreSQL | NULL | Default |
|---|---|---|---|---|
| `classrooms.capacity` | `tinyint(3) unsigned` | `smallint` | NULL | 30 |
| `employees.arl_risk_class` | `tinyint(3) unsigned` | `smallint` | NOT NULL | 1 |
| `finance_receipt_sequences.year` | `smallint(5) unsigned` | `smallint` | NOT NULL | — |
| `grades_records.period` | `tinyint(3) unsigned` | `smallint` | NOT NULL | — |
| `payroll_parameters.year` | `smallint(5) unsigned` | `smallint` | NOT NULL | — |
| `payroll_payments.worked_days` | `tinyint(3) unsigned` | `smallint` | NOT NULL | 30 |
| `report_cards.period` | `tinyint(3) unsigned` | `smallint` | NOT NULL | — |
| `student_code_sequences.year` | `smallint(5) unsigned` | `smallint` | NOT NULL | — |
| `student_grades.period` | `tinyint(3) unsigned` | `smallint` | NOT NULL | 0 |
| `students.siblings_count` | `tinyint(3) unsigned` | `smallint` | NULL | 0 |
| `subjects.credits` | `tinyint(3) unsigned` | `smallint` | NULL | 1 |
| `subjects.hours_per_week` | `tinyint(3) unsigned` | `smallint` | NULL | 1 |

Total: 12 columnas.

## 3. `year(4)` → `smallint`

Importación: valor numérico del año; `0000` → `NULL`.

| Columna | MariaDB | PostgreSQL | NULL | Default |
|---|---|---|---|---|
| `academic_periods.academic_year` | `year(4)` | `smallint` | NOT NULL | — |
| `charges.academic_year` | `year(4)` | `smallint` | NOT NULL | — |
| `classrooms.academic_year` | `year(4)` | `smallint` | NOT NULL | — |
| `grade_tuition.academic_year` | `year(4)` | `smallint` | NOT NULL | — |
| `payroll_periods.year` | `year(4)` | `smallint` | NULL | — |
| `student_charges.academic_year` | `year(4)` | `smallint` | NOT NULL | — |
| `student_grades.academic_year` | `year(4)` | `smallint` | NOT NULL | — |
| `students.academic_year` | `year(4)` | `smallint` | NULL | — |

Total: 8 columnas.

## 4. `enum(...)` → `varchar(n)` + `CHECK (col IN (...))`

Restricción `<tabla>_<col>_check`. En MariaDB el `enum` comparaba sin distinguir mayúsculas y aceptaba `''` en modo no estricto; en PG el valor debe coincidir exactamente: la importación debe normalizar (p. ej. `document_type` en minúscula/mayúscula según la lista) y convertir `''` a `NULL` o al valor por defecto. `ORDER BY` sobre la columna ahora es alfabético (MariaDB ordenaba por la posición en el enum). Entidades: `type: 'varchar'` con `length` (no usar `type: 'enum'`, que crearía tipos ENUM de PG).

| Columna | Tipo PG | NULL | Default | Valores permitidos |
|---|---|---|---|---|
| `academic_periods.status` | `varchar(20)` | NULL | 'open' | 'open', 'closed', 'bulletins_generated' |
| `accounting_accounts.type` | `varchar(10)` | NOT NULL | — | 'activo', 'pasivo', 'patrimonio', 'ingreso', 'gasto', 'costo', 'orden' |
| `accounting_journal_entries.entry_type` | `varchar(10)` | NOT NULL | — | 'RC', 'CE', 'FC', 'FV', 'NC', 'ND', 'NI', 'SALA' |
| `accounting_journal_entries.status` | `varchar(10)` | NULL | 'draft' | 'draft', 'posted', 'voided' |
| `accounting_periods.status` | `varchar(10)` | NULL | 'open' | 'open', 'closed' |
| `accounting_sequences.entry_type` | `varchar(10)` | NOT NULL | — | 'RC', 'CE', 'FC', 'FV', 'NC', 'ND', 'NI', 'SALA' |
| `accounting_third_parties.document_type` | `varchar(10)` | NULL | 'CC' | 'NIT', 'CC', 'CE', 'TI', 'Pasaporte' |
| `attendance_records.source` | `varchar(10)` | NOT NULL | 'qr' | 'qr', 'manual' |
| `attendance_records.status` | `varchar(10)` | NULL | 'present' | 'present', 'absent', 'late', 'excused' |
| `billing_concepts.category` | `varchar(20)` | NULL | 'pension' | 'matricula', 'pension', 'mensualidad', 'servicios', 'materiales', 'transporte', 'alimentacion', 'certificado', 'recargo', 'inscripcion', 'otro' |
| `certificates.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'approved', 'generated', 'cancelled' |
| `charges.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'partial', 'paid', 'cancelled' |
| `dian_consecutives.doc_type` | `varchar(10)` | NOT NULL | 'fv' | 'fv', 'nd', 'nc' |
| `dian_consecutives.environment` | `varchar(10)` | NOT NULL | '2' | '1', '2' |
| `dian_invoices.dian_status` | `varchar(30)` | NULL | 'draft' | 'draft', 'signed', 'submitted', 'accepted', 'accepted_with_notices', 'rejected', 'send_error' |
| `dian_invoices.environment` | `varchar(10)` | NULL | — | '1', '2' |
| `dian_invoices.invoice_type` | `varchar(10)` | NOT NULL | 'fv' | 'fv', 'nd', 'nc' |
| `dian_invoices.payment_form` | `varchar(10)` | NOT NULL | '1' | '1', '2' |
| `email_log.status` | `varchar(10)` | NULL | 'sent' | 'sent', 'failed', 'pending' |
| `email_log.type` | `varchar(20)` | NULL | 'aviso' | 'aviso', 'factura_cobro', 'factura_dian', 'otro' |
| `employee_leaves.leave_type` | `varchar(30)` | NOT NULL | — | 'vacaciones', 'licencia_medica', 'licencia_maternidad', 'licencia_paternidad', 'licencia_no_remunerada', 'permiso_sindical', 'calamidad', 'comision', 'otro' |
| `employee_leaves.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'approved', 'rejected', 'cancelled' |
| `employee_stickers.color` | `varchar(10)` | NULL | 'yellow' | 'yellow', 'red', 'green', 'blue', 'purple' |
| `employee_stickers.priority` | `varchar(10)` | NULL | 'normal' | 'normal', 'urgent' |
| `employees.account_type` | `varchar(10)` | NULL | 'ahorros' | 'ahorros', 'corriente' |
| `employees.contract_type` | `varchar(10)` | NULL | 'indefinido' | 'indefinido', 'fijo', 'obra', 'prestacion' |
| `employees.document_type` | `varchar(10)` | NULL | 'cc' | 'cc', 'pa', 'ext' |
| `employees.employee_type` | `varchar(20)` | NULL | 'docente' | 'docente', 'administrativo', 'directivo', 'servicios', 'otro' |
| `employees.gender` | `varchar(10)` | NULL | 'M' | 'M', 'F', 'O' |
| `employees.status` | `varchar(10)` | NULL | 'active' | 'active', 'inactive', 'suspended', 'retired', 'on_leave' |
| `guardians.document_type` | `varchar(10)` | NULL | 'cc' | 'cc', 'ti', 'ce', 'pa', 'rc' |
| `guardians.relationship` | `varchar(10)` | NULL | 'padre' | 'padre', 'madre', 'abuelo', 'abuela', 'tio', 'tia', 'otro' |
| `incidents.priority` | `varchar(10)` | NULL | 'medium' | 'low', 'medium', 'high', 'critical' |
| `incidents.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'in_review', 'approved', 'rejected', 'closed' |
| `incidents.type` | `varchar(20)` | NULL | 'otra' | 'incapacidad', 'salida_clase', 'firma_libro', 'izada_bandera', 'baja_estudiante', 'ajuste_pago', 'cierre_caja', 'otra' |
| `inventory_movements.type` | `varchar(10)` | NOT NULL | — | 'inicial', 'entrada', 'salida', 'ajuste' |
| `invoices.dian_environment` | `varchar(10)` | NULL | '2' | '1', '2' |
| `invoices.status` | `varchar(10)` | NULL | 'draft' | 'draft', 'emitida', 'sent', 'accepted', 'rejected', 'paid', 'cancelled', 'anulada' |
| `notifications.type` | `varchar(10)` | NULL | 'info' | 'info', 'success', 'warning', 'error' |
| `payments.payment_method` | `varchar(20)` | NULL | 'efectivo' | 'efectivo', 'transferencia', 'nequi', 'daviplata', 'breb', 'transferencia_ext', 'tarjeta', 'pse', 'cheque', 'datafono' |
| `payments.status` | `varchar(10)` | NULL | 'applied' | 'applied', 'reversed', 'pending' |
| `payroll_novelties.type` | `varchar(20)` | NOT NULL | — | 'overtime', 'bonus_salary', 'bonus_non_salary', 'libranza', 'sindicato', 'embargo', 'other_deduction' |
| `payroll_payments.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'paid', 'cancelled' |
| `payroll_periods.frequency` | `varchar(10)` | NOT NULL | 'monthly' | 'monthly', 'biweekly' |
| `payroll_periods.status` | `varchar(10)` | NULL | 'draft' | 'draft', 'open', 'closed', 'calculated', 'approved', 'paid', 'cancelled' |
| `student_certificates.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'approved', 'rejected' |
| `student_certificates.type` | `varchar(10)` | NULL | 'estudio' | 'estudio', 'beca', 'conducta', 'otro' |
| `student_charges.status` | `varchar(10)` | NULL | 'pending' | 'pending', 'partial', 'paid', 'overdue', 'cancelled' |
| `students.document_type` | `varchar(10)` | NULL | 'TI' | 'TI', 'CC', 'CE', 'PP', 'RC' |
| `students.gender` | `varchar(10)` | NULL | 'M' | 'M', 'F', 'O' |
| `students.status` | `varchar(10)` | NOT NULL | 'active' | 'active', 'inactive', 'graduated', 'withdrawn', 'suspended' |
| `users.role` | `varchar(10)` | NOT NULL | 'admin' | 'superadmin', 'admin', 'finance', 'hr', 'teacher', 'parent', 'student', 'employee' |
| `whatsapp_log.status` | `varchar(10)` | NULL | 'sent' | 'sent', 'delivered', 'read', 'failed' |
| `whatsapp_templates.category` | `varchar(20)` | NULL | 'utility' | 'utility', 'marketing', 'authentication' |
| `whatsapp_templates.header_type` | `varchar(10)` | NULL | 'none' | 'none', 'text', 'image' |
| `whatsapp_templates.status` | `varchar(10)` | NULL | 'active' | 'active', 'pending', 'rejected' |
| `tenants.status` (maestra) | `varchar(10)` | NOT NULL | 'active' | 'active', 'suspended', 'trial' |
| `users.role` (maestra) | `varchar(10)` | NOT NULL | 'admin' | 'superadmin', 'admin', 'finance', 'hr', 'teacher', 'parent', 'student', 'employee' |

Total: 58 columnas.

## 5. `json`/`longtext`/`text` con JSON → `jsonb`

`pg` devuelve objetos ya parseados (no string): quitar `JSON.parse`/`JSON.stringify` o los *transformers* `jsonText`. `jsonb` no conserva espacios ni orden de claves. Importación: validar JSON; texto inválido o vacío → `NULL` (o `'{}'`/`'[]'` si la columna es `NOT NULL`).

| Columna | MariaDB | PostgreSQL | NULL | Default |
|---|---|---|---|---|
| `ai_marketing_campaigns.crm_data_used` | `text` | `jsonb` | NULL | — |
| `certificates.snapshot` | `longtext` | `jsonb` | NULL | — |
| `dian_document_submissions.errors` | `longtext` | `jsonb` | NULL | — |
| `dian_invoices.dian_errors` | `longtext` | `jsonb` | NULL | — |
| `dian_invoices.lines_data` | `longtext` | `jsonb` | NULL | — |
| `hr_issued_documents.content` | `longtext` | `jsonb` | NOT NULL | — |
| `payroll_parameters.rates` | `longtext` | `jsonb` | NOT NULL | — |
| `payroll_payments.calculation_notes` | `text` | `jsonb` | NULL | — |
| `whatsapp_templates.buttons` | `longtext` | `jsonb` | NULL | — |
| `whatsapp_templates.variables` | `text` | `jsonb` | NULL | — |

Total: 10 columnas.

## 6. `datetime` / `timestamp` → `timestamptz`

Importación: `timestamp` de MariaDB se guarda en UTC (leer con `time_zone = '+00:00'`); `datetime` no tiene zona y el legacy lo escribía en hora de Colombia → interpretar como `America/Bogota`. Fechas cero `0000-00-00 00:00:00` → `NULL`. Entidades: `type: 'timestamptz'`.

| Columna | MariaDB | NULL | Default |
|---|---|---|---|
| `academic_periods.closed_at` | `datetime` | NULL | — |
| `academic_periods.created_at` | `timestamp` | NULL | now() |
| `access_log.created_at` | `timestamp` | NULL | now() |
| `accounting_accounts.created_at` | `timestamp` | NULL | now() |
| `accounting_journal_entries.created_at` | `timestamp` | NULL | now() |
| `accounting_journal_entries.posted_at` | `datetime` | NULL | — |
| `accounting_journal_entries.voided_at` | `datetime` | NULL | — |
| `accounting_journal_lines.created_at` | `timestamp` | NULL | now() |
| `accounting_periods.closed_at` | `datetime` | NULL | — |
| `accounting_periods.created_at` | `timestamp` | NULL | now() |
| `accounting_periods.reopened_at` | `datetime` | NULL | — |
| `accounting_periods.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `accounting_posting_rules.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `accounting_sequences.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `accounting_third_parties.created_at` | `timestamp` | NULL | now() |
| `ai_chat_logs.created_at` | `timestamp` | NULL | now() |
| `ai_marketing_campaigns.created_at` | `timestamp` | NULL | now() |
| `attendance_records.created_at` | `timestamp` | NULL | now() |
| `billing_concepts.created_at` | `timestamp` | NULL | now() |
| `certificates.created_at` | `timestamp` | NULL | now() |
| `certificates.generated_at` | `timestamp` | NULL | — |
| `charges.created_at` | `timestamp` | NULL | now() |
| `classrooms.created_at` | `timestamp` | NULL | now() |
| `dian_consecutives.created_at` | `timestamp` | NULL | now() |
| `dian_consecutives.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `dian_document_submissions.created_at` | `datetime` | NOT NULL | — |
| `dian_invoices.created_at` | `timestamp` | NULL | now() |
| `dian_invoices.email_sent_at` | `datetime` | NULL | — |
| `dian_invoices.last_submission_at` | `datetime` | NULL | — |
| `dian_invoices.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `dian_test_docs.created_at` | `datetime` | NULL | now() |
| `email_log.created_at` | `timestamp` | NULL | now() |
| `employee_leaves.created_at` | `timestamp` | NULL | now() |
| `employee_leaves.decided_at` | `datetime` | NULL | — |
| `employee_stickers.created_at` | `timestamp` | NULL | now() |
| `employee_stickers.read_at` | `timestamp` | NULL | — |
| `employees.created_at` | `timestamp` | NULL | now() |
| `employees.updated_at` | `timestamp` | NULL | — + trigger `set_updated_at` |
| `expense_categories.created_at` | `timestamp` | NULL | now() |
| `expenses.created_at` | `timestamp` | NULL | now() |
| `finance_receipt_sequences.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `grade_tuition.created_at` | `timestamp` | NULL | now() |
| `grades.created_at` | `timestamp` | NULL | now() |
| `grades_records.created_at` | `timestamp` | NULL | now() |
| `grades_records.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `group_directors.created_at` | `timestamp` | NULL | now() |
| `guardians.created_at` | `timestamp` | NULL | now() |
| `hr_issued_documents.issued_at` | `datetime` | NOT NULL | — |
| `incidents.created_at` | `timestamp` | NULL | now() |
| `incidents.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `institutions.created_at` | `timestamp` | NULL | now() |
| `inventory_categories.created_at` | `timestamp` | NULL | now() |
| `inventory_items.created_at` | `timestamp` | NULL | now() |
| `inventory_movements.created_at` | `datetime` | NOT NULL | now() |
| `invoices.created_at` | `timestamp` | NULL | now() |
| `notifications.created_at` | `timestamp` | NULL | now() |
| `payment_applications.created_at` | `timestamp` | NULL | now() |
| `payments.created_at` | `timestamp` | NULL | now() |
| `payments.payment_date` | `datetime` | NULL | now() |
| `payments.reconciled_at` | `datetime` | NULL | — |
| `payments.voided_at` | `datetime` | NULL | — |
| `payroll_novelties.created_at` | `timestamp` | NULL | now() |
| `payroll_parameters.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `payroll_payments.created_at` | `timestamp` | NULL | now() |
| `payroll_periods.approved_at` | `datetime` | NULL | — |
| `payroll_periods.calculated_at` | `datetime` | NULL | — |
| `payroll_periods.cancelled_at` | `datetime` | NULL | — |
| `payroll_periods.created_at` | `timestamp` | NULL | now() |
| `payroll_periods.paid_at` | `datetime` | NULL | — |
| `report_cards.created_at` | `timestamp` | NULL | now() |
| `report_cards.generated_at` | `datetime` | NULL | — |
| `student_bulletins.generated_at` | `timestamp` | NULL | now() |
| `student_bulletins.last_download_at` | `datetime` | NULL | — |
| `student_certificates.approved_at` | `datetime` | NULL | — |
| `student_certificates.created_at` | `timestamp` | NULL | now() |
| `student_charges.created_at` | `timestamp` | NULL | now() |
| `student_charges.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `student_grades.created_at` | `timestamp` | NULL | now() |
| `students.created_at` | `timestamp` | NULL | now() |
| `students.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `subjects.created_at` | `timestamp` | NULL | now() |
| `teacher_assignments.created_at` | `timestamp` | NULL | now() |
| `users.created_at` | `timestamp` | NULL | now() |
| `users.last_login` | `datetime` | NULL | — |
| `users.updated_at` | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `whatsapp_log.created_at` | `timestamp` | NULL | now() |
| `whatsapp_templates.created_at` | `timestamp` | NULL | now() |
| `tenants.created_at` (maestra) | `timestamp` | NULL | now() |
| `tenants.deleted_at` (maestra) | `timestamp` | NULL | — |
| `tenants.updated_at` (maestra) | `timestamp` | NULL | now() + trigger `set_updated_at` |
| `users.created_at` (maestra) | `timestamp` | NULL | now() |
| `users.last_login` (maestra) | `datetime` | NULL | — |
| `users.updated_at` (maestra) | `timestamp` | NULL | now() + trigger `set_updated_at` |

Total: 93 columnas.

## 7. `AUTO_INCREMENT` → `GENERATED BY DEFAULT AS IDENTITY` (y `bigint`)

Importación: copiar los `id` y luego `SELECT setval(pg_get_serial_sequence('<tabla>', 'id'), COALESCE(MAX(id), 1), MAX(id) IS NOT NULL) FROM <tabla>`. Columnas `bigint` (vuelven como **string** en `pg`): `access_log.id`, `accounting_journal_lines.id`, `inventory_movements.id`. Entidades: `@PrimaryGeneratedColumn({ type: 'int' })` / `'bigint'`, sin `unsigned`; `INSERT ... RETURNING id` en lugar de `insertId`.

| Columna | MariaDB | PostgreSQL | NULL | Default |
|---|---|---|---|---|
| `academic_periods.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `access_log.id` | `bigint(20) AUTO_INCREMENT` | `bigint identity` | NOT NULL | — |
| `accounting_accounts.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `accounting_journal_entries.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `accounting_journal_lines.id` | `bigint(20) unsigned AUTO_INCREMENT` | `bigint identity` | NOT NULL | — |
| `accounting_periods.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `accounting_third_parties.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `ai_chat_logs.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `ai_marketing_campaigns.id` | `int(11) AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `attendance_records.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `billing_concepts.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `certificates.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `charges.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `classrooms.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `dian_consecutives.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `dian_document_submissions.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `dian_invoices.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `dian_test_docs.id` | `int(11) AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `email_log.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `employee_leaves.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `employee_stickers.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `employees.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `expense_categories.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `expenses.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `grade_tuition.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `grades.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `grades_records.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `group_directors.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `guardians.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `hr_issued_documents.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `incidents.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `institutions.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `inventory_categories.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `inventory_items.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `inventory_movements.id` | `bigint(20) unsigned AUTO_INCREMENT` | `bigint identity` | NOT NULL | — |
| `invoices.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `notifications.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `payment_applications.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `payments.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `payroll_novelties.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `payroll_payments.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `payroll_periods.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `report_cards.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `student_bulletins.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `student_certificates.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `student_charges.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `student_grades.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `students.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `subjects.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `teacher_assignments.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `users.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `whatsapp_log.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `whatsapp_templates.id` | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `tenants.id` (maestra) | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |
| `users.id` (maestra) | `int(10) unsigned AUTO_INCREMENT` | `integer identity` | NOT NULL | — |

Total: 55 columnas.

## 8. Columnas generadas

No se importan (PG las recalcula); excluirlas del `INSERT`.

| Columna | MariaDB | PostgreSQL | NULL | Default |
|---|---|---|---|---|
| `group_directors.active_classroom_id` | `int(10) unsigned GENERATED` | `integer GENERATED STORED` | NULL | — |

Total: 1 columnas.

## 9. Otros cambios sin equivalente directo

- `ON UPDATE current_timestamp()` (13 tablas del colegio + `tenants`, `users` de la maestra) → trigger `<tabla>_set_updated_at` que llama a `set_updated_at()`: pone `statement_timestamp()` si la fila cambió y la sentencia no fijó `updated_at`. `employees.updated_at` conserva `DEFAULT NULL` (se llena en la primera actualización).
- `group_directors.active_classroom_id`: `GENERATED ALWAYS AS (IF(is_active = 1, classroom_id, NULL)) PERSISTENT` → `GENERATED ALWAYS AS (CASE WHEN is_active THEN classroom_id END) STORED` con índice único (un director activo por salón).
- `group_directors.assignment_date DEFAULT curdate()` → `DEFAULT CURRENT_DATE` (usa la `TimeZone` de la sesión: `America/Bogota`).
- `CHECK (json_valid(...))` de `dian_invoices.lines_data` y `whatsapp_templates.buttons` → lo garantiza el tipo `jsonb`.
- FK duplicada en MariaDB `student_charges.created_by` (`fk_student_charges_created_by` y `student_charges_ibfk_3`) → una sola FK.
- Índices no únicos redundantes (prefijo de otro índice o de la PK, p. ej. `idx_email`, `idx_code`, `idx_slug`, índices automáticos de FK cubiertos por un índice compuesto) no se recrearon.
- Colación `utf8mb4_general_ci` → colación por defecto de PG (sensible a mayúsculas/tildes). Unicidades de texto que en MariaDB ignoraban mayúsculas (`students.code`, `employees.code`, `*.document_number`, `inventory_items.sku`, `invoices.invoice_number`, `whatsapp_templates.name`, `tenants.slug`, `settings.key`…) ahora distinguen mayúsculas; la importación debe detectar duplicados que solo difieran en mayúsculas/espacios finales (MariaDB también ignora espacios finales en `varchar`).

## 10. Índices de búsqueda (nuevos, sin equivalente en MariaDB)

Índices `gin (f_unaccent(...) gin_trgm_ops)` (`<tabla>_<col>_trgm_idx`). Para que el planificador los use, el SQL debe repetir **la misma expresión**: `f_unaccent(col) ILIKE f_unaccent($1)`; para nombre completo, `f_unaccent(first_name || ' ' || last_name)` (no `CONCAT(...)`, que no es inmutable ni coincide con el índice).

| Tabla | Expresiones indexadas |
|---|---|
| `students` | `first_name \|\| ' ' \|\| last_name` (`students_full_name_trgm_idx`), `code`, `document_number`, `email` |
| `employees` | `first_name \|\| ' ' \|\| last_name` (`employees_full_name_trgm_idx`), `code`, `document_number`, `email` |
| `guardians` | `first_name \|\| ' ' \|\| last_name` (`guardians_full_name_trgm_idx`), `document_number`, `email` |
| `users` | `name`, `email` |
| `accounting_third_parties` | `name`, `document_number` |
| `inventory_items` | `name`, `sku` |
| `dian_invoices` | `customer_name`, `customer_id_number` |
