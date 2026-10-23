// Pasos: nómina y RR. HH., inventario, incidencias/certificados/notificaciones/WhatsApp,
// facturación electrónica (solo configuración), retiros, ajustes de fechas (SQL) y cierre contable.
import { CONFIG, MONTHS, addDays, cap, lastDayOfMonth, log, pool, rng, warn, withDb } from './core.mjs';
import { PASSWORDS } from './data.mjs';
import { YEAR } from './plan.mjs';
import { loadStaff } from './steps-setup.mjs';
import { chargesOf, loadFamilies } from './steps-finance.mjs';

const TODAY = () => CONFIG.today;
const unwrap = (res) => res?.period ?? res;
const listOf = (res) => (Array.isArray(res) ? res : res?.items ?? []);

// ---------------------------------------------------------------------------
export async function stepHr(ctx) {
  const { admin, api, school } = ctx;
  const r = rng(`${school.slug}:hr`);
  const { teachers, admins } = await loadStaff(ctx);
  const staff = [...teachers, ...admins].filter((p) => p.employeeId);
  const periods = await api.all(admin, `/payroll/periods?year=${YEAR}`);
  const firstMonth = school.size === 'full' ? 1 : 8;
  let paid = 0;
  for (let m = firstMonth; m <= 10; m++) {
    const startDate = `${YEAR}-${String(m).padStart(2, '0')}-01`;
    const endDate = lastDayOfMonth(YEAR, m);
    let period = periods.find((p) => p.startDate === startDate);
    if (!period) {
      period = unwrap(await admin.post('/payroll/periods', { name: `${cap(MONTHS[m - 1])} ${YEAR}`, startDate, endDate, paymentDate: endDate === `${YEAR}-10-31` ? `${YEAR}-10-30` : endDate, frequency: 'monthly' }));
    }
    if (['draft', 'open'].includes(period.status)) {
      // Novedades: horas extra, bonificaciones y libranzas en algunos meses.
      if ([4, 6, 9, 10].includes(m)) {
        const pick = r.shuffle(staff).slice(0, 3);
        for (const [i, p] of pick.entries()) {
          const novelty = [
            { type: 'overtime', amount: r.pick([85000, 120000, 160000]), description: 'Horas extra por jornada de matrículas/eventos' },
            { type: 'bonus_non_salary', amount: 150000, description: 'Bonificación por actividades institucionales' },
            { type: 'libranza', amount: 210000, description: 'Libranza Banco Davivienda' },
          ][i];
          await admin.post(`/payroll/periods/${period.id}/novelties`, { employeeId: p.employeeId, ...novelty });
        }
      }
      period = unwrap(await admin.post(`/payroll/periods/${period.id}/calculate`));
    }
    if (m === 10) continue; // octubre queda en cálculo
    if (period.status === 'calculated') period = unwrap(await admin.post(`/payroll/periods/${period.id}/approve`));
    if (period.status === 'approved') {
      await admin.post(`/payroll/periods/${period.id}/pay`);
      paid++;
    }
  }

  // Permisos y novedades de personal.
  const leaves = await api.all(admin, '/hr/leaves');
  const byName = (first) => staff.find((p) => p.first.startsWith(first)) ?? staff[r.int(0, staff.length - 1)];
  const wanted = school.size === 'full'
    ? [
        { who: byName('Edilberto'), leaveType: 'licencia_medica', startDate: `${YEAR}-03-09`, endDate: `${YEAR}-03-13`, reason: 'Incapacidad por cirugía ambulatoria (EPS).', decide: 'approve' },
        { who: byName('Karen'), leaveType: 'calamidad', startDate: `${YEAR}-05-18`, endDate: `${YEAR}-05-19`, reason: 'Calamidad doméstica: fallecimiento de familiar.', decide: 'approve' },
        { who: byName('Wilfrido'), leaveType: 'comision', startDate: `${YEAR}-08-20`, endDate: `${YEAR}-08-22`, reason: 'Acompañamiento a los Juegos Intercolegiados departamentales.', decide: 'approve' },
        { who: byName('Ramiro'), leaveType: 'licencia_medica', startDate: `${YEAR}-10-19`, endDate: `${YEAR}-10-23`, reason: 'Incapacidad médica por lumbalgia.', decide: 'approve' },
        { who: byName('Liliana'), leaveType: 'licencia_no_remunerada', startDate: `${YEAR}-09-07`, endDate: `${YEAR}-09-11`, reason: 'Viaje personal.', decide: 'reject' },
        { who: byName('Jennifer'), leaveType: 'otro', startDate: `${YEAR}-10-28`, endDate: `${YEAR}-10-28`, reason: 'Cita para trámite de visa.', decide: null },
        { who: byName('Diana'), leaveType: 'vacaciones', startDate: `${YEAR}-12-01`, endDate: `${YEAR}-12-15`, reason: 'Vacaciones pendientes del período anterior.', decide: null },
      ]
    : [
        { who: staff[0], leaveType: 'licencia_medica', startDate: `${YEAR}-09-14`, endDate: `${YEAR}-09-16`, reason: 'Incapacidad médica.', decide: 'approve' },
        { who: staff[1], leaveType: 'otro', startDate: `${YEAR}-10-29`, endDate: `${YEAR}-10-29`, reason: 'Diligencia personal.', decide: null },
      ];
  let leavesCreated = 0;
  for (const w of wanted) {
    if (!w.who) continue;
    if (leaves.some((l) => l.employeeId === w.who.employeeId && l.startDate === w.startDate)) continue;
    const created = await admin.post('/hr/leaves', { employeeId: w.who.employeeId, leaveType: w.leaveType, startDate: w.startDate, endDate: w.endDate, reason: w.reason });
    if (w.decide === 'approve') await admin.post(`/hr/leaves/${created.id}/approve`, { note: 'Aprobado por rectoría.' });
    if (w.decide === 'reject') await admin.post(`/hr/leaves/${created.id}/reject`, { reason: 'Coincide con la semana de evaluaciones del tercer período.' });
    leavesCreated++;
  }

  // Certificados laborales (un par) y stickers.
  const certificates = await withDb(ctx.dbName, (db) => db.query("SELECT count(*)::int n FROM hr_issued_documents"));
  let issued = 0;
  if (certificates.rows[0].n === 0) {
    for (const [p, includeSalary, addressee] of [
      [teachers[1], true, 'Banco Davivienda'],
      [admins[0], false, 'A quien pueda interesar'],
    ]) {
      if (!p?.employeeId) continue;
      await admin.post(`/hr/employees/${p.employeeId}/certificates/employment`, { includeSalary, addressee });
      issued++;
    }
  }
  const stickers = listOf(await admin.get('/stickers'));
  const wantStickers = [
    [teachers[0], 'Entregar informe de notas del tercer período', 'Plazo: viernes. Subir planillas a la plataforma.', 'yellow', 'urgent'],
    [teachers[3] ?? teachers[0], 'Reunión de padres de familia', 'Jueves 6:30 a. m. en el salón múltiple.', 'blue', 'normal'],
    [teachers[5] ?? teachers[1], 'Actualizar datos en Talento Humano', 'Traer certificado de afiliación a la EPS.', 'green', 'normal'],
    [admins[1] ?? admins[0], 'Revisar inventario de aseo', 'Hay ítems con stock bajo.', 'red', 'urgent'],
  ];
  let stickersCreated = 0;
  for (const [p, title, content, color, priority] of wantStickers) {
    if (!p?.employeeId || stickers.some((s) => s.title === title)) continue;
    await admin.post('/stickers', { employeeId: p.employeeId, title, content, color, priority });
    stickersCreated++;
  }
  log(`RR. HH.: nóminas pagadas +${paid}, permisos +${leavesCreated}, certificados laborales +${issued}, stickers +${stickersCreated}`);
}

