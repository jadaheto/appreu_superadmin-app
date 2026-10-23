# superadmin-api

API de la **consola superadmin** de Apreu (NestJS 12, TypeScript, ESM). Reemplaza a `superadmin/` del legacy PHP:
autenticación de los operadores de la plataforma, gestión del ciclo de vida de los colegios (tenants),
**aprovisionamiento** de la base de datos de un colegio nuevo y KPIs cross-tenant.

Especificación funcional: `docs/analysis/09-superadmin-multitenant.md`. Decisiones: `docs/adr/0001…0008`
(motor: **PostgreSQL 16**, ADR-0008).

## Arquitectura

Hexagonal por contexto acotado (ADR-0002). `domain/` y `application/` no dependen de TypeORM ni de Express;
los casos de uso reciben sus puertos por tokens (`Symbol`).

```
src/
├── main.ts                      # Helmet, CORS, ValidationPipe, filtro de errores, Swagger (/docs), prefijo api/platform/v1
├── app.module.ts                # Throttler (default + login estricto) y módulos
├── shared/                      # Kernel copiado de apreu-api (sin imports entre proyectos)
│   ├── domain/                  # DomainError, Entity, ValueObject, Guard, Email, paginación, calendario (zona horaria)
│   ├── application/             # UseCase, PlatformActor, puertos Clock, PasswordHasher, PasswordGenerator, TIME_ZONE
│   ├── infrastructure/
│   │   ├── config/environment.ts            # Variables de entorno tipadas y validadas
│   │   ├── http/                            # @Public, @CurrentActor, JwtAuthGuard global, filtro de errores, throttling
│   │   ├── persistence/master-database.ts   # DataSource TypeORM (postgres, UTC) perezoso a la BD maestra
│   │   ├── persistence/tenant-database-connector.ts  # Sesiones `pg` al servidor de colegios
│   │   └── security/                        # bcrypt ($2y$ compatible), generador de contraseñas, claims JWT
│   └── testing/                 # Fakes (reloj, hasher, conector SQL en memoria)
└── modules/
    ├── platform-identity/       # Login de superadmin contra `users` (role='superadmin') de la BD maestra
    ├── tenants/                 # Registro, ciclo de vida y aprovisionamiento de colegios
    │   ├── domain/              # Tenant (transiciones), TenantSlug, MasterTenantRepository
    │   ├── application/         # Casos de uso + puertos TenantProvisionerPort, TenantNamingPort
    │   └── infrastructure/      # Controller, TypeORM, PostgresTenantProvisioner, parser SQL, cargador del esquema
    ├── analytics/               # Dashboard global y analítica por colegio (solo lectura)
    │   ├── domain/              # Periodo de reporte (America/Bogota), series mensuales, montos en centavos
    │   ├── application/         # Casos de uso + puertos TenantCatalogPort, TenantStatsReaderPort
    │   └── infrastructure/      # SqlTenantCatalog (maestra), PostgresTenantStatsReader (BD de cada colegio)
    └── health/
```

### Puertos y adaptadores

| Puerto | Adaptador | Notas |
|---|---|---|
| `PlatformUserRepository` | `TypeOrmPlatformUserRepository` | Solo lee filas `role='superadmin'`; actualiza únicamente `last_login`. |
| `PlatformTokenIssuerPort` | `JwtPlatformTokenIssuer` | Secreto propio, `aud=apreu-superadmin`, `iss=superadmin-api`. |
| `MasterTenantRepository` | `TypeOrmMasterTenantRepository` | Tabla `tenants`; `23505` (unique_violation) → 409; búsqueda `ILIKE` + `f_unaccent`. |
| `TenantProvisionerPort` | `PostgresTenantProvisioner` | `CREATE DATABASE`, esquema + migraciones (`schema_migrations`), director, `DROP DATABASE … WITH (FORCE)` (compensación). |
| `TenantNamingPort` | `EnvTenantNaming` | `apreu_<slug con _>` y URL pública por plantilla. |
| `TenantCatalogPort` | `SqlTenantCatalog` | Modelo de lectura propio del contexto de analítica. |
| `TenantStatsReaderPort` | `PostgresTenantStatsReader` | Sesión `BEGIN TRANSACTION READ ONLY`, `TimeZone=America/Bogota`, cuenta lectora y `statement_timeout`. |
| `TenantCacheInvalidatorPort` | `HttpTenantCacheInvalidator` | `POST {APREU_API_URL}/api/internal/tenants/{slug}/invalidate` con `X-Internal-Token`; `fetch` nativo con timeout; nunca falla la operación (solo advierte en el log). |
| `PasswordHasherPort` / `PasswordGeneratorPort` | `BcryptPasswordHasher` / `CryptoPasswordGenerator` | 16 caracteres con `crypto.randomInt`. |

