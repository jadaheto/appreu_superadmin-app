// Pasos: períodos académicos, planillas de notas, boletines y asistencia.
import { CONFIG, addDays, clamp, log, pool, rng, round1, warn, weekday } from './core.mjs';
import { YEAR } from './plan.mjs';
import { assignmentsOf, loadStructure, staffTokens } from './steps-setup.mjs';
import { loadFamilies } from './steps-finance.mjs';

export const PERIODS = [
  { n: 1, name: 'Periodo 1', startDate: `${YEAR}-02-01`, endDate: `${YEAR}-04-15` },
  { n: 2, name: 'Periodo 2', startDate: `${YEAR}-04-16`, endDate: `${YEAR}-06-30` },
  { n: 3, name: 'Periodo 3', startDate: `${YEAR}-07-01`, endDate: `${YEAR}-09-15` },
  { n: 4, name: 'Periodo 4', startDate: `${YEAR}-09-16`, endDate: `${YEAR}-11-30` },
];

async function listPeriods(admin) {
  const res = await admin.get(`/academic/periods?year=${YEAR}`);
  return Array.isArray(res) ? res : res.items;
}

/** Estudiantes activos por salón según el plan (incluye los de la línea base). */
async function rosters(ctx, onDate) {
  const families = await loadFamilies(ctx);
  const byRoom = new Map();
  for (const f of families) {
    for (const c of f.children) {
      if (!c.id || (c.status && c.status !== 'active')) continue;
      if (c.withdrawAt && onDate && onDate > c.withdrawAt) continue;
      if (!byRoom.has(c.room)) byRoom.set(c.room, []);
      byRoom.get(c.room).push(c);
    }
  }
  return byRoom;
}

export async function stepAcademicRecords(ctx) {
  const { admin, school } = ctx;
  const { rooms, subjectsByGrade } = await loadStructure(ctx);
  const r = rng(`${school.slug}:grades`);
  // Desviación fija por estudiante y materia (mismas notas en cada corrida).
  const offset = new Map();
  const offsetOf = (sid, subj) => {
    const k = `${sid}:${subj}`;
    if (!offset.has(k)) offset.set(k, rng(`${school.slug}:off:${k}`).normal(0, 0.35));
    return offset.get(k);
  };

  let periods = await listPeriods(admin);
  const summary = [];
  for (const def of PERIODS) {
    let period = periods.find((p) => p.name === def.name) ?? periods.find((p) => p.startDate === def.startDate);
    if (!period) {
      period = await admin.post('/academic/periods', { name: def.name, startDate: def.startDate, endDate: def.endDate, academicYear: YEAR });
      periods = await listPeriods(admin);
    }
    if (def.n === 4 && period.status === 'closed') period = await admin.post(`/academic/periods/${period.id}/reopen`);
    if (period.status === 'open') {
      const byRoom = await rosters(ctx, def.startDate);
      let sheets = 0;
      const jobs = [];
      for (const room of rooms) {
        const students = byRoom.get(room.name) ?? [];
        if (!students.length) continue;
        const subjects = [...(subjectsByGrade.get(room.grade) ?? [])].sort((a, b) => a.id - b.id);
        subjects.forEach((subject, i) => {
          if (def.n === 4 && i % 2 === 1) return; // período en curso: la mitad de las planillas
          jobs.push({ room, subject, students });
        });
      }
      await pool(jobs, 3, async ({ room, subject, students }) => {
        const pr = rng(`${school.slug}:p${def.n}:${room.name}:${subject.id}`);
        const entries = students.map((s) => {
          const base = (s.ability ?? 3.6) + offsetOf(s.id, subject.id) + pr.normal(0, 0.25) + (def.n === 4 ? -0.1 : 0);
          const cognitive = round1(clamp(base + pr.normal(0, 0.3), 1, 5));
          const procedural = round1(clamp(base + pr.normal(0.1, 0.3), 1, 5));
          const attitudinal = round1(clamp(base + 0.35 + pr.normal(0, 0.3), 1, 5));
          const final = cognitive * 0.6 + procedural * 0.3 + attitudinal * 0.1;
          const observations =
            final < 3
              ? pr.pick(['Desempeño bajo; debe presentar plan de mejoramiento.', 'No alcanzó los logros del período; requiere acompañamiento del acudiente.', 'Incumplimiento de tareas y talleres.'])
              : final >= 4.6
                ? pr.pick(['Excelente desempeño.', 'Sobresaliente; felicitaciones.', 'Muy buena participación en clase.'])
                : undefined;
          return { studentId: s.id, cognitive, procedural, attitudinal, ...(observations ? { observations } : {}) };
        });
        await admin.put('/academic/grade-sheets', { classroomId: room.id, subjectId: subject.id, periodId: period.id, entries });
        sheets++;
      });
      summary.push(`P${def.n}: ${sheets} planillas`);
      if (def.n < 4) period = await admin.post(`/academic/periods/${period.id}/close`);
    }
    if (def.n <= 2 && period.status === 'closed') {
      const res = await admin.post(`/academic/periods/${period.id}/report-cards`);
      summary.push(`boletines P${def.n}: ${res.generated}`);
    }
    periods = await listPeriods(admin);
  }
  log(`académico: ${summary.join(', ') || 'sin cambios'}; estados ${periods.map((p) => `${p.name}=${p.status}`).join(', ')}`);
}

// ---------------------------------------------------------------------------
const HOLIDAYS = new Set([`${YEAR}-10-12`]);
const RECESS = [`${YEAR}-10-05`, `${YEAR}-10-09`];

export function schoolDays(from, to) {
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const wd = weekday(d);
    if (wd === 0 || wd === 6 || HOLIDAYS.has(d) || (d >= RECESS[0] && d <= RECESS[1])) continue;
    days.push(d);
  }
  return days;
}

export async function stepAttendance(ctx) {
  const { admin, school } = ctx;
  const { rooms } = await loadStructure(ctx);
  const tokens = await staffTokens(ctx);
  const from = school.size === 'full' ? `${YEAR}-08-31` : addDays(CONFIG.today, -14);
  const days = schoolDays(from, CONFIG.today);
  const jobs = [];
  for (const room of rooms) {
    const assignments = assignmentsOf(await admin.get(`/academic/classrooms/${room.id}/assignments`)).filter((a) => tokens.has(a.employeeId)).sort((a, b) => a.subjectId - b.subjectId);
    if (!assignments.length) {
      warn(`sin docentes con sesión para ${room.name}`);
      continue;
    }
    for (const [i, date] of days.entries()) {
      const students = (await rosters(ctx, date)).get(room.name) ?? [];
      if (students.length) jobs.push({ room, date, assignment: assignments[i % assignments.length], students });
    }
  }
  let saved = 0;
  await pool(jobs, 4, async ({ room, date, assignment, students }) => {
    const r = rng(`${school.slug}:att:${room.name}:${date}`);
    const entries = students.map((s) => {
      const risky = (s.ability ?? 3.6) < 3;
      const status = r.weighted([
        ['present', risky ? 80 : 91],
        ['absent', risky ? 11 : 4],
        ['late', risky ? 7 : 4],
        ['excused', 1],
      ]);
      return { studentId: s.id, status };
    });
    const token = tokens.get(assignment.employeeId);
    await ctx.api.as(token).post('/academic/attendance/manual', { classroomId: room.id, subjectId: assignment.subjectId, date, entries });
    saved += entries.length;
  });
  log(`asistencia: ${jobs.length} clases, ${saved} registros (${days.length} días hábiles desde ${from})`);
}