// ---------------------------------------------------------------------------
const INVENTORY = {
  Uniformes: [
    ['Camisa de diario talla 8', 'UNI-001', 'und', 32000, 45000, 10, 40, -38],
    ['Camisa de diario talla 12', 'UNI-002', 'und', 34000, 48000, 10, 35, -20],
    ['Camisa de diario talla 16', 'UNI-003', 'und', 36000, 50000, 8, 30, -12],
    ['Falda de diario talla 10', 'UNI-004', 'und', 38000, 55000, 8, 25, -25],
    ['Pantalón de diario talla 12', 'UNI-005', 'und', 40000, 58000, 8, 25, -9],
    ['Sudadera de educación física T10', 'UNI-006', 'und', 52000, 70000, 6, 20, -16],
    ['Camiseta de educación física T12', 'UNI-007', 'und', 22000, 32000, 10, 30, -14],
    ['Medias blancas (par)', 'UNI-008', 'par', 5000, 8000, 20, 60, -22],
    ['Corbatín institucional', 'UNI-009', 'und', 6000, 10000, 10, 30, -27],
    ['Escudo bordado', 'UNI-010', 'und', 3500, 6000, 15, 50, -10],
  ],
  Papelería: [
    ['Resma papel carta 75 g', 'PAP-002', 'resma', 18500, 0, 10, 40, -31],
    ['Marcador borrable negro', 'PAP-003', 'und', 3200, 0, 24, 96, -60],
    ['Marcador borrable rojo', 'PAP-004', 'und', 3200, 0, 12, 48, -44],
    ['Borrador de tablero', 'PAP-005', 'und', 4500, 0, 6, 20, -8],
    ['Cartulina blanca pliego', 'PAP-006', 'pliego', 900, 0, 50, 200, -120],
    ['Tóner impresora HP 85A', 'PAP-007', 'und', 145000, 0, 2, 4, -4],
    ['Cinta pegante ancha', 'PAP-008', 'rollo', 4800, 0, 10, 30, -12],
    ['Carpeta legajadora', 'PAP-009', 'und', 1500, 0, 30, 100, -35],
    ['Libro de actas 100 folios', 'PAP-010', 'und', 15000, 0, 2, 6, -1],
    ['Tiza blanca (caja x 12)', 'PAP-011', 'caja', 3500, 0, 10, 15, -15],
  ],
  Aseo: [
    ['Detergente en polvo 3 kg', 'ASE-001', 'bolsa', 28000, 0, 4, 12, -10],
    ['Hipoclorito 3,8 L', 'ASE-002', 'galón', 14500, 0, 6, 20, -15],
    ['Papel higiénico institucional', 'ASE-003', 'rollo', 9800, 0, 24, 96, -80],
    ['Jabón líquido de manos 3,8 L', 'ASE-004', 'galón', 21000, 0, 4, 10, -7],
    ['Escoba', 'ASE-005', 'und', 9500, 0, 4, 10, -3],
    ['Trapero', 'ASE-006', 'und', 11000, 0, 4, 10, -6],
    ['Bolsas de basura x 10', 'ASE-007', 'paquete', 6500, 0, 10, 30, -30],
    ['Ambientador 500 ml', 'ASE-008', 'und', 8900, 0, 6, 12, -5],
    ['Guantes de caucho (par)', 'ASE-009', 'par', 5200, 0, 6, 12, -11],
    ['Desinfectante multiusos 3,8 L', 'ASE-010', 'galón', 17500, 0, 4, 10, -4],
  ],
  Tecnología: [
    ['Videobeam Epson', 'TEC-001', 'und', 2350000, 0, 1, 4, 0],
    ['Portátil Lenovo IdeaPad', 'TEC-002', 'und', 2190000, 0, 2, 12, -1],
    ['Mouse USB', 'TEC-003', 'und', 18000, 0, 5, 20, -17],
    ['Teclado USB', 'TEC-004', 'und', 32000, 0, 5, 15, -4],
    ['Cable HDMI 3 m', 'TEC-005', 'und', 22000, 0, 4, 10, -10],
    ['Parlante bluetooth', 'TEC-006', 'und', 145000, 0, 1, 3, -1],
    ['Router Wi-Fi', 'TEC-007', 'und', 189000, 0, 1, 2, 0],
    ['Tablet Samsung Galaxy Tab A9', 'TEC-008', 'und', 790000, 0, 2, 10, -2],
    ['Memoria USB 64 GB', 'TEC-009', 'und', 28000, 0, 5, 15, -11],
  ],
};

