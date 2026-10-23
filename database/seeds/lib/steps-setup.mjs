// Pasos: institución, contabilidad base, estructura académica y personal.
import { CONFIG, MONTHS, cap, lastDayOfMonth, log, rng, setKnownPasswords, warn, withDb } from './core.mjs';
import { PASSWORDS } from './data.mjs';
import { YEAR, planClassrooms, planEmployeeData, planStaff, staffEmail, subjectsFor } from './plan.mjs';

// ---------------------------------------------------------------------------
export async function stepInstitution(ctx) {
  const { admin, school } = ctx;
  await admin.put('/institution', {
    name: school.name,
    nit: school.nit,
    documentType: 'NIT',
    personType: 'juridica',
    address: school.address,
    phone: school.phone,
    email: school.email,
    city: school.city,
    cityDaneCode: school.cityDane,
    department: school.department,
    departmentDaneCode: school.departmentDane,
    postalCode: school.postalCode,
    taxResponsibilities: ['R-99-PN'],
    daneCode: school.daneCode,
    resolutionNumber: school.resolution,
    rectorName: school.rector,
    billingContactName: 'Tesorería',
    billingContactPhone: school.phone,
    billingContactEmail: `tesoreria@${school.domain}`,
  });
  const put = (section, values) => admin.put(`/institution/settings/${section}`, { values });
  await put('branding', {
    color_primary: school.colors.primary,
    color_header_bg: school.colors.headerBg,
    color_header_bar: school.colors.headerBar,
    logo_size: 44,
  });
  await put('academic', {
    academic_year: YEAR,
    costs_matricula: ctx.prices.matricula.secundaria,
    costs_pension: ctx.prices.pension.secundaria,
    costs_certificados: 15000,
    costs_libros: 120000,
  });
  // `payment_methods` no se fija a propósito: vacío = todos los métodos (incluido PSE, que la
  // pantalla de configuración no permite habilitar; ver README).
  await put('payments', {
    nequi_number: '3004567890',
    daviplata_number: '3214567890',
    breb_number: `@${school.slug.replace(/-/g, '')}`,
    bank_name: 'Bancolombia',
    bank_account: '645-123456-78',
    bank_account_type: 'corriente',
    bank_holder: school.name,
  });
  log(`institución: ${school.name}`);
}

// ---------------------------------------------------------------------------
export async function stepAccountingSetup(ctx) {
  const { admin } = ctx;
  const defaults = await admin.post('/accounting/posting-rules/defaults');
  log(`contabilidad: PUC +${defaults.accountsInserted} cuentas, reglas creadas ${defaults.created.length}, conservadas ${defaults.kept.length}`);

  const existing = await admin.get('/accounting/periods');
  const periods = Array.isArray(existing) ? existing : existing.items;
  let created = 0;
  for (let m = 1; m <= 12; m++) {
    const start = `${YEAR}-${String(m).padStart(2, '0')}-01`;
    const end = lastDayOfMonth(YEAR, m);
    if (periods.some((p) => p.startDate <= end && p.endDate >= start)) continue;
    await admin.post('/accounting/periods', { name: `${cap(MONTHS[m - 1])} ${YEAR}`, startDate: start, endDate: end });
    created++;
  }

  const parties = await ctx.api.all(admin, '/accounting/third-parties');
  const want = [
    ['NIT', '901380949', '1', 'Afinia — Caribe Mar de la Costa S.A.S. E.S.P.', 'Calle 22 # 17-34', 'Sincelejo'],
    ['NIT', '800222802', '4', 'Aguas de La Sabana S.A. E.S.P.', 'Carrera 25 # 23-49', 'Sincelejo'],
    ['NIT', '830122566', '1', 'Colombia Telecomunicaciones S.A. E.S.P. (Movistar)', 'Transversal 60 # 114A-55', 'Bogotá'],
    ['NIT', '900765432', '7', 'Papelería y Miscelánea El Estudiante S.A.S.', 'Calle 21 # 20-15', 'Sincelejo'],
    ['NIT', '901234987', '3', 'Confecciones La Sabana S.A.S.', 'Carrera 20 # 25-60', 'Sincelejo'],
    ['NIT', '900345876', '2', 'Distribuidora de Aseo del Caribe Ltda.', 'Calle 32 # 14-08', 'Sincelejo'],
    ['NIT', '860034313', '7', 'Banco Davivienda S.A.', 'Avenida El Dorado # 68C-61', 'Bogotá'],
    ['CC', '92515678', null, 'Rafael Enrique Tovar Meza (mantenimiento)', 'Barrio Majagual', 'Sincelejo'],
    ['CC', '64578901', null, 'Ana Lucía Herazo Benítez (cafetería)', 'Barrio La Ford', 'Sincelejo'],
  ];
  let partiesCreated = 0;
  for (const [documentType, documentNumber, , name, address, city] of want) {
    if (parties.some((p) => p.documentNumber === documentNumber)) continue;
    await admin.post('/accounting/third-parties', {
      documentType,
      documentNumber,
      ...(documentType === 'NIT' ? { dv: nitDv(documentNumber) } : {}),
      name,
      address,
      city,
      phone: '6052800000',
      email: `contacto@${name.toLowerCase().replace(/[^a-z]/g, '').slice(0, 14)}.com.co`,
    });
    partiesCreated++;
  }
  log(`contabilidad: períodos +${created}, terceros +${partiesCreated}`);
}

