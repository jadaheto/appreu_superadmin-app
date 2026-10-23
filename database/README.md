# Bases de datos de Apreu v2 (PostgreSQL 16)

Motor y convenciones: [ADR-0008](../docs/adr/0008-postgresql.md). Una BD por colegio
(`apreu_<slug>`) y una BD maestra (`apreu_master`), esquema `public` ([ADR-0003](../docs/adr/0003-multitenancy.md)).

| Ruta | Uso |
|---|---|
| `postgres/tenant-schema.sql` | Esquema **consolidado** de la BD de cada colegio (60 tablas): baseline del legacy + las 11 migraciones MariaDB de la v2, más extensiones, funciones, triggers, comentarios y datos semilla. Fuente de verdad de tablas y columnas. |
| `postgres/migrations/NNN-<contexto>-<descripcion>.sql` | Cambios posteriores de la BD de cada colegio (numeración global desde `001`; hoy vacía). |
| `postgres/master-schema.sql` | BD maestra: `tenants` (registro de colegios) y `users` (operadores `superadmin`). Propiedad de `superadmin-api`; `apreu-api` solo lee `tenants`. |
| `postgres/master-migrations/NNN-*.sql` | Cambios posteriores de la BD maestra (hoy vacía). |
| `postgres/TYPE-MAP.md` | Columnas cuyo tipo cambió (boolean, enum→CHECK, jsonb, timestamptz, identidades, índices de búsqueda). Referencia para entidades ORM, SQL e importación. |
| `postgres/verify-schema.sh` | Compara tablas, columnas, PK, FK, índices únicos y valores de enum entre una BD MariaDB y una PostgreSQL. |
| `mariadb/` | Archivos MariaDB anteriores (`tenant-baseline.sql`, `master-schema.sql`, `migrations/`, `master-migrations/`). **Solo** para preparar la importación de colegios legacy; no se usan para colegios nuevos. |
| `tools/mariadb-to-postgres/` | Herramienta Node de importación MariaDB → PostgreSQL de colegios legacy y de la BD maestra (conflictos, copia en una transacción, verificación). Ver su [README](tools/mariadb-to-postgres/README.md). |

Todos los scripts de `postgres/` son **idempotentes** (`IF NOT EXISTS`, `CREATE OR REPLACE`,
`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`, `ON CONFLICT DO NOTHING`) y pueden re-ejecutarse.
Requieren las extensiones `unaccent` y `pg_trgm` (confiables en PG 16: el dueño de la BD puede crearlas).

> Los archivos contienen funciones con cuerpo `$func$ ... $func$` que incluyen `;`. Ejecútelos
> completos (`psql -f`, o una sola llamada `query()` del driver `pg` con el archivo entero);
> no los divida por `;`.

## Colegios nuevos
`superadmin-api` crea la BD y aplica, en orden:

```bash
createdb -U postgres apreu_<slug>          # o CREATE DATABASE apreu_<slug>
psql -v ON_ERROR_STOP=1 -d apreu_<slug> -f database/postgres/tenant-schema.sql
for f in database/postgres/migrations/[0-9]*.sql; do
  [ -e "$f" ] || continue
  psql -v ON_ERROR_STOP=1 -d apreu_<slug> -f "$f" || break
done
```

Las conexiones de cada colegio fijan `TimeZone = 'America/Bogota'`.

En desarrollo (contenedor `apreu-dev-pg`, puerto host 54331):

```bash
docker exec -i apreu-dev-pg psql -U postgres -c 'CREATE DATABASE apreu_demo'
docker exec -i apreu-dev-pg psql -U postgres -v ON_ERROR_STOP=1 -d apreu_demo < database/postgres/tenant-schema.sql
```

## BD maestra

```bash
docker exec -i apreu-dev-pg psql -U postgres -c 'CREATE DATABASE apreu_master'
docker exec -i apreu-dev-pg psql -U postgres -v ON_ERROR_STOP=1 -d apreu_master < database/postgres/master-schema.sql
# luego database/postgres/master-migrations/[0-9]*.sql en orden
```