export async function stepInventory(ctx) {
  const { admin, api, school } = ctx;
  const r = rng(`${school.slug}:inventory`);
  const cats = listOf(await admin.get('/inventory/categories'));
  const catId = new Map(cats.map((c) => [c.name, c.id]));
  for (const name of Object.keys(INVENTORY)) {
    if (!catId.has(name)) catId.set(name, (await admin.post('/inventory/categories', { name })).id);
  }
  const items = await api.all(admin, '/inventory/items?includeInactive=true');
  const bySku = new Map(items.map((i) => [i.sku, i]));
  // El ítem PAP-001 (Resma papel) de la línea base pasa a la categoría Papelería.
  const base = bySku.get('PAP-001');
  if (base && !base.categoryId) {
    await admin.patch(`/inventory/items/${base.id}`, { name: base.name, sku: base.sku, categoryId: catId.get('Papelería'), unit: base.unit, unitCost: base.unitCost, salePrice: base.salePrice, minStock: base.minStock, location: 'Bodega principal' });
  }
  const scale = school.size === 'full' ? 1 : 0.5;
  let created = 0;
  let movements = 0;
  for (const [category, list] of Object.entries(INVENTORY)) {
    const subset = school.size === 'full' ? list : list.filter((_, i) => i % 2 === 0);
    for (const [name, sku, unit, unitCost, salePrice, minStock, initial, out] of subset) {
      if (bySku.has(sku)) continue;
      const initialStock = Math.max(1, Math.round(initial * scale));
      const item = await admin.post('/inventory/items', { name, sku, categoryId: catId.get(category), unit, unitCost, salePrice, minStock, location: category === 'Tecnología' ? 'Sala de sistemas' : 'Bodega principal', initialStock });
      created++;
      // Salidas en 2–4 entregas; si `out` deja el stock en cero, queda agotado.
      let remaining = Math.min(initialStock, Math.round(-out * scale));
      const chunks = r.int(2, 4);
      for (let i = 0; i < chunks && remaining > 0; i++) {
        const qty = i === chunks - 1 ? remaining : Math.max(1, Math.round(remaining / (chunks - i)));
        remaining -= qty;
        await admin.post(`/inventory/items/${item.id}/movements`, { type: 'salida', quantity: qty, reason: category === 'Uniformes' ? 'Venta a padres de familia' : r.pick(['Entrega a docentes', 'Entrega a coordinación', 'Consumo del mes', 'Entrega a servicios generales']) });
        movements++;
      }
      if (r.chance(0.3) && -out < initial) {
        await admin.post(`/inventory/items/${item.id}/movements`, { type: 'entrada', quantity: r.int(5, 20), unitCost: Math.round(unitCost * 1.05), reason: 'Compra a proveedor' });
        movements++;
      }
    }
  }
  const kpis = await admin.get('/inventory/kpis');
  log(`inventario: ítems +${created}, movimientos +${movements}; KPIs ${JSON.stringify(kpis).slice(0, 160)}`);
}