/** Dígito de verificación DIAN de un NIT. */
export function nitDv(nit) {
  const weights = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const digits = String(nit).split('').reverse();
  const sum = digits.reduce((acc, d, i) => acc + Number(d) * weights[i], 0) % 11;
  return String(sum > 1 ? 11 - sum : sum);
}

// ---------------------------------------------------------------------------
export async function stepStructure(ctx) {
  const { admin, school } = ctx;
  const rooms = planClassrooms(school);
  const grades = await admin.get('/academic/grades');
  const gradeByName = new Map(grades.map((g) => [g.name, g]));
  let gradesCreated = 0;
  let subjectsCreated = 0;
  for (const room of rooms) {
    if (!gradeByName.has(room.grade)) {
      const g = await admin.post('/academic/grades', { name: room.grade, level: room.level });
      gradeByName.set(room.grade, g);
      gradesCreated++;
    }
  }
  const subjectsByGrade = new Map();
  for (const [name, grade] of gradeByName) {
    const level = rooms.find((r) => r.grade === name)?.level;
    if (!level) continue;
    const existing = await admin.get(`/academic/grades/${grade.id}/subjects`);
    const list = Array.isArray(existing) ? existing : existing.subjects ?? existing.items;
    for (const s of subjectsFor(level)) {
      if (list.some((x) => x.name === s.name)) continue;
      const created = await admin.post(`/academic/grades/${grade.id}/subjects`, { name: s.name, code: s.code, area: s.area, hoursPerWeek: s.hours });
      list.push(created);
      subjectsCreated++;
    }
    subjectsByGrade.set(name, list);
  }
  const classrooms = await admin.get(`/academic/classrooms?year=${YEAR}`);
  const roomList = Array.isArray(classrooms) ? classrooms : classrooms.items;
  let roomsCreated = 0;
  for (const room of rooms) {
    if (roomList.some((c) => c.name === room.name)) continue;
    const created = await admin.post('/academic/classrooms', { gradeId: gradeByName.get(room.grade).id, name: room.name, capacity: room.capacity, academicYear: YEAR });
    roomList.push(created);
    roomsCreated++;
  }
  ctx.structure = {
    rooms: rooms.map((r) => ({ ...r, id: roomList.find((c) => c.name === r.name).id, gradeId: gradeByName.get(r.grade).id })),
    gradeByName,
    subjectsByGrade,
  };
  log(`estructura: grados +${gradesCreated}, materias +${subjectsCreated}, salones +${roomsCreated} (total ${rooms.length})`);
}

export async function loadStructure(ctx) {
  if (ctx.structure) return ctx.structure;
  const { admin, school } = ctx;
  const rooms = planClassrooms(school);
  const grades = await admin.get('/academic/grades');
  const gradeByName = new Map(grades.map((g) => [g.name, g]));
  const subjectsByGrade = new Map();
  for (const [name, grade] of gradeByName) {
    const s = await admin.get(`/academic/grades/${grade.id}/subjects`);
    subjectsByGrade.set(name, Array.isArray(s) ? s : s.subjects ?? s.items);
  }
  const classrooms = await admin.get(`/academic/classrooms?year=${YEAR}`);
  const roomList = Array.isArray(classrooms) ? classrooms : classrooms.items;
  ctx.structure = {
    rooms: rooms
      .map((r) => ({ ...r, id: roomList.find((c) => c.name === r.name)?.id, gradeId: gradeByName.get(r.grade)?.id }))
      .filter((r) => r.id),
    gradeByName,
    subjectsByGrade,
  };
  return ctx.structure;
}

// ---------------------------------------------------------------------------
export async function stepStaff(ctx) {
  const { admin, school, api } = ctx;
  const r = rng(`${school.slug}:employees`);
  const { teachers, admins } = planStaff(school);
  const users = await api.all(admin, '/users');
  const employees = await api.all(admin, '/hr/employees');

  // Cuentas de finanzas / RR. HH. primero (el empleado se vincula por correo y conserva el rol).
  for (const p of admins.filter((a) => a.role)) {
    const email = staffEmail(school, p);
    if (users.some((u) => u.email.toLowerCase() === email)) continue;
    await admin.post('/users', { name: `${p.first} ${p.last}`, email, role: p.role });
  }

  const created = [];
  const byEmail = new Map(employees.map((e) => [(e.email ?? '').toLowerCase(), e]));
  for (const p of [...teachers, ...admins]) {
    if (p.existing) {
      const found = employees.find((e) => e.fullName === `${p.first} ${p.last}`);
      p.employeeId = found?.id;
      p.email = found?.email ?? null;
      continue;
    }
    const data = planEmployeeData(school, p, r);
    p.email = data.email;
    const found = byEmail.get(data.email.toLowerCase());
    if (found) {
      p.employeeId = found.id;
      continue;
    }
    const res = await admin.post('/hr/employees', data);
    p.employeeId = res.employee?.id ?? res.id;
    created.push(p);
  }
  const emails = [...teachers, ...admins].map((p) => p.email).filter(Boolean);
  const updated = await setKnownPasswords(ctx.dbName, emails, PASSWORDS.staff);
  ctx.staff = { teachers, admins };
  log(`personal: empleados +${created.length} (docentes ${teachers.length}, administrativos ${admins.length}); contraseñas fijadas ${updated}`);

  // Novedades de estado: un docente en licencia no; un auxiliar inactivo no. (Se mantienen activos.)
  await stepAssignments(ctx);
}

