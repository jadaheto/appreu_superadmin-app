// Parseo y validación de argumentos de la CLI (sin E/S; cubierto por test/).
import { parseArgs } from 'node:util';

export const USAGE = `Uso:
  migrate --source mysql://usr:pwd@host:3306 --target postgres://usr:pwd@host:5432 --tenant <slug>
          [--source-db apreu_<slug>] [--target-db apreu_<slug>] [--create-db] [--dry-run]
          [--fix] [--truncate] [--verify-only] [--batch 1000] [--datetime-tz America/Bogota] [--report-dir ./reports]
  migrate --source ... --target ... --master   (BD maestra: tenants, users; --datetime-tz UTC por defecto)

  --tenant <slug>    colegio; BD por defecto apreu_<slug> (guiones -> guion bajo)
  --master           BD maestra (apreu_master)
  --create-db        si la BD destino no existe, la crea y aplica database/postgres/{tenant,master}-schema.sql
                     y las migraciones de postgres/{migrations,master-migrations}
  --dry-run          solo preflight y detección de conflictos; no escribe nada
  --verify-only      no copia: solo compara origen y destino (conteos y sumas de control); útil justo antes del cambio
  --fix              aplica las correcciones registradas a los conflictos corregibles (ver README)
  --truncate         permite reemplazar los datos si la BD destino ya tiene filas
  --batch <n>        filas por INSERT (por defecto 1000; se limita a 65535 parámetros)
  --datetime-tz <z>  zona en que el legacy escribió las columnas datetime (colegio: America/Bogota, maestra: UTC)
  --report-dir <d>   carpeta de los reportes JSON y texto (por defecto ./reports)
`;

export class UsageError extends Error {}

export function parseCli(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      source: { type: 'string' },
      target: { type: 'string' },
      tenant: { type: 'string' },
      master: { type: 'boolean', default: false },
      'source-db': { type: 'string' },
      'target-db': { type: 'string' },
      'create-db': { type: 'boolean', default: false },
      'dry-run': { type: 'boolean', default: false },
      'verify-only': { type: 'boolean', default: false },
      fix: { type: 'boolean', default: false },
      truncate: { type: 'boolean', default: false },
      batch: { type: 'string', default: '1000' },
      'datetime-tz': { type: 'string' },
      'report-dir': { type: 'string', default: 'reports' },
      help: { type: 'boolean', short: 'h', default: false },
    },
    strict: true,
    allowPositionals: false,
  });
  if (values.help) return { help: true };
  if (!values.source || !/^(mysql|mariadb):\/\//.test(values.source)) throw new UsageError('--source debe ser mysql://usuario:clave@host:puerto');
  if (!values.target || !/^postgres(ql)?:\/\//.test(values.target)) throw new UsageError('--target debe ser postgres://usuario:clave@host:puerto[/bd_mantenimiento]');
  if (values.master === !!values.tenant) throw new UsageError('Indique --tenant <slug> o --master (uno solo)');
  if (values.tenant && !/^[a-z0-9][a-z0-9_-]{0,50}$/.test(values.tenant)) throw new UsageError('--tenant: slug en minúscula (a-z, 0-9, _ o -)');
  if (values['verify-only'] && (values['dry-run'] || values.truncate || values['create-db'])) throw new UsageError('--verify-only no se combina con --dry-run, --truncate ni --create-db');
  const batch = Number(values.batch);
  if (!Number.isInteger(batch) || batch < 1 || batch > 100000) throw new UsageError('--batch debe ser un entero entre 1 y 100000');
  const defaultDb = values.master ? 'apreu_master' : `apreu_${values.tenant.replace(/-/g, '_')}`;
  const dbRe = /^[a-z_][a-z0-9_]{0,62}$/;
  const sourceDb = values['source-db'] ?? defaultDb;
  const targetDb = values['target-db'] ?? defaultDb;
  if (!dbRe.test(sourceDb) || !dbRe.test(targetDb)) throw new UsageError('Nombre de BD inválido (minúsculas, dígitos y _)');
  return {
    source: values.source,
    target: values.target,
    tenant: values.tenant ?? null,
    master: values.master,
    sourceDb,
    targetDb,
    createDb: values['create-db'],
    dryRun: values['dry-run'],
    verifyOnly: values['verify-only'],
    fix: values.fix,
    truncate: values.truncate,
    batch,
    datetimeZone: values['datetime-tz'] ?? (values.master ? 'UTC' : 'America/Bogota'),
    reportDir: values['report-dir'],
  };
}

/** Código de salida por estado del reporte. */
export function exitCode(status) {
  return { ok: 0, dry_run: 0, conflicts: 2, target_not_empty: 3, preflight_failed: 4, fk_failed: 5, verification_failed: 6 }[status] ?? 1;
}
