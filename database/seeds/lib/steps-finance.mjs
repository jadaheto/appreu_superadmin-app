// Pasos: estudiantes y acudientes, conceptos/tarifas, cobros, pagos y gastos.
import { CONFIG, addDays, cap, log, MONTHS, minDate, pool, rng, setKnownPasswords, warn, withDb } from './core.mjs';
import { GRADES, PASSWORDS } from './data.mjs';
import { YEAR, planClassrooms, planFamilies } from './plan.mjs';
import { loadStructure } from './steps-setup.mjs';

const TODAY = () => CONFIG.today;
const PENSION_MONTHS = [2, 3, 4, 5, 6, 7, 8, 9, 10];
const dueOf = (m) => `${YEAR}-${String(m).padStart(2, '0')}-10`;
const levelOf = (gradeName) => GRADES.find((g) => g.name === gradeName)?.level;

// ---------------------------------------------------------------------------
export async function stepStudents(ctx) {
  const { admin, school, api } = ctx;
  const { rooms } = await loadStructure(ctx);
  const roomByName = new Map(rooms.map((r) => [r.name, r]));
  const existing = await api.all(admin, `/students?year=${YEAR}`);
  // El listado no trae el documento: los nombres completos del plan son únicos.
  const existingNames = new Set(existing.map((s) => `${s.firstName} ${s.lastName}`));
  const baseCount = school.slug === 'demo' ? existing.filter((s) => s.code === 'AL20260001' || s.code === 'AL20260002').length : 0;
  const families = planFamilies(school, planClassrooms(school), baseCount);

  let enrolled = 0;
  let reused = 0;
  const portalEmails = [];
  for (const family of families) {
    let guardianId = null;
    for (const child of family.children) {
      if (existingNames.has(`${child.firstName} ${child.lastName}`)) continue;
      const room = roomByName.get(child.room);
      const { room: _room, ability: _a, transport: _t, uniform: _u, enrollmentDate, ...details } = child;
      const body = {
        student: clean(details),
        classroomId: room.id,
        enrollmentDate,
        createPortalAccounts: family.portal,
        ...(guardianId ? { guardianId } : { guardian: clean(family.guardian) }),
      };
      const res = await admin.post('/students', body);
      guardianId = res.student.guardianId ?? res.student.guardian?.id ?? guardianId;
      if (res.guardianReused) reused++;
      for (const account of res.accounts ?? []) if (account.email) portalEmails.push(account.email);
      enrolled++;
    }
  }
  // SQL #1: contraseña conocida para todos los usuarios de portal (estudiantes y acudientes).
  const updated = await withDb(ctx.dbName, async (db) => {
    const { rows } = await db.query("SELECT email FROM users WHERE role IN ('student','parent')");
    return rows.map((r) => r.email);
  });
  await setKnownPasswords(ctx.dbName, updated, PASSWORDS.portal);
  ctx.families = families;
  log(`estudiantes: matriculados +${enrolled} (acudientes reutilizados ${reused}), familias planeadas ${families.length}, cuentas de portal ${updated.length}`);
}

const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined && v !== null));

/** Familias planeadas + ids reales de los estudiantes. */
export async function loadFamilies(ctx) {
  if (ctx.familiesResolved) return ctx.familiesResolved;
  const { admin, school, api } = ctx;
  const students = await api.all(admin, `/students?year=${YEAR}`);
  const byName = new Map(students.map((s) => [`${s.firstName} ${s.lastName}`, s]));
  const baseCount = school.slug === 'demo' ? students.filter((s) => s.code === 'AL20260001' || s.code === 'AL20260002').length : 0;
  const families = ctx.families ?? planFamilies(school, planClassrooms(school), baseCount);
  for (const f of families) {
    for (const c of f.children) {
      const found = byName.get(`${c.firstName} ${c.lastName}`);
      c.id = found?.id;
      c.status = found?.status;
    }
  }
  // Estudiantes de la línea base (Laura y Tomás en demo): familia sin datos de plan.
  const planned = new Set(families.flatMap((f) => f.children.map((c) => `${c.firstName} ${c.lastName}`)));
  const others = students.filter((s) => !planned.has(`${s.firstName} ${s.lastName}`));
  if (others.length) {
    families.push({
      index: -1,
      profile: 'atrasado1',
      portal: true,
      guardian: null,
      children: others.map((s) => ({ id: s.id, status: s.status, firstName: s.firstName, lastName: s.lastName, room: s.placement?.classroomName ?? '6A', ability: 3.6, baseline: true })),
    });
  }
  // Retiros planeados (solo colegio grande): dos hijos únicos de familias morosas, a fin de septiembre.
  if (school.size === 'full') {
    for (const f of families.filter((x) => x.profile === 'moroso3' && x.children.length === 1 && x.children[0].id).slice(0, 2)) {
      f.children[0].withdrawAt = `${YEAR}-09-30`;
    }
  }
  ctx.familiesResolved = families;
  ctx.studentsList = students;
  return families;
}