/** Carga académica y directores de grupo. */
async function stepAssignments(ctx) {
  const { admin, school } = ctx;
  const { rooms, subjectsByGrade } = await loadStructure(ctx);
  const { teachers } = ctx.staff;
  let assigned = 0;
  let directors = 0;
  for (const room of rooms) {
    const subjects = subjectsByGrade.get(room.grade) ?? [];
    const list = assignmentsOf(await admin.get(`/academic/classrooms/${room.id}/assignments`));
    for (const subject of subjects) {
      const teacher = teacherFor(school, teachers, room, subject);
      if (!teacher?.employeeId) continue;
      if (list.some((a) => a.subjectId === subject.id)) continue;
      await admin.post('/academic/assignments', { employeeId: teacher.employeeId, subjectId: subject.id, classroomId: room.id });
      assigned++;
    }
    const director = directorFor(school, teachers, room);
    if (director?.employeeId) {
      const res = await admin.put(`/academic/classrooms/${room.id}/director`, { employeeId: director.employeeId }, { allow: [409] });
      if (!res?.__status) directors++;
    }
  }
  log(`carga académica: asignaciones +${assigned}, directores de grupo ${directors}`);
}

/** `{subjectId, employeeId}` de la respuesta `GET /academic/classrooms/:id/assignments`. */
export const assignmentsOf = (res) =>
  (res.lines ?? []).filter((l) => l.teacher).map((l) => ({ id: l.assignmentId, subjectId: l.subject.id, employeeId: l.teacher.id }));

export function teacherFor(school, teachers, room, subject) {
  if (school.size !== 'full') {
    const area = subject.area || 'Matemáticas';
    return teachers.find((t) => t.areas.some((a) => area.startsWith(a))) ?? teachers[0];
  }
  const homeroom = teachers.find((t) => t.homeroom?.includes(room.key));
  if (homeroom && !['Inglés', 'Educación Física'].includes(subject.name)) return homeroom;
  return (
    teachers.find((t) => t.subjects?.includes(subject.name) && t.levels.includes(room.level)) ??
    // Primaria sin especialista (p. ej. tecnología en 1°): el titular.
    homeroom ??
    teachers.find((t) => t.subjects?.includes('Tecnología e Informática'))
  );
}

function directorFor(school, teachers, room) {
  if (school.size !== 'full') return teachers[(room.age + 1) % teachers.length];
  const homeroom = teachers.find((t) => t.homeroom?.includes(room.key));
  if (homeroom) return homeroom;
  const byRoom = { '6A': 'Marta', '6B': 'Álvaro José', '7A': 'Diana Carolina', '8A': 'Hernán Darío', '9A': 'María Fernanda', '10A': 'Óscar Andrés', '11A': 'Jennifer', '11B': 'Wilfrido' };
  return teachers.find((t) => t.first === byRoom[room.name]);
}

/** Recupera ids de empleados y correos del personal planeado (cuando el paso `staff` no corrió). */
export async function loadStaff(ctx) {
  if (ctx.staff) return ctx.staff;
  const { admin, school, api } = ctx;
  const { teachers, admins } = planStaff(school);
  const employees = await api.all(admin, '/hr/employees');
  for (const p of [...teachers, ...admins]) {
    const email = staffEmail(school, p).toLowerCase();
    const found = p.existing ? employees.find((e) => e.fullName === `${p.first} ${p.last}`) : employees.find((e) => (e.email ?? '').toLowerCase() === email);
    p.employeeId = found?.id;
    p.email = found?.email ?? staffEmail(school, p);
  }
  ctx.staff = { teachers, admins };
  return ctx.staff;
}

export async function staffTokens(ctx) {
  if (ctx.tokens) return ctx.tokens;
  const { teachers } = await loadStaff(ctx);
  ctx.tokens = new Map();
  for (const t of teachers) {
    if (!t.employeeId || !t.email) continue;
    try {
      ctx.tokens.set(t.employeeId, await ctx.api.login(t.email, PASSWORDS.staff));
    } catch (e) {
      warn(`no pude iniciar sesión como ${t.email}: ${e.message}`);
    }
  }
  return ctx.tokens;
}

export { CONFIG };
