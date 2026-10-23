# Datos de prueba (`database/seeds`)

`seed-demo.mjs` siembra datos realistas (región Caribe colombiana, año lectivo 2026) **a través de la API**
(`apreu-api` y `superadmin-api`), de modo que se respetan consecutivos (recibos, códigos de estudiante y de
empleado, comprobantes contables), asientos automáticos, saldos, estados y validaciones. El SQL directo se usa solo
para lo que la API no permite; cada uso está listado abajo.

## Cómo correrlo

El sandbox no deja llegar del host a Docker por TCP: se corre en un contenedor de la red `apreu-dev`
(donde están `apreu-dev-api`, `superadmin-dev-api` y `apreu-dev-pg`).

```bash
cd database/seeds
docker run --rm --network apreu-dev --user "$(id -u):$(id -g)" -e HOME=/tmp \
  -v "$(cd ../.. && pwd)":/work -w /work/database/seeds node:24-alpine npm ci        # solo la primera vez

RUN='docker run --rm --network apreu-dev --user '"$(id -u):$(id -g)"' -e HOME=/tmp -v '"$(cd ../.. && pwd)"':/work -w /work/database/seeds node:24-alpine node seed-demo.mjs'
$RUN --all --reset         # demo + 3 colegios nuevos desde el estado conocido (~15 min)
$RUN                       # solo demo, idempotente (completa lo que falte)
$RUN --reset               # demo desde su estado conocido
$RUN --tenant liceo-moderno --size small   # aprovisiona el colegio si no existe y lo siembra
$RUN --verify --all        # solo verificación (tableros, búsqueda, conteos)
$RUN --only payments,expenses              # pasos sueltos (ver --help)
```

Opciones: `--tenant <slug>` (por defecto `demo`), `--size full|small`, `--reset`, `--all`, `--verify`,
`--only a,b`, `--skip a`, `--make-e2e-fixture`, `--save-baseline <slug>` (guarda el estado actual como estado conocido; con
`BASELINE_SOURCE_DB=<bd>` lo toma de otra BD). Variables: `APREU_API_URL`
(`http://apreu-dev-api:3000/api`), `SUPERADMIN_API_URL` (`http://superadmin-dev-api:3100/api/platform/v1`),
`SUPERADMIN_EMAIL`/`SUPERADMIN_PASSWORD`, `PGHOST`/`PGPORT`/`PGUSER`/`PGPASSWORD` (`apreu-dev-pg:5432`, postgres).

Pasos, en orden: `institution`, `accounting`, `structure`, `staff`, `finance-setup`, `students`, `charges`,
`payments`, `expenses`, `academic`, `attendance`, `hr`, `inventory`, `communications`, `e-invoicing`,
`withdrawals` (solo demo), `backdate` (SQL), `close-accounting`; al final, verificación.

### Re-ejecución y estado conocido
- **Idempotente.** Los datos salen de un PRNG con semilla por colegio, así que cada corrida genera lo mismo; cada paso
  detecta lo que ya existe por clave natural (nombre de grado/materia/salón, correo del empleado, nombre completo del
  estudiante, nombre de concepto/categoría, SKU, documento del tercero, fecha de inicio de períodos, título de
  incidencias/stickers/notificaciones, nombre de plantilla, prefijo de resolución) o usa operaciones idempotentes de la
  API (lotes de cobro, planillas de notas, asistencia, reglas contables). Los pagos solo se planean sobre cobros que
  siguen abiertos (los de familias morosas quedan vencidos a propósito).
- **`--reset`** vacía todas las tablas del colegio (salvo `schema_migrations`) y restaura `baseline/<slug>.json`,
  incluidos los contadores de las columnas identity:
  - `baseline/demo.json` = el colegio demo de desarrollo tal como estaba el 2026-10-21 antes de sembrar (fixture de
    las E2E: director, Laura y Tomás Gómez en 6A, Marta Ruiz, Matemáticas, «Periodo 1», nómina de marzo, etc.).
  - Colegios nuevos: el snapshot se toma automáticamente justo después de aprovisionarlos (director + `settings`).
- Cambiar los catálogos o pesos de `lib/data.mjs`/`lib/plan.mjs` cambia el plan: después hay que correr con `--reset`.

## Qué se crea

Conteos tras `--all --reset` (2026-10-21; "small" = colegios nuevos):