// ---------------------------------------------------------------------------
export async function stepCommunications(ctx) {
  const { admin, api, school } = ctx;
  const r = rng(`${school.slug}:comms`);
  const families = await loadFamilies(ctx);
  const kids = families.flatMap((f) => f.children.filter((c) => c.id && !c.baseline).map((c) => ({ ...c, family: f })));
  const pickKid = (i) => kids[(i * 7) % kids.length];

  // Incidencias.
  const incidents = await api.all(admin, '/incidents');
  const want = [
    ['incapacidad', 'medium', 'Incapacidad médica por varicela', 'Adjunta incapacidad de la EPS por 5 días.', 'approved'],
    ['salida_clase', 'low', 'Salida anticipada por cita odontológica', 'La acudiente recoge al estudiante a las 10:00 a. m.', 'approved'],
    ['firma_libro', 'high', 'Firma de libro de convivencia por agresión verbal', 'Discusión con un compañero durante el descanso.', 'pending'],
    ['izada_bandera', 'low', 'Reconocimiento en izada de bandera', 'Mejor promedio del período en su salón.', 'approved'],
    ['ajuste_pago', 'medium', 'Solicitud de acuerdo de pago', 'La familia solicita diferir la deuda de agosto a octubre en dos cuotas.', 'in_review'],
    ['otra', 'medium', 'Pérdida de calculadora en el aula', 'El estudiante reporta pérdida de una calculadora científica.', 'rejected'],
    ['incapacidad', 'medium', 'Incapacidad por dengue', 'Hospitalizado 3 días; se solicitan talleres de nivelación.', 'pending'],
    ['firma_libro', 'critical', 'Porte de objeto cortopunzante', 'Se citó al acudiente y se activó la ruta de convivencia escolar.', 'in_review'],
    ['salida_clase', 'low', 'Salida para presentación en Juegos Intercolegiados', 'Delegación deportiva de fútbol sala.', 'closed'],
    ['otra', 'low', 'Solicitud de cambio de jornada de refuerzo', 'El acudiente pide refuerzo de matemáticas en la tarde.', 'pending'],
    ['baja_estudiante', 'high', 'Posible retiro por traslado de ciudad', 'La familia se traslada a Barranquilla en noviembre.', 'pending'],
    ['incapacidad', 'low', 'Incapacidad por gripe', 'Dos días de reposo.', 'approved'],
  ].slice(0, school.size === 'full' ? 12 : 5);
  let createdIncidents = 0;
  for (const [i, [type, priority, title, description, status]] of want.entries()) {
    const kid = pickKid(i + 1);
    const fullTitle = `${title} — ${kid.firstName} ${kid.lastName.split(' ')[0]}`;
    if (incidents.some((x) => x.title === fullTitle)) continue;
    const created = await admin.post('/incidents', { type, priority, title: fullTitle, description, studentId: kid.id });
    if (status !== 'pending') {
      if (['approved', 'rejected', 'closed'].includes(status) && status !== 'closed') await admin.post(`/incidents/${created.id}/review`, { action: status, notes: status === 'approved' ? 'Revisado por coordinación.' : 'No procede: no hay evidencia suficiente.' });
      if (status === 'in_review') await admin.post(`/incidents/${created.id}/review`, { action: 'in_review', notes: 'Se cita al acudiente.' });
      if (status === 'closed') {
        await admin.post(`/incidents/${created.id}/review`, { action: 'approved', notes: 'Autorizado.' });
        await admin.post(`/incidents/${created.id}/review`, { action: 'closed', notes: 'Cerrado.' }, { allow: [409, 422] });
      }
    }
    createdIncidents++;
  }

  // Incidencia reportada desde el portal de un acudiente.
  const portalFamily = families.find((f) => f.portal && f.guardian?.email && f.children[0]?.id && !f.children[0].baseline);
  let portalIncidents = 0;
  if (portalFamily) {
    const kid = portalFamily.children[0];
    const title = `Inasistencia por viaje familiar — ${kid.firstName}`;
    if (!incidents.some((x) => x.title === title)) {
      try {
        const token = await api.login(portalFamily.guardian.email, PASSWORDS.portal);
        await api.as(token).post(`/portal/students/${kid.id}/incidents`, { type: 'otra', title, description: 'Informo que mi hijo(a) no asistirá el viernes por viaje familiar.' });
        portalIncidents++;
      } catch (e) {
        warn(`incidencia de portal: ${e.message}`);
      }
    }
  }

  // Certificados de estudio: solicitudes pendientes y aprobadas; dos pagados en caja (emisión automática).
  let certRequested = 0;
  let certApproved = 0;
  const certKids = kids.filter((_, i) => i % 11 === 3).slice(0, school.size === 'full' ? 7 : 3);
  for (const [i, kid] of certKids.entries()) {
    const list = listOf(await admin.get(`/students/${kid.id}/certificates`));
    if (list.length) continue;
    const cert = await admin.post(`/students/${kid.id}/certificate-requests`, { type: 'certificado_estudiantil', notes: r.pick(['Para trámite de subsidio de Familias en Acción', 'Para la Caja de Compensación', 'Para trámite de beca', 'Para presentar en la EPS']) });
    certRequested++;
    if (i % 2 === 0) {
      await admin.post(`/certificates/${cert.id}/approve`);
      certApproved++;
    }
  }
  const concepts = listOf(await admin.get('/finance/concepts'));
  const cer = concepts.find((c) => c.name === 'Certificado de estudios');
  let paidCerts = 0;
  for (const kid of kids.filter((_, i) => i % 13 === 5).slice(0, 2)) {
    const charges = chargesOf(await admin.get(`/finance/students/${kid.id}/charges`));
    if (charges.some((c) => c.conceptId === cer.id)) continue;
    const charge = await admin.post('/finance/charges', { studentId: kid.id, conceptId: cer.id, period: `${YEAR}-10`, dueDate: addDays(TODAY(), 5) });
    const chargeId = charge.id ?? charge.charge?.id;
    await admin.post('/finance/payments', { studentId: kid.id, amount: cer.amount, method: 'efectivo', chargeIds: [chargeId], notes: 'Pago de certificado en ventanilla' });
    paidCerts++;
  }

  // Notificaciones internas (siempre incluyen al director, para detectar repetidos).
  const users = await api.all(admin, '/users');
  const director = users.find((u) => u.email.toLowerCase() === school.director.email.toLowerCase());
  const byRole = (role) => users.filter((u) => u.role === role && u.isActive).map((u) => u.id);
  const mine = listOf(await admin.get('/notifications?limit=100'));
  const notifications = [
    [[director.id, ...byRole('finance')], 'Cartera vencida en aumento', 'Hay estudiantes con 2 o más pensiones vencidas. Revise el reporte de cartera por edades.', 'warning'],
    [[director.id, ...byRole('hr')], 'Nómina de octubre en cálculo', 'La nómina de octubre está calculada y pendiente de aprobación.', 'info'],
    [[director.id, ...byRole('teacher')], 'Cierre del tercer período', 'El tercer período fue cerrado. Las planillas del cuarto período están habilitadas.', 'success'],
    [[director.id], 'Inventario con stock bajo', 'Varios ítems de aseo y papelería están por debajo del mínimo.', 'warning'],
    [[director.id, ...byRole('finance')], 'Resolución de facturación en pruebas', 'La resolución de numeración configurada es de habilitación (ambiente de pruebas).', 'info'],
  ];
  let sent = 0;
  for (const [userIds, title, message, type] of notifications) {
    if (mine.some((n) => n.title === title)) continue;
    await admin.post('/notifications', { userIds: [...new Set(userIds)], title, message, type });
    sent++;
  }

  // Plantillas de WhatsApp.
  const templates = listOf(await admin.get('/communications/whatsapp/templates'));
  const wantTemplates = [
    ['cobro_mensual', 'utility', 'Hola {{1}}, le recordamos que la pensión de {{2}} correspondiente a {{3}} por valor de {{4}} vence el {{5}}. Gracias por su puntualidad.', ['acudiente', 'estudiante', 'mes', 'valor', 'fecha']],
    ['pago_confirmado', 'utility', 'Hola {{1}}, recibimos su pago por {{2}} (recibo {{3}}). ¡Gracias!', ['acudiente', 'valor', 'recibo']],
    ['recordatorio_vencido', 'utility', 'Hola {{1}}, el estado de cuenta de {{2}} registra un saldo vencido de {{3}}. Comuníquese con tesorería.', ['acudiente', 'estudiante', 'valor']],
    ['citacion_acudiente', 'utility', 'Estimado(a) {{1}}, lo citamos el {{2}} a las {{3}} para tratar asuntos de {{4}}.', ['acudiente', 'fecha', 'hora', 'estudiante']],
    ['evento_institucional', 'marketing', '{{1}}: los invitamos a {{2}} el {{3}}. ¡Los esperamos!', ['colegio', 'evento', 'fecha']],
  ];
  let templatesCreated = 0;
  for (const [name, category, body, variables] of wantTemplates) {
    if (templates.some((t) => t.name === name)) continue;
    await admin.post('/communications/whatsapp/templates', { name, language: 'es', category, body, variables, status: name === 'evento_institucional' ? 'pending' : 'active', headerType: 'none', footerText: school.name.slice(0, 60) });
    templatesCreated++;
  }
  log(`comunicaciones: incidencias +${createdIncidents} (+${portalIncidents} desde portal), certificados solicitados +${certRequested} (aprobados ${certApproved}, pagados en caja ${paidCerts}), notificaciones +${sent}, plantillas WhatsApp +${templatesCreated}`);
}