// ---------------------------------------------------------------------------
export async function stepFinanceSetup(ctx) {
  const { admin, prices } = ctx;
  const concepts = await admin.get('/finance/concepts');
  const list = Array.isArray(concepts) ? concepts : concepts.items;
  const want = [
    { name: 'Matrícula 2026', code: 'MAT', category: 'matricula', amount: prices.matricula.secundaria, description: 'Derechos de matrícula del año lectivo 2026' },
    { name: 'Pensión', code: 'PEN', category: 'pension', amount: prices.pension.secundaria, description: 'Pensión mensual (tarifa según grado)' },
    { name: 'Transporte escolar', code: 'TRA', category: 'transporte', amount: 180000, description: 'Ruta escolar mensual' },
    { name: 'Uniforme de diario', code: 'UND', category: 'materiales', amount: 145000, description: 'Juego de uniforme de diario' },
    { name: 'Uniforme de educación física', code: 'UEF', category: 'materiales', amount: 98000, description: 'Sudadera, pantaloneta y camiseta' },
    { name: 'Certificado de estudios', code: 'CER', category: 'certificado', amount: 15000, description: 'Certificado o constancia de estudios' },
    { name: 'Seguro estudiantil', code: 'SEG', category: 'servicios', amount: 38000, description: 'Póliza de accidentes escolares 2026' },
    { name: 'Derechos de grado', code: 'DGR', category: 'otro', amount: 250000, description: 'Ceremonia y diploma de bachiller (11°)' },
  ];
  const byName = new Map(list.map((c) => [c.name, c]));
  let created = 0;
  for (const c of want) {
    if (byName.has(c.name)) continue;
    byName.set(c.name, await admin.post('/finance/concepts', { ...c, taxRate: 0 }));
    created++;
  }
  ctx.concepts = Object.fromEntries(want.map((c) => [c.code, byName.get(c.name)]));

  const { gradeByName } = await loadStructure(ctx);
  const rates = [];
  for (const [name, grade] of gradeByName) {
    const level = levelOf(name);
    if (!level) continue;
    rates.push({ gradeId: grade.id, conceptId: ctx.concepts.MAT.id, amount: prices.matricula[level] });
    rates.push({ gradeId: grade.id, conceptId: ctx.concepts.PEN.id, amount: prices.pension[level] });
  }
  await admin.put(`/finance/tuition/${YEAR}`, { rates });

  const cats = await admin.get('/finance/expense-categories');
  const catList = Array.isArray(cats) ? cats : cats.items;
  const wantCats = ['Servicios públicos', 'Papelería y útiles', 'Mantenimiento y reparaciones', 'Aseo y cafetería', 'Tecnología y software', 'Eventos institucionales', 'Honorarios profesionales', 'Transporte escolar'];
  for (const name of wantCats) {
    if (catList.some((c) => c.name === name)) continue;
    catList.push(await admin.post('/finance/expense-categories', { name }));
  }
  ctx.expenseCategories = new Map(catList.map((c) => [c.name, c]));
  log(`finanzas: conceptos +${created}, tarifas ${rates.length}, categorías de gasto ${catList.length}`);
}