### Aprovisionamiento de un colegio (`POST /tenants`)

Saga síncrona con compensación (sin clonar carpetas, ADR-0001):

1. Valida slug (`^[a-z0-9]+(-[a-z0-9]+)*$`, 3–60, no reservado), nombre (3–200), correo del director (obligatorio) y teléfono (7–15 dígitos).
2. Rechaza (409) si el slug existe en `tenants` —incluidos colegios eliminados— o si ya existe la BD `apreu_<slug>` en el servidor (no se reutilizan BD huérfanas; el legacy usaba `IF NOT EXISTS`).
3. En la BD de mantenimiento (`TENANT_DB_MAINTENANCE_DB`, `postgres`) y **fuera de transacción** (PostgreSQL no lo permite):
   `CREATE DATABASE "apreu_<slug>" [OWNER "<TENANT_DB_OWNER>"] ENCODING 'UTF8' TEMPLATE template0`. El nombre solo admite
   `[a-z0-9_]` (máx. 63), debe llevar el prefijo configurado y se interpola únicamente como identificador citado.
4. En una sesión sobre la BD nueva (con `SET ROLE <TENANT_DB_OWNER>` si se configuró, para que tablas, funciones y extensiones
   pertenezcan a ese rol): `ALTER DATABASE … SET "TimeZone" TO 'America/Bogota'`, crea `schema_migrations(version, applied_at)`
   y aplica `database/postgres/tenant-schema.sql` (versión `tenant-schema`) y luego `TENANT_MIGRATIONS_DIR/NNN-*.sql` en orden
   (versión = nombre sin `.sql`). Cada archivo corre **sentencia por sentencia en su propia transacción** con
   `pg_advisory_xact_lock`, y se registra en `schema_migrations`; las versiones ya registradas se omiten, así que reaplicar es seguro.
   El parser entiende comillas, `E'…'`, identificadores `"…"`, cuerpos `$$…$$`/`$tag$…$tag$` y comentarios anidados;
   **omite cualquier `INSERT`/`MERGE` sobre `users`** (bug del superadmin sembrado) y los `ALTER … OWNER TO`, descarta
   `BEGIN`/`COMMIT`, y aborta ante `CREATE/ALTER/DROP DATABASE`, roles, `GRANT`/`REVOKE`, `SET ROLE`, `COPY`, `ALTER SYSTEM`,
   meta-comandos de psql, funciones de archivos y extensiones fuera de la lista (`unaccent`, `pg_trgm`, `pgcrypto`, `citext`,
   `btree_gin`, `btree_gist`, `plpgsql`).
   Si hay cuenta lectora propia: `GRANT CONNECT` en la BD, `USAGE` en `public`, `SELECT` en las tablas y privilegios por
   defecto; con `TENANT_DB_OWNER`, además `REVOKE CONNECT, TEMPORARY … FROM PUBLIC`.
5. En una transacción: elimina cualquier `superadmin` que hubiera quedado (defensa en profundidad), inserta el director (`role='admin'`,
   correo en minúscula, `must_change_password = true`) con sentencia parametrizada y hash bcrypt `$2y$`, y guarda
   `settings.school_name` (`ON CONFLICT (key) DO UPDATE`).
