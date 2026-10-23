#!/usr/bin/env node
// Sembrador de datos de prueba de Apreu v2 (a través de la API). Ver README.md.
//
//   node seed-demo.mjs                                  # colegio demo, tamaño completo
//   node seed-demo.mjs --reset                          # restaura baseline/demo.json y siembra
//   node seed-demo.mjs --tenant liceo-moderno --size small   # aprovisiona (si falta) y siembra
//   node seed-demo.mjs --all                            # demo + los 3 colegios nuevos
//   node seed-demo.mjs --verify                         # solo verificación
//   node seed-demo.mjs --only payments,expenses         # pasos sueltos
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CONFIG, HttpClient, TenantApi, log, parseArgs, restore, snapshot, tenantDbName, warn, withDb } from './lib/core.mjs';
import { SCHOOLS } from './lib/data.mjs';
import { stepAccountingSetup, stepInstitution, stepStaff, stepStructure } from './lib/steps-setup.mjs';
import { stepStudents, stepFinanceSetup, stepCharges, stepPayments, stepExpenses } from './lib/steps-finance.mjs';
import { stepAcademicRecords, stepAttendance } from './lib/steps-academic.mjs';
import { stepHr, stepInventory, stepCommunications, stepEInvoicing, stepBackdate, stepCloseAccounting, stepWithdrawals } from './lib/steps-other.mjs';
import { verify } from './lib/verify.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_DIR = join(HERE, 'baseline');

/** Precios 2026 por nivel (matrícula y pensión mensual). */
const PRICES = {
  full: {
    matricula: { preescolar: 310000, primaria: 350000, secundaria: 390000, media: 430000 },
    pension: { preescolar: 280000, primaria: 320000, secundaria: 360000, media: 400000 },
  },
  small: {
    matricula: { preescolar: 260000, primaria: 290000, secundaria: 320000, media: 350000 },
    pension: { preescolar: 230000, primaria: 260000, secundaria: 290000, media: 320000 },
  },
};

/** Pasos en orden. `small` = se corre también en los colegios pequeños. */
const STEPS = [
  ['institution', stepInstitution, true],
  ['accounting', stepAccountingSetup, true],
  ['structure', stepStructure, true],
  ['staff', stepStaff, true],
  ['finance-setup', stepFinanceSetup, true],
  ['students', stepStudents, true],
  ['charges', stepCharges, true],
  ['payments', stepPayments, true],
  ['expenses', stepExpenses, true],
  ['academic', stepAcademicRecords, true],
  ['attendance', stepAttendance, true],
  ['hr', stepHr, true],
  ['inventory', stepInventory, true],
  ['communications', stepCommunications, true],
  ['e-invoicing', stepEInvoicing, true],
  ['withdrawals', stepWithdrawals, false],
  ['backdate', stepBackdate, true],
  ['close-accounting', stepCloseAccounting, true],
];

const HELP = `Uso: node seed-demo.mjs [--tenant <slug>] [--size full|small] [--reset] [--all] [--verify]
                         [--only paso1,paso2] [--skip paso] [--save-baseline <slug>]
Pasos: ${STEPS.map(([n]) => n).join(', ')}`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(HELP);
  if (args.saveBaseline) return saveBaseline(args.saveBaseline);
  if (args.makeFixture) return makeE2eFixture();

  const slugs = args.all ? ['demo', 'colegio-la-esperanza', 'liceo-moderno', 'gimnasio-del-caribe'] : [args.tenant];
  for (const slug of slugs) {
    const school = SCHOOLS[slug];
    if (!school) throw new Error(`Colegio desconocido "${slug}". Conocidos: ${Object.keys(SCHOOLS).join(', ')}`);
    const size = args.all ? school.size : (args.size ?? school.size);
    await seedTenant({ ...school, size }, args);
  }
  if (!args.only || args.verify) await verify(slugs.map((s) => SCHOOLS[s]));
}

async function seedTenant(school, args) {
  log(`=== ${school.slug} (${school.size}) ===`);
  if (school.slug !== 'demo') await ensureProvisioned(school);
  else if (!args.verify) await syncTenantRecord(school);
  const dbName = await tenantDbName(school.slug);
  if (!dbName) throw new Error(`El colegio ${school.slug} no está registrado en ${CONFIG.masterDb}.`);
  if (args.verify) return;

  const baselineFile = join(BASELINE_DIR, `${school.slug}.json`);
  if (!existsSync(baselineFile)) {
    if (school.slug === 'demo') throw new Error(`Falta ${baselineFile} (estado conocido del colegio demo).`);
    // Colegio recién aprovisionado: su estado actual es el estado conocido.
    await writeBaseline(dbName, baselineFile);
  }
  if (args.reset) {
    log(`reset: restaurando ${baselineFile} en ${dbName}`);
    await restore(dbName, JSON.parse(readFileSync(baselineFile, 'utf8')));
  }

  const api = new TenantApi(school.slug);
  const token = await api.login(school.director.email, school.director.password);
  const ctx = { school, dbName, api, admin: api.as(token), adminToken: token, prices: PRICES[school.size], args };

  for (const [name, fn, small] of STEPS) {
    if (args.only && !args.only.includes(name)) continue;
    if (args.skip.includes(name)) continue;
    if (school.size !== 'full' && !small) continue;
    const t0 = Date.now();
    await fn(ctx);
    log(`✔ ${name} (${((Date.now() - t0) / 1000).toFixed(1)} s, ${api.http.count} peticiones acumuladas)`);
  }
}