| Entidad | demo | la-esperanza | liceo-moderno | gimnasio-del-caribe |
|---|---|---|---|---|
| Estudiantes (activos) | 150 (148; 2 retirados) | 55 | 40 | 32 |
| Acudientes / usuarios de portal (acud.+est.) | 113 / 29+45 | 36 | 26 | 23 |
| Empleados (docentes + adm.) | 21 (16 doc. + 5 adm., incl. fixture) | 8 (6+2) | 8 | 8 |
| Grados / salones / materias / asignaciones | 12 / 15 / 118 / 149 | 12 / 12 / 118 / 118 | igual | igual |
| Períodos académicos | P1–P2 con boletines, P3 cerrado, P4 abierto | igual | igual | igual |
| Notas / boletines / asistencia | 5 230 / 300 / 4 782 | 1 887 / 110 / 385 | 1 368 / 80 / 280 | 1 094 / 64 / 224 |
| Cobros / pagos (anulados, conciliados) | 2 124 / 1 430 (2, 364) | 758 / 536 (2, 127) | 525 / 400 (2, 100) | 472 / 310 (2, 81) |
| Gastos | 64 | 57 | 57 | 57 |
| PUC / asientos / períodos contables (ene–ago cerrados) / terceros | 68 / 1 494 / 12 / 9 | 68 / 595 / 12 / 9 | 68 / 459 / 12 / 9 | 68 / 369 / 12 / 9 |
| Nóminas (pagadas + octubre calculada) / desprendibles | 10 (ene–sep + oct) / 181 | 3 (ago–sep + oct) / 24 | igual | igual |
| Permisos / cert. laborales / stickers | 7 / 2 / 4 | 2 / 2 / 4 | igual | igual |
| Ítems / movimientos de inventario | 40 / 142 (12 stock bajo, 5 agotados) | 20 / 76 | 20 / 76 | 20 / 74 |
| Incidencias / certificados de estudio | 13 / 10 | 6 / 5 | 6 / 5 | 6 / 5 |
| Notificaciones / plantillas WhatsApp | 115 / 5 | 59 / 5 | 35 / 5 | 35 / 5 |

Comportamiento financiero (demo): matrícula + seguro + pensiones feb–oct por lote (tarifa por grado, 2 becas de 50 % y
30 %), transporte mensual (~22 %), uniformes (feb) y derechos de grado (11°). Perfiles por familia: puntual, tardío,
moroso 2 meses, moroso 3 meses, atrasado 1 mes y "adelantado" (saldo a favor). Resultado: cartera vencida
$27,78 M en 34 deudores (~23 %), 10 estudiantes con saldo a favor, 29 pagos hoy; medios: efectivo, transferencia,
Nequi, PSE, Daviplata y datáfono; recibos consecutivos en orden cronológico; 2 pagos anulados y vueltos a registrar;
~70 % de transferencias/PSE conciliadas; 2 certificados pagados en caja (emisión automática).

## SQL directo (y por qué)
| # | Qué | Por qué la API no sirve |
|---|---|---|
| 0 | `--reset`: `TRUNCATE … RESTART IDENTITY` + restauración del snapshot JSON (`session_replication_role = replica`) | No hay endpoint para vaciar/restaurar un colegio. |
| 1 | Contraseñas conocidas: `UPDATE users SET password = bcrypt, must_change_password = false` para el personal sembrado, todos los usuarios `student`/`parent` y los directores de los colegios aprovisionados | La API solo genera contraseñas temporales aleatorias (devueltas una vez) con cambio obligatorio, y el login admite 10 intentos/min por IP. |
| 2 | Paso `backdate`: solo mueve marcas de tiempo hacia atrás (idempotente) | La API las fija con "ahora". |
|   | – nómina pagada: `calculated_at`/`approved_at`/`paid_at`, fecha del gasto `NOMINA-<id>` y fecha/período contable del asiento SALA | Pagar la nómina de enero hoy dejaría todos los asientos y gastos en octubre. |
|   | – `payments.created_at` = fecha del pago; `posted_at`/`created_at` de los asientos de recibos y gastos | "Últimos pagos" del tablero ordena por `created_at`. |
|   | – `student_charges.created_at` ≈ mes cobrado; `expenses.created_at` = fecha del gasto | Los lotes de febrero–octubre se generan hoy. |
|   | – `academic_periods.closed_at`, fecha de generación de boletines | Los períodos 1–3 se cierran hoy. |
|   | – hora de la asistencia (6:30–9:00) | `attendance_time` toma la hora del registro. |
|   | – `created_at` de incidencias, certificados, movimientos de inventario y permisos | Repartirlos en las últimas semanas/meses. |
| – | Lectura (solo informe): conteos por tabla en la verificación y `db_name` en `apreu_master` | — |

