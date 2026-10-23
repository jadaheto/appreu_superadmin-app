// Verificación por API: tableros no vacíos y coherentes, búsqueda sin tildes y conteos por colegio.
import { CONFIG, HttpClient, TenantApi, log, tenantDbName, withDb } from './core.mjs';
import { PASSWORDS } from './data.mjs';

const results = [];
const check = (tenant, name, ok, detail = '') => {
  results.push({ tenant, name, ok, detail });
  console.log(`  ${ok ? '✔' : '✖'} [${tenant}] ${name}${detail ? ` — ${detail}` : ''}`);
};
const money = (n) => `$${Math.round(n ?? 0).toLocaleString('es-CO')}`;

export const ctx = {};

export async function verify(schools) {
  log('=== verificación ===');
  for (const school of schools) {
    const api = new TenantApi(school.slug);
    const token = await api.login(school.director.email, school.director.password);
    const admin = api.as(token);
    const t = school.slug;

    const dash = await admin.get('/dashboard/admin');
    check(t, 'dashboard admin: alumnos activos', dash.students.active > 0, `${dash.students.active} activos de ${dash.students.total}`);
    const fin = dash.finance ?? {};
    check(t, 'dashboard admin: cartera vencida', (fin.overdue?.amount ?? 0) > 0, `${money(fin.overdue?.amount)} en ${fin.overdue?.debtors} deudores`);
    const months = fin.monthlyRevenue ?? [];
    check(t, 'dashboard admin: ingresos por mes', months.some((m) => m.amount > 0), months.map((m) => `${m.label}=${money(m.amount)}`).join(' '));
    check(t, 'dashboard admin: ingresos de hoy', (fin.todayRevenue?.amount ?? 0) > 0, `${money(fin.todayRevenue?.amount)} en ${fin.todayRevenue?.payments} pagos`);
    check(t, 'dashboard admin: empleados activos', (dash.staff?.activeEmployees ?? 0) > 0, `${dash.staff?.activeEmployees}`);
    check(t, 'dashboard admin: incidencias pendientes', (dash.incidents?.pending ?? 0) > 0, `${dash.incidents?.pending}`);

    const fd = await admin.get('/finance/dashboard');
    check(t, 'finanzas: tablero', fd && Object.keys(fd).length > 0, JSON.stringify(fd).slice(0, 220));
    const aging = await admin.get('/finance/aging');
    const agingText = JSON.stringify(aging);
    check(t, 'finanzas: cartera por edades', /[1-9]/.test(agingText), agingText.slice(0, 220));
    const summary = await admin.get('/finance/charges/summary');
    const rows = Array.isArray(summary) ? summary : summary.items ?? [];
    const pen = rows.find((x) => x.conceptName === 'Pensión');
    check(t, 'finanzas: resumen de cobros (pensión del mes)', rows.length > 0 && rows.every((x) => x.totalPaid <= x.totalNet), pen ? `pensión ${pen.period}: ${pen.paidCount}/${pen.chargesCount} pagadas (${pen.paidRate} %)` : JSON.stringify(rows).slice(0, 200));

    const ad = await admin.get('/academic/dashboard');
    check(t, 'académico: tablero', ad && Object.keys(ad).length > 0, JSON.stringify(ad).slice(0, 220));
    const acc = await admin.get('/accounting/dashboard');
    check(t, 'contabilidad: tablero', acc && Object.keys(acc).length > 0, JSON.stringify(acc).slice(0, 220));
    const tb = await admin.get(`/accounting/reports/trial-balance?from=2026-01-01&to=${CONFIG.today}`);
    check(t, 'contabilidad: balance de prueba cuadrado', tb.balanced === true && tb.totals.debit > 0, `débitos ${money(tb.totals.debit)}`);
    const payroll = await admin.get(`/payroll/kpis?month=${CONFIG.today.slice(0, 7)}`);
    check(t, 'nómina: KPIs', payroll && Object.keys(payroll).length > 0, JSON.stringify(payroll).slice(0, 200));
    const inv = await admin.get('/inventory/kpis');
    check(t, 'inventario: KPIs', JSON.stringify(inv).match(/[1-9]/) !== null, JSON.stringify(inv).slice(0, 200));

    if (school.slug === 'demo') {
      for (const q of ['nunez', 'pena', 'munoz']) {
        const res = await admin.get(`/students?search=${q}&limit=50`);
        const names = (res.items ?? res).map((s) => `${s.firstName} ${s.lastName}`);
        const accent = { nunez: 'Núñez', pena: 'Peña', munoz: 'Muñoz' }[q];
        check(t, `búsqueda "${q}"`, names.some((n) => n.includes(accent)), `${names.length} resultados: ${names.slice(0, 4).join(', ')}`);
      }
      const fs = await admin.get('/finance/students/search?q=pena&limit=20');
      const fl = Array.isArray(fs) ? fs : fs.items ?? [];
      check(t, 'búsqueda de caja "pena"', fl.length > 0, `${fl.length} resultados`);
      // Roles de prueba.
      for (const [email, role, pw] of [
        ['tesoreria@demo.co', 'finance', PASSWORDS.staff],
        ['talento.humano@demo.co', 'hr', PASSWORDS.staff],
        ['marta@demo.co', 'teacher', PASSWORDS.staff],
      ]) {
        try {
          const tk = await api.login(email, pw);
          const me = await api.as(tk).get('/auth/me');
          check(t, `login ${role}`, me.role === role && !me.mustChangePassword, `${email}`);
          if (role === 'finance') {
            const d = await api.as(tk).get('/finance/dashboard');
            check(t, 'finanzas (rol finance): tablero', Boolean(d));
          }
        } catch (e) {
          check(t, `login ${role}`, false, e.message);
        }
      }
    }
    // Portal: un acudiente con varios hijos y un estudiante.
    const db = await tenantDbName(school.slug);
    const portal = await withDb(db, (c) =>
      c.query(`SELECT (SELECT u.email FROM users u JOIN guardians g ON g.user_id = u.id
                        JOIN students s ON s.guardian_id = g.id GROUP BY u.email ORDER BY count(*) DESC, u.email LIMIT 1) parent,
                      (SELECT u.email FROM users u JOIN students s ON s.user_id = u.id
                        WHERE s.status = 'active' ORDER BY s.id DESC LIMIT 1) student`),
    );
    for (const [role, email] of Object.entries(portal.rows[0])) {
      if (!email) continue;
      try {
        const tk = await api.login(email, PASSWORDS.portal);
        const ctxRes = await api.as(tk).get('/portal/context');
        const kids = ctxRes.students ?? ctxRes.items ?? [];
        const first = kids[0]?.id ?? kids[0]?.studentId;
        const dashRes = first ? await api.as(tk).get(`/portal/students/${first}/dashboard`) : null;
        check(t, `portal ${role}`, kids.length > 0 && Boolean(dashRes), `${email}: ${kids.length} estudiante(s)`);
        (ctx.portalLogins ??= []).push({ tenant: t, role, email });
      } catch (e) {
        check(t, `portal ${role}`, false, `${email}: ${e.message}`);
      }
    }
    await counts(school);
  }

  // Superadmin.
  const sa = new HttpClient(CONFIG.superadminUrl);
  const { accessToken } = await sa.post('/auth/login', CONFIG.superadmin);
  const sd = await sa.get('/dashboard', { token: accessToken });
  check('superadmin', 'dashboard global', JSON.stringify(sd).length > 50, JSON.stringify(sd).slice(0, 300));
  const tenants = await sa.get('/tenants?limit=50', { token: accessToken });
  for (const school of schools) {
    const tenant = (tenants.items ?? tenants).find((x) => x.slug === school.slug);
    if (!tenant) continue;
    const an = await sa.get(`/tenants/${tenant.id}/analytics`, { token: accessToken });
    check('superadmin', `analítica ${school.slug}`, JSON.stringify(an).match(/"students"|"activeStudents"/) !== null, JSON.stringify(an).slice(0, 260));
  }
  const failed = results.filter((r) => !r.ok);
  log(`verificación: ${results.length - failed.length}/${results.length} OK`);
  if (failed.length) process.exitCode = 2;
}