/** Aprovisiona el colegio por superadmin-api si no existe y fija la contraseña del director (SQL #1). */
async function ensureProvisioned(school) {
  const exists = await withDb(CONFIG.masterDb, (db) => db.query('SELECT id, status FROM tenants WHERE slug = $1', [school.slug]));
  if (exists.rows.length) return;
  const sa = new HttpClient(CONFIG.superadminUrl);
  const { accessToken } = await sa.post('/auth/login', CONFIG.superadmin);
  const res = await sa.post(
    '/tenants',
    {
      slug: school.slug,
      name: school.name,
      adminEmail: school.director.email,
      adminPhone: school.phoneProvision,
      initialStatus: school.initialStatus,
      ...(school.trialEndsAt ? { trialEndsAt: school.trialEndsAt } : {}),
    },
    { token: accessToken },
  );
  log(`aprovisionado ${school.slug} (${res.tenant.status}); BD ${res.tenant.dbName ?? ''}`);
  if (res.warnings?.length) warn(res.warnings.join('; '));
  const dbName = await tenantDbName(school.slug);
  await withDb(dbName, async (db) => {
    const { hashPassword } = await import('./lib/core.mjs');
    await db.query('UPDATE users SET password = $1, must_change_password = false, name = $2 WHERE lower(email) = $3', [
      hashPassword(school.director.password),
      school.director.name,
      school.director.email.toLowerCase(),
    ]);
  });
}

/** Alinea el registro del colegio en la BD maestra (nombre/correo del director) vía superadmin `PATCH`. */
async function syncTenantRecord(school) {
  const row = await withDb(CONFIG.masterDb, (db) => db.query('SELECT id, name, admin_email FROM tenants WHERE slug = $1', [school.slug]));
  const tenant = row.rows[0];
  if (!tenant || (tenant.name === school.name && tenant.admin_email === school.director.email)) return;
  const sa = new HttpClient(CONFIG.superadminUrl);
  const { accessToken } = await sa.post('/auth/login', CONFIG.superadmin);
  await sa.patch(`/tenants/${tenant.id}`, { name: school.name, adminEmail: school.director.email, adminPhone: '3005550101' }, { token: accessToken });
  log(`superadmin: registro de ${school.slug} actualizado (${school.name})`);
}

async function writeBaseline(dbName, file) {
  mkdirSync(BASELINE_DIR, { recursive: true });
  writeFileSync(file, JSON.stringify(await snapshot(dbName)));
  log(`baseline guardado: ${file}`);
}

/**
 * `--make-e2e-fixture`: (re)crea `apreu_demo_fixture` (esquema + baseline/demo.json) y `apreu_master_fixture`
 * (esquema maestro + filas de apreu_master), BD sin conexiones que la suite E2E puede clonar con TEMPLATE:
 * E2E_SOURCE_TENANT_DB=apreu_demo_fixture E2E_SOURCE_MASTER_DB=apreu_master_fixture apreu-api/test/run-e2e.sh
 */
async function makeE2eFixture() {
  const root = join(HERE, '..', 'postgres');
  const create = async (name, schemaFile) => {
    await withDb('postgres', async (db) => {
      await db.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await db.query(`CREATE DATABASE "${name}" ENCODING 'UTF8' TEMPLATE template0`);
    });
    await withDb(name, (db) => db.query(readFileSync(join(root, schemaFile), 'utf8')));
  };
  await create('apreu_demo_fixture', 'tenant-schema.sql');
  await withDb('apreu_demo_fixture', (db) => db.query(`ALTER DATABASE apreu_demo_fixture SET "TimeZone" TO 'America/Bogota'`));
  await restore('apreu_demo_fixture', JSON.parse(readFileSync(join(BASELINE_DIR, 'demo.json'), 'utf8')));
  await create('apreu_master_fixture', 'master-schema.sql');
  await restore('apreu_master_fixture', await snapshot(CONFIG.masterDb));
  log('BD apreu_demo_fixture y apreu_master_fixture listas para las E2E.');
}

/** `--save-baseline <slug>`: guarda el estado actual del colegio como estado conocido. */
async function saveBaseline(slug) {
  const source = process.env.BASELINE_SOURCE_DB ?? (await tenantDbName(slug));
  await writeBaseline(source, join(BASELINE_DIR, `${slug}.json`));
}

main().catch((error) => {
  console.error('\n✖', error.stack ?? error);
  process.exit(1);
});