async function loadConcepts(ctx) {
  if (ctx.concepts) return ctx.concepts;
  const concepts = await ctx.admin.get('/finance/concepts');
  const list = Array.isArray(concepts) ? concepts : concepts.items;
  const codes = { MAT: 'Matrícula 2026', PEN: 'Pensión', TRA: 'Transporte escolar', UND: 'Uniforme de diario', UEF: 'Uniforme de educación física', CER: 'Certificado de estudios', SEG: 'Seguro estudiantil', DGR: 'Derechos de grado' };
  ctx.concepts = Object.fromEntries(Object.entries(codes).map(([k, n]) => [k, list.find((c) => c.name === n)]));
  return ctx.concepts;
}

// ---------------------------------------------------------------------------
export async function stepCharges(ctx) {
  const { admin } = ctx;
  const concepts = await loadConcepts(ctx);
  const families = await loadFamilies(ctx);
  const summary = [];
  const batch = async (conceptId, period, dueDate, applyScholarship = false) => {
    const res = await admin.post('/finance/charges/batch', { conceptId, period, dueDate, applyScholarship });
    summary.push(res.chargesCount);
  };
  await batch(concepts.MAT.id, `${YEAR}-01`, `${YEAR}-01-31`);
  await batch(concepts.SEG.id, `${YEAR}-02`, `${YEAR}-02-28`);
  for (const m of PENSION_MONTHS) await batch(concepts.PEN.id, `${YEAR}-${String(m).padStart(2, '0')}`, dueOf(m), true);

  // Cobros individuales: transporte (mensual), uniformes (febrero) y derechos de grado (11°).
  const existing = await ctx.api.all(admin, '/finance/charges');
  const has = new Set(existing.map((c) => `${c.studentId}:${c.conceptId}:${c.period}`));
  const jobs = [];
  for (const f of families) {
    for (const c of f.children) {
      if (!c.id || c.baseline) continue;
      if (c.transport) for (const m of PENSION_MONTHS) jobs.push([c.id, concepts.TRA.id, `${YEAR}-${String(m).padStart(2, '0')}`, dueOf(m)]);
      if (c.uniform) {
        jobs.push([c.id, concepts.UND.id, `${YEAR}-02`, `${YEAR}-02-20`]);
        if (f.index % 2 === 0) jobs.push([c.id, concepts.UEF.id, `${YEAR}-02`, `${YEAR}-02-20`]);
      }
      if (c.room.startsWith('11')) jobs.push([c.id, concepts.DGR.id, `${YEAR}-09`, `${YEAR}-11-15`]);
    }
  }
  let individual = 0;
  await pool(jobs, 4, async ([studentId, conceptId, period, dueDate]) => {
    if (has.has(`${studentId}:${conceptId}:${period}`)) return;
    await admin.post('/finance/charges', { studentId, conceptId, period, dueDate });
    individual++;
  });
  log(`cobros: lotes ${summary.join('/')} (nuevos por lote), individuales +${individual}`);
}

// ---------------------------------------------------------------------------
const METHODS = [
  ['efectivo', 32],
  ['transferencia', 24],
  ['nequi', 22],
  ['pse', 14],
  ['daviplata', 5],
  ['datafono', 3],
];
const reference = (r, method) => {
  switch (method) {
    case 'transferencia':
      return `TRF${r.digits(9)}`;
    case 'nequi':
      return `M${r.digits(7)}`;
    case 'daviplata':
      return `DP${r.digits(8)}`;
    case 'pse':
      return `CUS${r.digits(10)}`;
    case 'datafono':
      return `APR${r.digits(6)}`;
    default:
      return undefined;
  }
};

/** Mes (1–12) desde el que una familia morosa dejó de pagar pensión. */
const stopMonth = (profile) => ({ moroso3: 8, moroso2: 9, atrasado1: 10 })[profile] ?? 99;

/**
 * Pagos en orden cronológico (los recibos quedan consecutivos por fecha). Idempotente: solo se
 * planean cobros que siguen abiertos; los de familias morosas se dejan vencidos a propósito.
 */
