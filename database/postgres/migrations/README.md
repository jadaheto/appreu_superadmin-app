# Migraciones PostgreSQL de la BD de cada colegio

Cambios **posteriores** a `../tenant-schema.sql` (que ya incluye el baseline del legacy y las
11 migraciones MariaDB de la v2). Hoy no hay ninguna.

- Nombre: `NNN-<contexto>-<descripcion>.sql`, numeración **global** desde `001`
  (p. ej. `001-finance-descuentos-por-hermanos.sql`). Se aplican en orden por el prefijo.
- Idempotentes (`ADD COLUMN IF NOT EXISTS`, `CREATE TABLE/INDEX IF NOT EXISTS`,
  `CREATE OR REPLACE FUNCTION`, `DROP ... IF EXISTS` + `CREATE`, `INSERT ... ON CONFLICT DO NOTHING`,
  bloques `DO $$ ... $$` cuando haga falta comprobar el catálogo).
- Comentario inicial: qué cambia, por qué y advertencias sobre datos.
- Seguir las convenciones de tipos y nombres de [ADR-0008](../../../docs/adr/0008-postgresql.md)
  y de `../TYPE-MAP.md` (enum = `varchar` + `CHECK <tabla>_<col>_check`; para cambiar valores:
  `ALTER TABLE t DROP CONSTRAINT IF EXISTS t_c_check, ADD CONSTRAINT t_c_check CHECK (...)`).
- Al consolidar (opcional), el cambio se incorpora a `../tenant-schema.sql` y se conserva el archivo.
