// Planificación determinista (sin E/S): estructura, personal, familias y comportamiento de pago.
import { ACCENT_SURNAMES, ADULT_F, ADULT_M, BLOOD, CURRICULUM, DEMO_ADMIN_STAFF, DEMO_TEACHERS, EPS, FIRST_F, FIRST_M, GRADES, MAIL_DOMAINS, OCCUPATIONS, SURNAMES, TWO_SECTIONS, BANKS, PENSION_FUNDS, ARL } from './data.mjs';
import { rng, slugEmail } from './core.mjs';

export const YEAR = 2026;

/** Salones a crear: nombre `6A`, clave del titular `Sexto A`. */
export function planClassrooms(school) {
  const rooms = [];
  for (const grade of GRADES) {
    const letters = school.size === 'full' && TWO_SECTIONS.has(grade.name) ? ['A', 'B'] : ['A'];
    for (const letter of letters) {
      rooms.push({ grade: grade.name, level: grade.level, age: grade.age, name: `${grade.short}${letter}`, key: `${grade.name} ${letter}`, capacity: 30 });
    }
  }
  return rooms;
}

export const subjectsFor = (level) => CURRICULUM[level];

/** Docentes y administrativos del colegio. */
export function planStaff(school) {
  const r = rng(`${school.slug}:staff`);
  if (school.size === 'full') {
    const teachers = DEMO_TEACHERS.map((t) => ({ ...t, type: 'docente', position: 'Docente', department: 'Académico' }));
    return { teachers, admins: DEMO_ADMIN_STAFF.map((a) => ({ ...a })) };
  }
  // Colegio pequeño: 6 docentes por área y 2 administrativos.
  const areas = [
    ['Matemáticas', 'Tecnología'],
    ['Humanidades'],
    ['Ciencias Naturales'],
    ['Ciencias Sociales', 'Filosofía'],
    ['Educación Física', 'Educación Artística'],
    ['Preescolar', 'Ética', 'Religión'],
  ];
  const used = new Set();
  const person = (gender) => {
    for (;;) {
      const first = r.pick(gender === 'F' ? ADULT_F : ADULT_M);
      const last = `${r.pick(SURNAMES)} ${r.pick([...SURNAMES, ...ACCENT_SURNAMES])}`;
      if (!used.has(first + last)) {
        used.add(first + last);
        return { first, last };
      }
    }
  };
  const teachers = areas.map((areaList, i) => {
    const gender = r.chance(0.6) ? 'F' : 'M';
    return {
      ...person(gender),
      gender,
      doc: gender === 'F' ? `64${r.digits(6)}` : `92${r.digits(6)}`,
      salary: r.pick([2400000, 2550000, 2700000, 2900000, 3100000]),
      areas: areaList,
      since: `${r.int(2012, 2024)}-01-${String(r.int(15, 28)).padStart(2, '0')}`,
      type: 'docente',
      position: 'Docente',
      department: 'Académico',
      key: `t${i}`,
    };
  });
  const admins = [
    { ...person('F'), gender: 'F', doc: `1102${r.digits(6)}`, salary: 2800000, type: 'administrativo', position: 'Tesorera', department: 'Finanzas', role: 'finance', emailUser: 'tesoreria', since: '2019-02-01' },
    { ...person('F'), gender: 'F', doc: `1103${r.digits(6)}`, salary: 2100000, type: 'administrativo', position: 'Secretaria académica', department: 'Secretaría', since: '2021-01-18' },
  ];
  return { teachers, admins };
}

export const staffEmail = (school, p) => `${p.emailUser ?? slugEmail(`${p.first.split(' ')[0]}.${p.last.split(' ')[0]}`)}@${school.domain}`;

/**
 * Familias y estudiantes. Cada familia tiene un acudiente, 1–3 hijos y un perfil de pago:
 * puntual | tardio | moroso2 | moroso3 | adelantado | atrasado1.
 */