export async function stepPayments(ctx) {
  const { admin, api, school } = ctx;
  const families = await loadFamilies(ctx);
  const concepts = await loadConcepts(ctx);
  const today = TODAY();
  const plan = [];
  const children = families.flatMap((f) => f.children.filter((c) => c.id).map((c) => ({ ...c, family: f })));
  const chargesByStudent = new Map();
  await pool(children, 4, async (c) => {
    const charges = await admin.get(`/finance/students/${c.id}/charges`);
    chargesByStudent.set(c.id, chargesOf(charges));
  });

  for (const c of children) {
    const f = c.family;
    const open = chargesByStudent.get(c.id).filter((ch) => ['pending', 'partial', 'overdue'].includes(ch.status) && ch.pendingAmount > 0);
    if (!open.length) continue;
    // Agrupa los cobros por "momento de pago": matrícula+seguro (enero/febrero) y cada mes.
    const groups = new Map();
    for (const ch of open) {
      const month = Number(ch.period.slice(5, 7));
      if (ch.conceptId === concepts.DGR?.id) {
        if (f.profile === 'puntual' && rng(`${school.slug}:dgr:${c.id}`).chance(0.5)) push(groups, 10, ch);
        continue;
      }
      if (month >= stopMonth(f.profile) && ch.conceptId !== concepts.MAT.id) continue; // deuda vencida
      const key = ch.conceptId === concepts.MAT.id || month <= 1 ? 1 : month;
      push(groups, key, ch);
    }
    for (const [month, charges] of groups) {
      // Semilla por estudiante y mes: la misma decisión en cada corrida aunque cambien los cobros abiertos.
      const r = rng(`${school.slug}:pay:${c.id}:${month}`);
      const pending = charges.reduce((s, ch) => s + ch.pendingAmount, 0);
      let date;
      if (month === 1) date = `${YEAR}-01-${String(r.int(14, 31)).padStart(2, '0')}`;
      else if (f.profile === 'tardio') date = addDays(dueOf(month), r.int(4, 22));
      else if (f.profile === 'adelantado' && month > 2) date = addDays(dueOf(month), -r.int(8, 25));
      else date = addDays(dueOf(month), -r.int(0, 9));
      // Pensiones de octubre de algunos puntuales: pagadas hoy (ingresos del día en el tablero).
      if (month === 10 && f.profile === 'tardio') date = minDate(date, today);
      if (month === 10 && f.profile === 'puntual' && r.chance(0.12)) date = today;
      if (date > today) date = today;
      const method = r.weighted(METHODS);
      const amount = pending;
      const extra = f.profile === 'adelantado' && month === 10 ? r.pick([50000, 80000, 100000, 120000]) : 0;
      plan.push({ studentId: c.id, date, method, amount: amount + extra, extra, chargeIds: charges.map((ch) => ch.id), ref: reference(r, method), month });
    }
  }
  plan.sort((a, b) => (a.date === b.date ? a.studentId - b.studentId : a.date < b.date ? -1 : 1));

  // Dos pagos mal digitados (anulados y vueltos a registrar) en octubre.
  const voidTargets = new Set(plan.filter((p) => p.month === 10 && p.date < today && p.method === 'efectivo').slice(2, 4).map((p) => p));
  let registered = 0;
  let voided = 0;
  const transfers = [];
  for (const p of plan) {
    if (voidTargets.has(p)) {
      const wrong = await admin.post('/finance/payments', {
        studentId: p.studentId,
        amount: p.amount - 50000,
        method: 'efectivo',
        paymentDate: p.date,
        chargeIds: p.chargeIds,
        notes: 'Valor digitado por error',
      });
      await admin.post(`/finance/payments/${wrong.paymentId}/void`, { reason: 'Valor digitado por error en caja; se registra nuevamente el pago correcto.' });
      voided++;
    }
    const res = await admin.post('/finance/payments', {
      studentId: p.studentId,
      amount: p.amount,
      method: p.method,
      paymentDate: p.date,
      chargeIds: p.chargeIds,
      ...(p.ref ? { reference: p.ref } : {}),
      ...(p.extra ? { notes: 'Pago anticipado; el excedente queda como saldo a favor' } : {}),
    });
    registered++;
    if (['transferencia', 'pse'].includes(p.method)) transfers.push({ id: res.paymentId, date: p.date, ref: p.ref });
    if (registered % 200 === 0) log(`  pagos: ${registered}/${plan.length}`);
  }

  // Conciliación: ~70 % de las transferencias/PSE con más de 5 días.
  let reconciled = 0;
  const cutoff = addDays(today, -5);
  await pool(
    transfers.filter((t) => t.date < cutoff && rng(`${school.slug}:rec:${t.id}`).chance(0.7)),
    4,
    async (t) => {
      await admin.post(`/finance/payments/${t.id}/reconcile`, { bankRef: `EXT-${t.ref ?? t.id}` }, { allow: [409, 422] });
      reconciled++;
    },
  );
  log(`pagos: registrados ${registered}, anulados ${voided}, conciliados ${reconciled}`);
}