// ---------------------------------------------------------------------------
export async function stepEInvoicing(ctx) {
  const { admin, school } = ctx;
  await admin.put('/e-invoicing/config', {
    businessName: school.name,
    nit: school.nit,
    personType: '1',
    taxResponsibilities: 'R-99-PN',
    vatRegime: '49',
    address: school.address,
    cityCode: school.cityDane,
    postalCode: school.postalCode,
    contactName: 'Tesorería',
    phone: school.phone,
    email: `facturacion@${school.domain}`,
    environment: '2',
    autoInvoiceOnPayment: false,
  });
  const resolutions = listOf(await admin.get('/e-invoicing/resolutions'));
  let created = 0;
  if (!resolutions.some((x) => x.prefix === 'SETP')) {
    const res = await admin.post('/e-invoicing/resolutions', {
      docType: 'fv',
      prefix: 'SETP',
      rangeFrom: 990000000,
      rangeTo: 995000000,
      resolutionNumber: '18760000001',
      validFrom: '2019-01-19',
      validTo: '2030-01-19',
      technicalKey: 'fc8eac422eba16e22ffd8c6f94b3f40a6e38162c',
      environment: '2',
    }, { allow: [502] });
    if (res?.__status) {
      // La API cifra la clave técnica con E_INVOICING_SECRET_KEY y una resolución FV sin clave técnica es
      // inválida: sin esa variable en apreu-api no se puede registrar. Reintentar con --only e-invoicing.
      warn(`resolución SETP no registrada: ${res.message}`);
      log('facturación electrónica: emisor configurado (pruebas); resolución pendiente (falta E_INVOICING_SECRET_KEY en la API)');
      return;
    }
    created++;
  }
  log(`facturación electrónica: emisor configurado (pruebas), resoluciones +${created}`);
}

