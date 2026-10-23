# Migraciones PostgreSQL de la BD maestra (`apreu_master`)

Cambios **posteriores** a `../master-schema.sql` (que ya incluye `master-migrations/001` de MariaDB).
Hoy no hay ninguna.

- Nombre: `NNN-<descripcion>.sql`, numeración global desde `001`; se aplican en orden.
- Idempotentes, con comentario inicial, y con las convenciones de
  [ADR-0008](../../../docs/adr/0008-postgresql.md). La BD maestra trabaja en UTC.