export const chargesOf = (res) => (Array.isArray(res) ? res : res.charges ?? res.items ?? []);

const push = (map, key, value) => {
  if (!map.has(key)) map.set(key, []);
  map.get(key).push(value);
};

// ---------------------------------------------------------------------------
export async function stepExpenses(ctx) {
  const { admin, api, school } = ctx;
  const r = rng(`${school.slug}:expenses`);
  if (!ctx.expenseCategories) {
    const cats = await admin.get('/finance/expense-categories');
    ctx.expenseCategories = new Map((Array.isArray(cats) ? cats : cats.items).map((c) => [c.name, c]));
  }
  const cat = (name) => ctx.expenseCategories.get(name)?.id;
  const existing = await api.all(admin, '/finance/expenses');
  const have = new Set(existing.map((e) => e.receiptNo));
  const scale = school.size === 'full' ? 1 : 0.45;
  const items = [];
  for (let m = 1; m <= 10; m++) {
    const mm = String(m).padStart(2, '0');
    const day = (d) => minDate(`${YEAR}-${mm}-${String(d).padStart(2, '0')}`, TODAY());
    const add = (category, description, amount, date, vendor, method = 'transferencia') =>
      items.push({ categoryId: cat(category), description, amount: Math.round((amount * scale) / 100) * 100, date, vendor, paymentMethod: method, receiptNo: `FC-${mm}${String(items.length + 1).padStart(3, '0')}` });
    const mes = `${MONTHS[m - 1]} ${YEAR}`;
    add('Servicios públicos', `Energía eléctrica ${mes}`, r.int(1450000, 1980000), day(18), 'Afinia — Caribe Mar de la Costa S.A.S. E.S.P.');
    add('Servicios públicos', `Acueducto y alcantarillado ${mes}`, r.int(380000, 520000), day(20), 'Aguas de La Sabana S.A. E.S.P.');
    add('Servicios públicos', `Internet y telefonía ${mes}`, 289900, day(12), 'Colombia Telecomunicaciones S.A. E.S.P. (Movistar)');
    add('Aseo y cafetería', `Insumos de aseo ${mes}`, r.int(320000, 610000), day(r.int(3, 9)), 'Distribuidora de Aseo del Caribe Ltda.', 'efectivo');
    if (m % 2 === 0 || m === 1) add('Papelería y útiles', `Papelería y fotocopias ${mes}`, r.int(250000, 780000), day(r.int(5, 15)), 'Papelería y Miscelánea El Estudiante S.A.S.', r.pick(['efectivo', 'transferencia']));
    if (m % 3 === 0) add('Mantenimiento y reparaciones', `Mantenimiento de aires acondicionados (${mes})`, r.int(900000, 1600000), day(r.int(10, 25)), 'Rafael Enrique Tovar Meza (mantenimiento)');
    if ([1, 7].includes(m)) add('Tecnología y software', `Licencias y soporte de software académico — semestre ${m === 1 ? 1 : 2}`, 1850000, day(15), 'Apreu S.A.S.');
    if ([4, 9].includes(m)) add('Eventos institucionales', m === 4 ? 'Día del Idioma y Día del Niño' : 'Semana cultural y Día del Amor y la Amistad', r.int(700000, 1400000), day(r.int(20, 27)), 'Varios proveedores', 'efectivo');
    if (m === 3 || m === 8) add('Honorarios profesionales', `Revisoría fiscal — ${mes}`, 1200000, day(28), 'Contadores Asociados de Sucre S.A.S.');
  }
  let created = 0;
  for (const e of items) {
    if (have.has(e.receiptNo) || e.date > TODAY()) continue;
    await admin.post('/finance/expenses', { ...e, notes: 'Factura registrada en caja' });
    created++;
  }
  log(`gastos: +${created} (${items.length} planeados)`);
}

export { levelOf, cap };