// ---------------------------------------------------------------------------
/** Dos retiros (familias morosas): retirados a fin de septiembre, se anulan sus cobros posteriores. */
export async function stepWithdrawals(ctx) {
  const { admin } = ctx;
  const families = await loadFamilies(ctx);
  const targets = families.filter((f) => f.children[0]?.withdrawAt);
  let done = 0;
  let cancelled = 0;
  for (const [i, f] of targets.entries()) {
    const kid = f.children[0];
    const student = await admin.get(`/students/${kid.id}`);
    if ((student.status ?? student.student?.status) === 'withdrawn') continue;
    await admin.post(`/students/${kid.id}/status`, { status: 'withdrawn', reason: i === 0 ? 'Traslado de la familia a Barranquilla (30/09/2026).' : 'Retiro voluntario por dificultades económicas (30/09/2026).' });
    done++;
    const charges = chargesOf(await admin.get(`/finance/students/${kid.id}/charges`));
    for (const ch of charges.filter((c) => c.period >= `${YEAR}-10` && c.status === 'pending' && c.paidAmount === 0)) {
      await admin.post(`/finance/charges/${ch.id}/cancel`, {}, { allow: [409, 422] });
      cancelled++;
    }
  }
  log(`retiros: estudiantes retirados +${done}, cobros anulados ${cancelled}`);
}