6. Registra el tenant en la BD maestra con `db_name`, `tables_created = true` y estado `active` o `trial`.

Si falla cualquier paso posterior a la creación de la BD, se ejecuta `DROP DATABASE IF EXISTS "…" WITH (FORCE)` (solo BD con el prefijo configurado y creadas por esta ejecución) y el error indica el paso y si se revirtió. La contraseña temporal del director se devuelve **una sola vez** en la respuesta (`Cache-Control: no-store`) y nunca se guarda en claro.

### Ciclo de vida

`active ⇄ suspended`, `trial → active | suspended`, `active | suspended → trial` (con `trialEndsAt` opcional).
**Eliminación lógica**: el colegio queda `suspended` (por lo que `apreu-api` bloquea su acceso) y con `deleted_at`; se conservan registro, BD y slug, y no admite más cambios.

Tras guardar cualquier cambio de un colegio (suspender, reactivar, poner en prueba, eliminar o editar con `PATCH`) se pide a
`apreu-api` que invalide su caché del colegio (`POST {APREU_API_URL}/api/internal/tenants/{slug}/invalidate`,
cabecera `X-Internal-Token: {APREU_INTERNAL_API_TOKEN}`, timeout `APREU_API_TIMEOUT_MS`). Es de mejor esfuerzo: si
apreu-api no responde o rechaza la llamada se registra una advertencia y la operación responde normalmente; el ERP
converge en máximo `TENANT_STATUS_TTL_SECONDS`. Con varias instancias de apreu-api solo se invalida la que recibe la llamada.

### KPIs (correcciones respecto al legacy)

- Ingresos: solo `payments.status = 'applied'` (el legacy sumaba anulados).
- Cartera = Σ(`net_amount` − aplicaciones de pagos aplicados) de cargos `pending|partial|overdue`; **cartera vencida** y **deudores** usan el mismo conjunto (el legacy excluía `partial` en deudores).
- Mes actual y series en la zona `America/Bogota`; series de 6 meses rellenas con 0 y etiquetas en español.
- KPIs globales sobre colegios `active` y `trial` con BD instalada, consultados en paralelo (límite `ANALYTICS_CONCURRENCY`); los colegios inaccesibles se informan en `coverage.unreachable` en vez de ignorarse en silencio.
- Montos sumados en centavos enteros.

## Endpoints

