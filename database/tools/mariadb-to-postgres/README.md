# mariadb-to-postgres

Importa la BD de un colegio legacy (`apreu_<slug>`, MariaDB 10.11) o la BD maestra
(`apreu_master`) a PostgreSQL 16, según [ADR-0008](../../../docs/adr/0008-postgresql.md) y
[`TYPE-MAP.md`](../../postgres/TYPE-MAP.md).

## Requisitos
- Node 20 o superior (probado con `node:24-alpine`) y `npm install` en esta carpeta (`mysql2`, `pg`; `vitest` para pruebas).
- Origen MariaDB con las **11 migraciones v2** aplicadas (`database/mariadb/migrations`; maestra: `mariadb/master-migrations`). Usuario con `SELECT` sobre la BD.
- Destino PostgreSQL 16: un usuario que pueda crear la BD (`--create-db`), o una BD ya creada con `postgres/tenant-schema.sql` (o `master-schema.sql`) + `postgres/migrations/*`. Extensiones `unaccent` y `pg_trgm` disponibles.
- Recomendado: un superusuario (o `GRANT SET ON PARAMETER session_replication_role`) para cargar con `session_replication_role = replica`. Sin ese permiso la herramienta carga en orden de FK y lo indica en el reporte.

## Uso

```bash
node bin/migrate.js --source mysql://usr:clave@host:3306 --target postgres://usr:clave@host:5432/postgres \
  --tenant <slug> [--source-db apreu_<slug>] [--target-db apreu_<slug>] [--create-db] \
  [--dry-run] [--fix] [--truncate] [--verify-only] [--batch 1000] [--datetime-tz America/Bogota] [--report-dir reports]

node bin/migrate.js --source ... --target ... --master        # tenants, users (datetime en UTC)
```

- `--tenant colegio-norte` usa `apreu_colegio_norte` en ambos lados (guion → guion bajo); `--source-db`/`--target-db` lo cambian.
- La ruta de `--target` es la BD de mantenimiento (`postgres`) desde la que se comprueba/crea la BD destino.
- `--create-db`: si la BD destino no existe, la crea y aplica `postgres/tenant-schema.sql` (o `master-schema.sql`) **completo en una sola query**, y luego `postgres/migrations/*.sql` en orden.
- `--dry-run`: preflight + detección de conflictos; no escribe nada (no crea la BD).
- `--verify-only`: no copia; compara origen y destino (útil para confirmar que nadie escribió en MariaDB antes del cambio).
- `--datetime-tz`: zona en que el legacy escribió las columnas `datetime`. Colegio: `America/Bogota`; maestra: `UTC` (comprobado en los datos: `users.last_login` de la maestra coincide con los `timestamp` UTC).
- Reportes: `reports/<bd>-<fecha>.json` y `.txt` (el texto también sale por la salida estándar; el progreso, por la de errores).
- Códigos de salida: `0` ok/ensayo, `2` conflictos, `3` destino con datos, `4` preflight, `5` FK, `6` verificación, `1` error inesperado, `64` uso.

En desarrollo (el sandbox no permite TCP host→Docker), dentro de la red de `apreu-dev-pg`:

```bash
MIP=$(docker inspect -f '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' apreu-dev-db)
docker run --rm --network container:apreu-dev-pg --user "$(id -u):$(id -g)" \
  -v "$PWD/database:/database" -w /database/tools/mariadb-to-postgres node:24-alpine \
  node bin/migrate.js --source "mysql://root:root@$MIP:3306" \
  --target postgres://postgres:postgres@127.0.0.1:5432/postgres --tenant demo --create-db
```

Pruebas unitarias de las conversiones: `npm test`.

## Qué hace
1. **Preflight**. Comprueba en el origen las marcas de las 11 migraciones v2 (tablas/columnas/índices que crea cada una) y que no falten tablas ni columnas en el destino (si faltan, aborta: se perderían datos). Lee el origen en una transacción `REPEATABLE READ WITH CONSISTENT SNAPSHOT, READ ONLY` con `time_zone = '+00:00'` y `dateStrings: true`: la detección, la copia y la verificación ven la misma foto, y no se depende de la zona del proceso.
2. **Idempotencia**. Si el destino tiene filas (sin contar las semillas de `tenant-schema.sql`: `settings`, `payroll_parameters`, `hr_sequences`), aborta salvo `--truncate`. Dentro de la transacción de carga se hace `TRUNCATE ... RESTART IDENTITY CASCADE` de todas las tablas (las semillas se reemplazan por las del origen).
3. **Conflictos** (recorre todas las filas y simula la conversión). Ver tabla abajo. Si hay alguno bloqueante, aborta con el reporte; con `--fix` aplica solo las reglas registradas.
4. **Copia** en **una transacción por BD**: `SET LOCAL session_replication_role = replica`, tablas en orden de FK, columnas comunes por nombre (omite la columna generada `group_directors.active_classroom_id`, que PG recalcula), `INSERT` multi-fila de `--batch` filas (limitado a 65535 parámetros) con `$n::tipo`. Conversiones: `tinyint(1)`→`boolean`, `year`→`smallint`, `decimal`→`numeric` (texto exacto), `datetime`→`timestamptz` interpretado en `America/Bogota` (literal con nombre de zona IANA: respeta el horario de verano de 1992-93), `timestamp`→`timestamptz` en UTC, JSON→`jsonb`, fechas cero→`NULL` (con `--fix`).
5. **Secuencias**: `setval(pg_get_serial_sequence(t, 'id'), max(id))` en cada identidad.
6. **FK**: valida todas las FK con anti-joins (la carga en modo replica no las comprobó).
7. **Verificación**, aún dentro de la transacción: por tabla, filas; md5 de las PK y md5 de cada fila completa (cada valor de PG se vuelve a renderizar al formato textual de MariaDB: banderas `0/1`, fechas en la zona de origen, JSON canónico); el resumen es la suma mod 2^128 de los md5, independiente del orden (hay PK de texto y las colaciones ordenan distinto); y `SUM` de cada columna `numeric` en ambos motores. Si algo no coincide → `ROLLBACK` (el destino queda como estaba). Si todo coincide → `COMMIT` y `ANALYZE`.