// ---------------------------------------------------------------------------
/**
 * SQL #2 — fechas en el pasado que la API fija con "ahora". Solo mueve marcas de tiempo hacia
 * atrás (idempotente): nómina (pago, gasto y asiento contable), creación de pagos y cobros,
 * cierres de períodos y boletines, hora de la asistencia, incidencias, certificados, movimientos
 * de inventario y solicitudes de permiso.
 */
export async function stepBackdate(ctx) {
  const today = TODAY();
  const counts = await withDb(ctx.dbName, async (db) => {
    const run = async (label, sql, params = []) => [label, (await db.query(sql, params)).rowCount];
    await db.query('BEGIN');
    const out = [];
    out.push(
      await run('nómina (fechas de cálculo/aprobación/pago)', `
        UPDATE payroll_periods SET
          calculated_at = (period_end - 3) + time '10:30',
          approved_at  = (period_end - 2) + time '16:00',
          paid_at      = COALESCE(payment_date, period_end) + time '15:00'
        WHERE status = 'paid' AND paid_at::date > COALESCE(payment_date, period_end)`),
    );
    out.push(
      await run('nómina (calculada en curso)', `
        UPDATE payroll_periods SET calculated_at = $1::date - 1 + time '11:00'
        WHERE status = 'calculated' AND calculated_at::date = $1::date`, [today]),
    );
    out.push(
      await run('gasto de nómina', `
        UPDATE expenses e SET expense_date = COALESCE(p.payment_date, p.period_end)
        FROM payroll_periods p
        WHERE e.receipt_no = 'NOMINA-' || p.id AND p.status = 'paid' AND e.expense_date > COALESCE(p.payment_date, p.period_end)`),
    );
    out.push(
      await run('asiento de nómina (fecha y período contable)', `
        UPDATE accounting_journal_entries j SET
          entry_date = COALESCE(p.payment_date, p.period_end),
          period_id  = ap.id,
          posted_at  = COALESCE(p.payment_date, p.period_end) + time '15:05'
        FROM payroll_periods p
        JOIN LATERAL (SELECT id FROM accounting_periods a
                       WHERE COALESCE(p.payment_date, p.period_end) BETWEEN a.start_date AND a.end_date
                       ORDER BY a.start_date DESC LIMIT 1) ap ON true
        WHERE j.source_type = 'hr.payroll-period' AND j.source_id = p.id::text
          AND j.entry_date > COALESCE(p.payment_date, p.period_end)`),
    );
    out.push(
      await run('pagos (created_at = fecha de pago)', `
        UPDATE payments SET created_at = payment_date + make_interval(mins => 420 + (id * 37) % 600)
        WHERE created_at::date > payment_date::date`),
    );
    out.push(
      await run('asientos de recibos (posted_at)', `
        UPDATE accounting_journal_entries j SET posted_at = j.entry_date + time '17:00', created_at = j.entry_date + time '17:00'
        WHERE j.source_type IN ('finance.payment', 'finance.expense') AND j.posted_at::date > j.entry_date`),
    );
    out.push(
      await run('cobros (created_at = inicio del mes cobrado)', `
        UPDATE student_charges SET created_at = LEAST(to_date(billing_period || '-01', 'YYYY-MM-DD') - 5, due_date - 20) + time '08:00'
        WHERE billing_period ~ '^[0-9]{4}-[0-9]{2}$'
          AND created_at::date > LEAST(to_date(billing_period || '-01', 'YYYY-MM-DD') - 5, due_date - 20)
          AND to_date(billing_period || '-01', 'YYYY-MM-DD') <= $1::date`, [today]),
    );
    out.push(
      await run('gastos (created_at)', `
        UPDATE expenses SET created_at = expense_date + time '11:00' WHERE created_at::date > expense_date`),
    );
    out.push(
      await run('períodos académicos cerrados', `
        UPDATE academic_periods SET closed_at = end_date + 3 + time '18:00'
        WHERE status IN ('closed', 'bulletins_generated') AND closed_at::date > end_date + 3 AND end_date < $1::date`, [today]),
    );
    out.push(
      await run('boletines (fecha de generación)', `
        UPDATE student_bulletins b SET generated_at = p.end_date + 6 + time '09:00'
        FROM academic_periods p WHERE b.period_id = p.id AND b.generated_at::date > p.end_date + 6`),
    );
    out.push(
      await run('boletines legado (report_cards)', `
        UPDATE report_cards rc SET generated_at = p.end_date + 6 + time '09:00'
        FROM academic_periods p
        WHERE rc.academic_year = p.academic_year AND rc.generated_at::date > p.end_date + 6
          AND p.name = 'Periodo ' || rc.period`),
    );
    out.push(
      await run('asistencia (hora de clase 6:30–9:00)', `
        UPDATE attendance_records SET attendance_time = time '06:30' + make_interval(mins => (id * 13) % 150),
               created_at = attendance_date + time '06:30' + make_interval(mins => (id * 13) % 150)
        WHERE source = 'manual' AND created_at::date > attendance_date`),
    );
    out.push(
      await run('incidencias (últimas 6 semanas)', `
        UPDATE incidents SET created_at = $1::date - ((id * 5) % 40) + time '08:00' + make_interval(mins => (id * 41) % 480),
               updated_at = $1::date - ((id * 5) % 40) / 2 + time '14:00'
        WHERE created_at::date = $1::date AND status <> 'pending'`, [today]),
    );
    out.push(
      await run('incidencias pendientes (últimos días)', `
        UPDATE incidents SET created_at = $1::date - (id % 6) + time '09:00' + make_interval(mins => (id * 41) % 300), updated_at = $1::date - (id % 6) + time '09:00'
        WHERE created_at::date = $1::date AND status = 'pending' AND id % 6 <> 0`, [today]),
    );
    out.push(
      await run('certificados de estudio', `
        UPDATE certificates SET created_at = $1::date - (id % 20) - 1 + time '10:00'
        WHERE created_at::date = $1::date AND payment_id IS NULL`, [today]),
    );
    out.push(
      await run('movimientos de inventario', `
        UPDATE inventory_movements SET created_at = date '${YEAR}-01-20' + ((id * 17) % 270)::int + time '10:00'
        WHERE created_at::date = $1::date AND date '${YEAR}-01-20' + ((id * 17) % 270)::int < $1::date`, [today]),
    );
    out.push(
      await run('solicitudes de permiso', `
        UPDATE employee_leaves SET created_at = LEAST(start_date - 7, $1::date) + time '09:00'
        WHERE created_at::date > LEAST(start_date - 7, $1::date)`, [today]),
    );
    await db.query('COMMIT');
    return out;
  });
  log(`fechas (SQL): ${counts.map(([l, n]) => `${l}=${n}`).join('; ')}`);
}

// ---------------------------------------------------------------------------
/** Cierra los períodos contables de enero a agosto (septiembre y octubre quedan abiertos). */
export async function stepCloseAccounting(ctx) {
  const { admin } = ctx;
  const periods = listOf(await admin.get('/accounting/periods'));
  let closed = 0;
  for (const p of periods) {
    if (p.status !== 'open' || p.endDate > `${YEAR}-08-31` || p.startDate < `${YEAR}-01-01`) continue;
    await admin.post(`/accounting/periods/${p.id}/close`);
    closed++;
  }
  log(`contabilidad: períodos cerrados +${closed}`);
}