Prefijo: `/api/platform/v1` (salvo `/health` y `/docs`). Todos requieren `Authorization: Bearer <token>` de superadmin salvo los marcados como públicos.
Errores: `{ statusCode, code, message, details? }` (404, 409, 422, 401, 403, 429, 502).

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/health` | Público. Estado del servicio. |
| GET | `/docs` | Swagger (fuera de producción). |
| POST | `/auth/login` | Público, limitado a `LOGIN_THROTTLE_LIMIT` intentos por minuto. `{email,password}` → `{accessToken, expiresIn, admin}`. |
| GET | `/auth/me` | Perfil del superadmin (invalida sesiones de cuentas desactivadas). |
| GET | `/tenants?page&limit&search&status&includeDeleted` | Lista paginada. |
| GET | `/tenants/slug-availability?slug=` | `{slug, available, reason, databaseName}`. |
| POST | `/tenants` | Aprovisiona. `{slug,name,adminEmail,adminPhone?,initialStatus?,trialEndsAt?}` → 201 `{tenant, director:{name,email,temporaryPassword}, warnings}`. |
| GET | `/tenants/:id` | Detalle. |
| PATCH | `/tenants/:id` | Edita `name`, `adminEmail`, `adminPhone`. |
| POST | `/tenants/:id/suspend` | Suspende. |
| POST | `/tenants/:id/activate` | Reactiva o convierte la prueba en activo. |
| POST | `/tenants/:id/trial` | Pone en prueba `{trialEndsAt?}`. |
| DELETE | `/tenants/:id` | Eliminación lógica. |
| GET | `/tenants/:id/analytics` | Métricas del colegio: alumnos, ingresos/pagos del mes, cartera, vencida, deudores, ingresos 6 meses, últimos 8 pagos. |
| GET | `/dashboard` | Contadores, altas por mes (6), recientes, alumnos activos e ingresos del mes globales, cobertura. |

## Variables de entorno

Ver `.env.example` (sin secretos). `main.ts` carga `.env` si existe.

| Variable | Obligatoria | Por defecto | Uso |
|---|---|---|---|
| `SUPERADMIN_JWT_SECRET` | sí | — | Firma de tokens; debe diferir de `JWT_SECRET` del ERP; ≥ 32 caracteres en producción. |
| `SUPERADMIN_JWT_EXPIRES_IN` | no | `2h` | Vigencia del token. |
| `PORT` / `CORS_ORIGINS` | no | `3100` / `http://localhost:4200` | |
| `LOGIN_THROTTLE_LIMIT` / `LOGIN_THROTTLE_TTL_SECONDS` | no | `5` / `60` | Fuerza bruta en login. |
| `MASTER_DB_HOST`, `MASTER_DB_USER`, `MASTER_DB_NAME` | sí | — | BD maestra PostgreSQL (`tenants`, `users`), sesión en UTC. `MASTER_DB_PORT` (`5432`), `MASTER_DB_PASSWORD` opcionales. |
| `TENANT_DB_HOST`, `TENANT_DB_ADMIN_USER` | sí | — | Servidor de colegios y cuenta de aprovisionamiento (rol con `CREATEDB`). `TENANT_DB_PORT` (`5432`). |
| `TENANT_DB_MAINTENANCE_DB` | no | `postgres` | BD a la que se conecta la cuenta de aprovisionamiento para `CREATE/DROP DATABASE`. |
| `TENANT_DB_OWNER` | no | — (la cuenta de aprovisionamiento) | Rol propietario de cada BD de colegio y de sus objetos; normalmente la cuenta `TENANT_DB_USER` de apreu-api. Solo `[a-z0-9_]`. |
| `TENANT_DB_READER_USER` / `_PASSWORD` | no | cuenta admin | Cuenta de solo lectura para analítica (recibe los `GRANT` en cada colegio nuevo). Solo `[a-z0-9_]`. |
| `TENANT_DB_PREFIX` | no | `apreu_` | Prefijo de las BD (solo `[a-z0-9_]`). |
| `TENANT_SCHEMA_FILE` | no | `database/postgres/tenant-schema.sql` | Esquema consolidado. Relativo al directorio de ejecución. Reemplaza a `TENANT_BASELINE_PATH`. |
| `TENANT_MIGRATIONS_DIR` | no | `database/postgres/migrations` | Migraciones `NNN-*.sql` para colegios nuevos; `none` las desactiva. |
| `TENANT_PUBLIC_URL_TEMPLATE` | no | `https://apreu.co/{slug}` | URL pública del colegio. |
| `ANALYTICS_CONCURRENCY` / `ANALYTICS_QUERY_TIMEOUT_MS` / `APP_TIME_ZONE` | no | `4` / `8000` / `America/Bogota` | |
| `APREU_API_URL` | no | — (deshabilitado) | URL base de apreu-api (http/https), p. ej. `http://apreu-api:3000`. |
| `APREU_INTERNAL_API_TOKEN` | no | — (deshabilitado) | Igual a `INTERNAL_API_TOKEN` de apreu-api. Sin URL o sin token no se invalida la caché. |
| `APREU_API_TIMEOUT_MS` | no | `3000` | Timeout de la llamada de invalidación. |

Roles PostgreSQL recomendados (corrige el `GRANT ALL ON *.*` del legacy; ningún rol es superusuario):