## Conflictos y correcciones (`--fix`)

| Código | Severidad | Qué detecta | Corrección con `--fix` |
|---|---|---|---|
| `ZERO_DATE` | error | `0000-00-00`, mes/día `00`, `year` 0 | `NULL` si la columna lo admite; si no, su `DEFAULT`; si no tiene, bloquea |
| `ENUM_EMPTY` | error | `''` en enum (MariaDB no estricto guarda así los valores inválidos) | `DEFAULT` de la columna (p. ej. `'TI'`); si no tiene, `NULL`; si no admite, bloquea |
| `ENUM_CASE` | error | valor que solo coincide ignorando mayúsculas/espacios | valor canónico del `CHECK` |
| `ENUM_INVALID` | error | valor fuera de la lista del `CHECK` | ninguna: corregir en el origen |
| `JSON_INVALID` | error | JSON inválido o vacío en columna `jsonb` | `NULL`; `'{}'` si es `NOT NULL` |
| `NUL_CHAR` | error | `\0` en texto o `\u0000` en JSON (PG no los admite) | se elimina el carácter |
| `BOOL_RANGE` | error | bandera `tinyint` distinta de 0/1 | distinto de 0 → `true` |
| `INT_RANGE`, `TIME_RANGE`, `TOO_LONG` | error | entero fuera de rango, `time` fuera de 00–24 h, texto más largo que el `varchar` | ninguna |
| `NOT_NULL` | error | `NULL` en columna `NOT NULL` del destino | `DEFAULT` si la columna tiene |
| `FK_ORPHAN` | error | valor de FK sin fila padre (cargas con `foreign_key_checks=0`) | `NULL` si la columna lo admite |
| `UNIQUE_DUP` | error | duplicado exacto en un índice único de PG | ninguna |
| `UNIQUE_CI_DUP` | error | valores de un índice único que solo difieren en mayúsculas/tildes/espacios finales (en MariaDB eran "iguales"; en PG ambos entran y la app ya no los distingue) | ninguna: unificar a mano |
| `UNIQUE_TRAILING_SPACE` | aviso | clave única con espacios finales (MariaDB la encontraba sin ellos; PG no) | se quitan los espacios |
| `EMAIL_CASE` | aviso | correo con mayúsculas en columna con índice `lower(email)` | se guarda en minúscula |

Cada conflicto queda en el reporte con tabla, columna, cantidad, regla aplicada y hasta 5 ejemplos (PK y valor).
Las celdas corregidas se comparan con el valor corregido en la verificación (si la corrección fue un `DEFAULT` no literal, como `now()`, la columna se excluye de la suma de filas y se informa).

## Producción (un colegio a la vez)
1. **Ventana de mantenimiento**: el legacy en modo solo lectura o detenido para ese colegio (la herramienta lee una foto consistente, pero lo escrito después en MariaDB no se migra).
2. **Respaldo**: `mariadb-dump --single-transaction --routines --triggers apreu_<slug> > respaldo.sql`; trabajar sobre una **copia** restaurada.
3. Sobre la copia, aplicar `database/mariadb/migrations/*.sql` (ver `database/README.md`, "Colegios existentes") y `verify-schema.sh`.
4. Ensayo: `--dry-run` (y `--fix --dry-run` para ver qué cambiaría). Corregir a mano en la copia lo que no tenga regla; decidir y registrar si se usa `--fix` (guardar el reporte JSON con el acta).
5. Importar: `--create-db` (o BD creada antes) y, si hace falta, `--fix`. Exigir `ESTADO: OK` y `N/N iguales`.
6. Justo antes de cambiar el tráfico: `--verify-only` para confirmar que el origen no cambió.
7. Registrar/actualizar el colegio en `tenants` de la maestra PG (`db_name` si no es `apreu_<slug>`), copiar las fotos/logos, probar login y un par de pantallas.
8. **Rollback** = seguir en MariaDB: no se modifica el origen; si algo falla después del cambio, se vuelve a apuntar el colegio al legacy y se descarta (`DROP DATABASE`) la BD PG. Lo escrito en PG después del cambio no vuelve a MariaDB.

La BD maestra se migra una sola vez con `--master` (antes de los colegios o junto con el primero).