## Credenciales de prueba

| Colegio (`X-Tenant`) | Rol | Correo | Contraseña |
|---|---|---|---|
| — (superadmin-api) | superadmin | super@apreu.co | Super2026x |
| demo | admin (director) | director@demo.co | Demo2026 |
| demo | finance | tesoreria@demo.co | Apreu2026 |
| demo | hr | talento.humano@demo.co | Apreu2026 |
| demo | teacher (directora de 6A) | marta@demo.co | Apreu2026 |
| demo | teacher (14 más) | luz.arrieta@, yolanda.benitez@, rocio.monterrosa@, ana.payares@, edilberto.chamorro@, karen.navarro@, jose.martinez@, jennifer.hoyos@, wilfrido.romero@, alvaro.nunez@, diana.vergara@, hernan.perez@, maria.ibanez@, oscar.munoz@ (`@demo.co`) | Apreu2026 |
| demo | employee | liliana.acuna@demo.co, carlos.beltran@demo.co, ramiro.ordonez@demo.co | Apreu2026 |
| demo | parent (3 hijos) | erika.cardenas74@hotmail.com (también hernando.hernandez@hotmail.com, marcela.pacheco73@gmail.com) | Familia2026 |
| demo | parent (fixture) | carlos@demo.co | Familia2026 |
| demo | student | laura@demo.co, elias.escobar86@gmail.com, `al2026NNNN@apreu.co` (código del estudiante) | Familia2026 |
| colegio-la-esperanza (activo) | admin | rectoria@laesperanza.edu.co | Director2026 |
| liceo-moderno (prueba hasta 2026-12-15) | admin | director@liceomoderno.edu.co | Director2026 |
| gimnasio-del-caribe (activo) | admin | rector@gimnasiocaribe.edu.co | Director2026 |
| los 3 nuevos | finance | tesoreria@<dominio> | Apreu2026 |
| los 3 nuevos | teacher / employee | ver `SELECT email, role FROM users` (6 docentes + 1 secretaria por colegio) | Apreu2026 |
| los 3 nuevos | parent / student | p. ej. luz.londono@gmail.com (esperanza), rodrigo.nunez@yahoo.es (gimnasio), `al2026NNNN@apreu.co` | Familia2026 |

Todas sin cambio obligatorio de contraseña. `rrhh@demo.co` (inactiva), `rrhh2@demo.co` y `profe@demo.co` son del
fixture y no se tocan.

## Notas
- `settings.payment_methods` se deja vacío a propósito: vacío = todos los métodos (la pantalla de configuración solo
  ofrece nequi, daviplata, breb, transferencia, efectivo y datafono; PSE no se puede habilitar desde ahí, legado D10).
  Si se guarda la sección "Medios de pago" desde la UI, PSE deja de aceptarse en caja.
- Facturación electrónica: solo el emisor (ambiente de pruebas) y la resolución de habilitación `SETP`
  990000000–995000000 con la clave técnica pública de la DIAN (ver abajo); no se emiten documentos (no hay certificado).
- Las E2E (`apreu-api/test/run-e2e.sh`) dependen del fixture original (ids de Laura, Tomás, 6A, Matemáticas; PUC
  vacío; sin período contable ni nómina de octubre; sin períodos académicos en junio–agosto): contra el demo sembrado
  fallan 9 de 91 por esos supuestos. Además `TEMPLATE` exige que nadie esté conectado al origen, y la API de desarrollo
  mantiene conexiones a `apreu_demo`/`apreu_master`. Solución sin detener la API:
  ```bash
  $RUN --make-e2e-fixture    # (re)crea apreu_demo_fixture (esquema + baseline/demo.json) y apreu_master_fixture
  E2E_SOURCE_TENANT_DB=apreu_demo_fixture E2E_SOURCE_MASTER_DB=apreu_master_fixture apreu-api/test/run-e2e.sh
  ```
- Facturación electrónica: la resolución `SETP` no se registra mientras `apreu-dev-api` no tenga
  `E_INVOICING_SECRET_KEY` (la API cifra la clave técnica y responde 502). Con la variable configurada, correr
  `$RUN --only e-invoicing` (y `--tenant <slug>` para los demás colegios).
- Cada corrida agrega ~5 000 filas a `access_log` (auditoría por petición).