```sql
CREATE ROLE apreu_app LOGIN PASSWORD '…';                     -- apreu-api (TENANT_DB_USER) = TENANT_DB_OWNER
CREATE ROLE sa_provisioner LOGIN CREATEDB PASSWORD '…';       -- TENANT_DB_ADMIN_USER
GRANT apreu_app TO sa_provisioner;                            -- permite OWNER apreu_app y SET ROLE apreu_app
CREATE ROLE sa_reader LOGIN PASSWORD '…';                     -- TENANT_DB_READER_USER (los GRANT por colegio los hace el aprovisionamiento)
CREATE ROLE sa_master LOGIN PASSWORD '…';                     -- MASTER_DB_USER
GRANT CONNECT ON DATABASE apreu_master TO sa_master;
GRANT USAGE ON SCHEMA public TO sa_master;
GRANT SELECT, INSERT, UPDATE ON tenants TO sa_master;
GRANT SELECT, UPDATE (last_login) ON users TO sa_master;
```

## Base de datos maestra

Esquema: `database/postgres/master-schema.sql` (idempotente, incluye `tenants` con `trial_ends_at`/`deleted_at`, `users`,
`unaccent`, `pg_trgm` y `f_unaccent`). Esta API **no** aplica migraciones de la BD maestra: se aplican con `psql` en orden
(`database/postgres/master-migrations/*.sql`).

```bash
createdb -U postgres apreu_master
psql -v ON_ERROR_STOP=1 -U postgres -d apreu_master -f database/postgres/master-schema.sql
```

Crear un superadmin (hash bcrypt `$2y$`, correo en minúscula):

```bash
HASH=$(node -e 'console.log(require("bcryptjs").hashSync(process.argv[1], 12).replace(/^\$2[ab]\$/, "$$2y$"))' 'ClaveSegura')
# psql solo interpola :'hash' en la entrada estándar, no en -c
echo "INSERT INTO users (name, email, password, role) VALUES ('Operador', 'ops@apreu.co', :'hash', 'superadmin');" \
  | psql -v ON_ERROR_STOP=1 -d apreu_master -v hash="$HASH"
```

## Scripts

| Script | Descripción |
|---|---|
| `npm run start:dev` | Desarrollo con recarga. |
| `npm run build` / `npm run start:prod` | Compilación y ejecución (`dist/main`). |
| `npm test` | Pruebas unitarias (Vitest + SWC). |
| `npm run test:cov` | Cobertura. |
| `npm run test:e2e` | E2E en `test/*.e2e-spec.ts` (pendiente, contra PostgreSQL en Docker). |
| `npm run lint` / `npm run format` | oxlint / Prettier. |
| `npx tsc --noEmit -p tsconfig.json` | Verificación de tipos. |

## Pruebas

- Dominio: `Tenant` (transiciones, validaciones), `TenantSlug`, `PlatformUser`, calendario, montos, series.
- Casos de uso con dobles en memoria: login, aprovisionamiento (incluida la compensación en cada paso), gestión y analítica.
- Adaptadores con un conector SQL falso: aprovisionador (SQL emitido, identificadores citados, `schema_migrations`, propietario y
  permisos de la cuenta lectora, mapeo de SQLSTATE, rollback), lector de estadísticas, catálogo y parser SQL (incluidos el
  `tenant-schema.sql` real y las migraciones de `database/postgres/migrations`).
- Verificación real en `apreu-dev-pg` (API compilada dentro de `node:24-alpine --network container:apreu-dev-pg`): login,
  `POST /tenants` (`apreu_<slug>` con 60 tablas + `schema_migrations`, extensiones, `TimeZone`, director), analítica,
  dashboard, búsqueda sin tildes, reaplicación idempotente, compensación y eliminación lógica; con y sin `TENANT_DB_OWNER`
  y cuenta lectora.
- Controllers con `@nestjs/testing`, guard JWT, filtro de errores, throttling y una prueba de cableado HTTP del `AppModule` completo con supertest.