La BD maestra trabaja en UTC. `tenants.db_name` NULL significa `apreu_<slug>`. El esquema no
siembra operadores: el primer `superadmin` se crea con `superadmin-api` (contraseña bcrypt, correo en minúscula).

## Agregar una migración
1. Archivo `postgres/migrations/<siguiente NNN>-<contexto>-<descripcion>.sql` (o
   `postgres/master-migrations/<NNN>-<descripcion>.sql`), numeración global desde `001`.
2. Idempotente, con un comentario inicial que explique qué cambia, por qué y qué datos toca.
3. Tipos y nombres según ADR-0008 / `TYPE-MAP.md`: banderas `boolean`, enum como `varchar` +
   `CHECK` `<tabla>_<col>_check`, `jsonb`, `timestamptz`, índices `<tabla>_<cols>_idx|_key`,
   trigger `set_updated_at` para columnas `updated_at`.
4. Probar dos veces seguidas sobre una BD creada con `tenant-schema.sql`.

## Colegios existentes (importación desde el legacy MariaDB)
Un colegio a la vez, en ventana de mantenimiento (detalle en [`tools/mariadb-to-postgres/README.md`](tools/mariadb-to-postgres/README.md)).

1. Respaldo y **copia** de trabajo: `mariadb-dump --single-transaction --routines --triggers apreu_<slug> > respaldo.sql`, restaurado en otra BD/servidor. El original no se toca (rollback = seguir en MariaDB).
2. Sobre la **copia MariaDB**, aplicar primero las migraciones MariaDB de la v2 en orden (son idempotentes):
   ```bash
   for f in database/mariadb/migrations/*.sql; do mariadb -u<usuario> -p apreu_<slug> < "$f" || break; done
   ```
   Revisar las advertencias de cada una (comentario inicial): `009-academic` elimina duplicados de
   asignaciones y asistencia; `002-students` y `010-hr` vinculan cuentas por correo; `010-hr` mapea
   estados de nómina antiguos; `011-e-invoicing` reasigna ciclos de numeración DIAN.
   La herramienta comprueba que estén aplicadas (por las tablas/columnas que crea cada una) y aborta si falta alguna.
3. Opcional: `database/postgres/verify-schema.sh apreu_<slug> <bd_pg_creada_con_tenant-schema>` (sin diferencias).
4. Ensayo y luego importación:
   ```bash
   cd database/tools/mariadb-to-postgres && npm install
   node bin/migrate.js --source mysql://usr:clave@host:3306 --target postgres://usr:clave@host:5432/postgres \
     --tenant <slug> --create-db --dry-run          # solo conflictos
   node bin/migrate.js ... --tenant <slug> --create-db [--fix]   # crea apreu_<slug> con tenant-schema.sql + migrations/*
   node bin/migrate.js ... --tenant <slug> --verify-only         # justo antes del cambio
   ```
   Conflictos que PG rechazaría (fechas cero, `''` en enum, JSON inválido, NUL, FK huérfanas, duplicados
   que solo difieren en mayúsculas/espacios en columnas únicas…) abortan; `--fix` aplica solo las reglas
   registradas en el README de la herramienta. La copia va en una transacción por colegio y se verifica
   (filas, md5 de PK y de filas, sumas `numeric`) antes del `COMMIT`; si no coincide, `ROLLBACK`.
5. BD maestra: la del legacy se actualiza antes con `mariadb/master-migrations/*.sql` y se importa una vez con
   `--master` (datetime en UTC). Registrar el colegio en `tenants` (con `db_name` si no sigue `apreu_<slug>`).
6. Copiar las fotos/logos del legacy (`public/uploads/...`) a `UPLOADS_DIR/<slug>/...` o volver a subirlos.