export function planFamilies(school, classrooms, existingCount = 0) {
  const r = rng(`${school.slug}:families`);
  const target = school.students - existingCount;
  // Cupos por salón: reparto parejo con algo de variación.
  const slots = [];
  const perRoom = Math.floor(school.students / classrooms.length);
  let extra = school.students - perRoom * classrooms.length;
  for (const room of classrooms) {
    let n = perRoom + (extra-- > 0 ? 1 : 0);
    if (school.slug === 'demo' && room.name === '6A') n -= existingCount; // Laura y Tomás ya están en 6A
    for (let i = 0; i < n; i++) slots.push(room);
  }
  const free = r.shuffle(slots).slice(0, target);

  const usedDocs = new Set();
  const doc = (prefix, len) => {
    for (;;) {
      const d = prefix + r.digits(len - prefix.length);
      if (!usedDocs.has(d)) {
        usedDocs.add(d);
        return d;
      }
    }
  };
  const usedEmails = new Set();
  const email = (first, last) => {
    for (let n = 0; ; n++) {
      const base = slugEmail(`${first.split(' ')[0]}.${last.split(' ')[0]}`);
      const e = `${base}${n ? n : r.chance(0.5) ? r.int(70, 99) : ''}@${r.pick(MAIL_DOMAINS)}`;
      if (!usedEmails.has(e)) {
        usedEmails.add(e);
        return e;
      }
    }
  };
  const usedNames = new Set();

  const families = [];
  let cursor = 0;
  let familyIndex = 0;
  // Apellidos con tilde forzados en las primeras familias (búsqueda "nunez", "pena").
  const forced = ['Núñez', 'Peña', 'Núñez', 'Peña', 'Muñoz', 'Ibáñez', 'Castaño', 'Ordóñez'];
  while (cursor < free.length) {
    const size = Math.min(free.length - cursor, r.weighted([[1, 66], [2, 26], [3, 8]]));
    const rooms = free.slice(cursor, cursor + size);
    cursor += size;
    const paternal = familyIndex < forced.length ? forced[familyIndex] : r.chance(0.18) ? r.pick(ACCENT_SURNAMES) : r.pick(SURNAMES);
    let maternal = r.chance(0.15) ? r.pick(ACCENT_SURNAMES) : r.pick(SURNAMES);
    if (maternal === paternal) maternal = r.pick(SURNAMES);
    const guardianIsMother = r.chance(0.62);
    const gFirst = r.pick(guardianIsMother ? ADULT_F : ADULT_M);
    const gLast = guardianIsMother ? `${maternal} ${r.pick(SURNAMES)}` : `${paternal} ${r.pick(SURNAMES)}`;
    const neighborhood = r.pick(school.neighborhoods);
    const address = `${r.pick(['Calle', 'Carrera', 'Diagonal', 'Transversal'])} ${r.int(1, 45)}${r.chance(0.2) ? r.pick(['A', 'B']) : ''} # ${r.int(1, 40)}-${r.int(2, 98)}`;
    const mobile = `3${r.pick(['00', '01', '02', '04', '05', '10', '11', '12', '13', '14', '15', '16', '17', '18', '20', '21', '23'])}${r.digits(7)}`;
    const young = r.chance(0.35);
    const guardian = {
      documentType: 'cc',
      documentNumber: young ? doc('1102', 10) : guardianIsMother ? doc('64', 8) : doc('92', 8),
      firstName: gFirst,
      lastName: gLast,
      relationship: guardianIsMother ? 'madre' : r.chance(0.9) ? 'padre' : r.pick(['abuela', 'tio', 'tia']),
      mobile,
      phone: r.chance(0.2) ? `605${r.int(2700000, 2899999)}` : undefined,
      email: r.chance(0.9) ? email(gFirst, gLast) : undefined,
      address: `${address}, Barrio ${neighborhood}`,
      city: school.city,
      occupation: r.pick(OCCUPATIONS),
    };
    const profile = r.weighted([
      ['puntual', 61],
      ['tardio', 17],
      ['moroso3', 6],
      ['moroso2', 7],
      ['atrasado1', 4],
      ['adelantado', 5],
    ]);
    const children = rooms.map((room) => {
      const gender = r.chance(0.5) ? 'F' : 'M';
      let first;
      for (;;) {
        first = r.pick(gender === 'F' ? FIRST_F : FIRST_M);
        if (!usedNames.has(`${first} ${paternal} ${maternal}`)) break;
      }
      usedNames.add(`${first} ${paternal} ${maternal}`);
      const age = room.age + (r.chance(0.12) ? 1 : 0);
      const birthYear = YEAR - age - (r.chance(0.6) ? 0 : 0);
      const birthDate = `${birthYear - (r.chance(0.55) ? 1 : 0)}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`;
      const documentType = age >= 7 ? 'TI' : 'RC';
      const last = `${paternal} ${maternal}`;
      return {
        firstName: first,
        lastName: last,
        gender,
        documentType,
        documentNumber: documentType === 'TI' ? doc(`1${r.pick(['100', '101', '102', '103'])}`, 10) : doc('1104', 10),
        birthDate,
        bloodType: r.pick(BLOOD),
        address: guardian.address,
        city: school.city,
        neighborhood,
        phone: mobile,
        email: room.age >= 14 && r.chance(0.5) ? email(first, last) : undefined,
        eps: r.pick(EPS),
        room: room.name,
        enrollmentDate: `${YEAR}-01-${String(r.int(12, 30)).padStart(2, '0')}`,
        ability: profileAbility(r),
        transport: r.chance(0.22),
        uniform: r.chance(0.45),
      };
    });
    families.push({ index: familyIndex, guardian, children, profile, portal: familyIndex % 4 === 0 || children.length === 3 });
    familyIndex++;
  }
  // Becas (un par): primer hijo de dos familias puntuales.
  const scholars = families.filter((f) => f.profile === 'puntual').slice(3, 5);
  if (scholars[0]) scholars[0].children[0].scholarshipPct = 50;
  if (scholars[1]) scholars[1].children[0].scholarshipPct = 30;
  return families;
}

/** Habilidad académica (0–5): ~12 % de estudiantes en riesgo. */
function profileAbility(r) {
  if (r.chance(0.12)) return r.normal(2.75, 0.25);
  return r.normal(3.95, 0.45);
}

export const planEmployeeData = (school, p, r) => ({
  firstName: p.first,
  lastName: p.last,
  documentType: 'cc',
  documentNumber: p.doc,
  birthDate: `${r.int(1968, 1998)}-${String(r.int(1, 12)).padStart(2, '0')}-${String(r.int(1, 28)).padStart(2, '0')}`,
  gender: p.gender,
  phone: `3${r.pick(['00', '01', '04', '10', '13', '15', '17', '20'])}${r.digits(7)}`,
  email: staffEmail(school, p),
  address: `${r.pick(['Calle', 'Carrera'])} ${r.int(5, 40)} # ${r.int(1, 30)}-${r.int(2, 90)}, ${school.city}`,
  employeeType: p.type,
  position: p.position,
  department: p.department,
  hireDate: p.since,
  contractType: p.type === 'servicios' ? 'fijo' : 'indefinido',
  baseSalary: p.salary,
  bankName: r.pick(BANKS),
  bankAccount: r.digits(11),
  accountType: r.chance(0.85) ? 'ahorros' : 'corriente',
  eps: r.pick(EPS),
  pensionFund: r.pick(PENSION_FUNDS),
  arl: r.pick(ARL),
  arlRiskClass: 1,
  createUserAccount: true,
});