/** Conteos por entidad (lectura SQL, solo para el informe). */
async function counts(school) {
  const db = await tenantDbName(school.slug);
  const rows = await withDb(db, (c) =>
    c.query(`SELECT
      (SELECT count(*) FROM students) estudiantes,
      (SELECT count(*) FROM students WHERE status='active') activos,
      (SELECT count(*) FROM guardians) acudientes,
      (SELECT count(*) FROM users) usuarios,
      (SELECT count(*) FROM employees) empleados,
      (SELECT count(*) FROM grades) grados,
      (SELECT count(*) FROM classrooms) salones,
      (SELECT count(*) FROM subjects) materias,
      (SELECT count(*) FROM teacher_assignments) asignaciones,
      (SELECT count(*) FROM academic_periods) periodos,
      (SELECT count(*) FROM student_grades) notas,
      (SELECT count(*) FROM student_bulletins) boletines,
      (SELECT count(*) FROM attendance_records) asistencia,
      (SELECT count(*) FROM billing_concepts) conceptos,
      (SELECT count(*) FROM student_charges) cobros,
      (SELECT count(*) FROM payments) pagos,
      (SELECT count(*) FROM payments WHERE status<>'applied') pagos_anulados,
      (SELECT count(*) FROM payments WHERE reconciled) pagos_conciliados,
      (SELECT count(*) FROM expenses) gastos,
      (SELECT count(*) FROM accounting_accounts) cuentas_puc,
      (SELECT count(*) FROM accounting_journal_entries) asientos,
      (SELECT count(*) FROM accounting_periods) periodos_contables,
      (SELECT count(*) FROM accounting_third_parties) terceros,
      (SELECT count(*) FROM payroll_periods) nominas,
      (SELECT count(*) FROM payroll_payments) desprendibles,
      (SELECT count(*) FROM employee_leaves) permisos,
      (SELECT count(*) FROM hr_issued_documents) certificados_laborales,
      (SELECT count(*) FROM employee_stickers) stickers,
      (SELECT count(*) FROM inventory_items) items,
      (SELECT count(*) FROM inventory_movements) movimientos,
      (SELECT count(*) FROM incidents) incidencias,
      (SELECT count(*) FROM certificates) certificados,
      (SELECT count(*) FROM notifications) notificaciones,
      (SELECT count(*) FROM whatsapp_templates) plantillas_whatsapp,
      (SELECT count(*) FROM dian_consecutives) resoluciones_dian`),
  );
  const row = Object.fromEntries(Object.entries(rows.rows[0]).map(([k, v]) => [k, Number(v)]));
  console.log(`  conteos ${school.slug}: ${Object.entries(row).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  return row;
}
