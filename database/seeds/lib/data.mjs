// Catálogos de datos verosímiles (región Caribe colombiana) y perfiles de cada colegio.

export const PASSWORDS = {
  staff: 'Apreu2026', // docentes, administrativos, finanzas, RR. HH.
  portal: 'Familia2026', // acudientes y estudiantes
  director: 'Director2026', // directores de los colegios aprovisionados
};

/** Perfil de cada colegio que el script sabe sembrar. */
export const SCHOOLS = {
  demo: {
    slug: 'demo',
    size: 'full',
    domain: 'demo.co',
    director: { email: 'director@demo.co', password: 'Demo2026', name: 'Director Demo' },
    name: 'Colegio Demo San José',
    nit: '900456789',
    address: 'Calle 25 # 19-45, Barrio La Ford',
    phone: '6052801234',
    email: 'contacto@demo.co',
    city: 'Sincelejo',
    cityDane: '70001',
    department: 'Sucre',
    departmentDane: '70',
    postalCode: '700001',
    daneCode: '370001000478',
    resolution: 'Res. 0847 del 12/03/2019 — SEM Sincelejo',
    rector: 'Hna. María Elena Vergara Paternina',
    colors: { primary: '#1d4ed8', headerBg: '#ffffff', headerBar: '#b91c1c' },
    students: 150,
    neighborhoods: ['La Ford', 'Majagual', 'La Pollita', 'Venecia', 'Boston', 'Las Margaritas', 'El Bosque', 'La Mochila', 'Uribe Uribe', 'San Carlos', 'Los Pioneros', 'La Selva', 'Florencia', 'Las Américas', 'Villa Mady', 'Altos de la Sabana', 'El Cortijo', 'Argelia'],
  },
  'colegio-la-esperanza': {
    slug: 'colegio-la-esperanza',
    size: 'small',
    domain: 'laesperanza.edu.co',
    director: { email: 'rectoria@laesperanza.edu.co', password: PASSWORDS.director, name: 'Rafael Antonio Mercado Tous' },
    phoneProvision: '3005551201',
    initialStatus: 'active',
    name: 'Colegio La Esperanza',
    nit: '823004512',
    address: 'Carrera 28 # 31-12, Barrio San José',
    phone: '6052855120',
    email: 'secretaria@laesperanza.edu.co',
    city: 'Corozal',
    cityDane: '70215',
    department: 'Sucre',
    departmentDane: '70',
    postalCode: '704010',
    daneCode: '370215000123',
    resolution: 'Res. 2210 del 03/08/2015 — SED Sucre',
    rector: 'Rafael Antonio Mercado Tous',
    colors: { primary: '#047857', headerBg: '#ffffff', headerBar: '#f59e0b' },
    students: 55,
    neighborhoods: ['San José', 'El Carmen', 'Las Brisas', 'San Juan', 'Villa Paz', 'El Centro', 'Los Alpes'],
  },
  'liceo-moderno': {
    slug: 'liceo-moderno',
    size: 'small',
    domain: 'liceomoderno.edu.co',
    director: { email: 'director@liceomoderno.edu.co', password: PASSWORDS.director, name: 'Claudia Patricia Ordóñez Lara' },
    phoneProvision: '3015551302',
    initialStatus: 'trial',
    trialEndsAt: '2026-12-15',
    name: 'Liceo Moderno de Montería',
    nit: '812007345',
    address: 'Calle 41 # 6-30, Barrio La Castellana',
    phone: '6047891122',
    email: 'info@liceomoderno.edu.co',
    city: 'Montería',
    cityDane: '23001',
    department: 'Córdoba',
    departmentDane: '23',
    postalCode: '230002',
    daneCode: '323001003456',
    resolution: 'Res. 0391 del 22/01/2021 — SEM Montería',
    rector: 'Claudia Patricia Ordóñez Lara',
    colors: { primary: '#7c3aed', headerBg: '#faf5ff', headerBar: '#7c3aed' },
    students: 40,
    neighborhoods: ['La Castellana', 'El Recreo', 'Los Laureles', 'La Granja', 'Mocarí', 'Pasatiempo', 'Rancho Grande'],
  },
  'gimnasio-del-caribe': {
    slug: 'gimnasio-del-caribe',
    size: 'small',
    domain: 'gimnasiocaribe.edu.co',
    director: { email: 'rector@gimnasiocaribe.edu.co', password: PASSWORDS.director, name: 'Jorge Luis Castaño Pájaro' },
    phoneProvision: '3025551403',
    initialStatus: 'active',
    name: 'Gimnasio del Caribe',
    nit: '806015678',
    address: 'Avenida Pedro de Heredia # 31-50, Barrio El Prado',
    phone: '6056643300',
    email: 'admisiones@gimnasiocaribe.edu.co',
    city: 'Cartagena de Indias',
    cityDane: '13001',
    department: 'Bolívar',
    departmentDane: '13',
    postalCode: '130001',
    daneCode: '313001009876',
    resolution: 'Res. 1567 del 09/09/2017 — SED Cartagena',
    rector: 'Jorge Luis Castaño Pájaro',
    colors: { primary: '#0e7490', headerBg: '#ecfeff', headerBar: '#f97316' },
    students: 32,
    neighborhoods: ['El Prado', 'Manga', 'Crespo', 'Pie de la Popa', 'Los Alpes', 'Bocagrande', 'Turbaco Centro'],
  },
};

/** Grados en orden; `age` = edad típica en 2026. */
export const GRADES = [
  { name: 'Transición', short: 'T', level: 'preescolar', age: 5 },
  { name: 'Primero', short: '1', level: 'primaria', age: 6 },
  { name: 'Segundo', short: '2', level: 'primaria', age: 7 },
  { name: 'Tercero', short: '3', level: 'primaria', age: 8 },
  { name: 'Cuarto', short: '4', level: 'primaria', age: 9 },
  { name: 'Quinto', short: '5', level: 'primaria', age: 10 },
  { name: 'Sexto', short: '6', level: 'secundaria', age: 11 },
  { name: 'Séptimo', short: '7', level: 'secundaria', age: 12 },
  { name: 'Octavo', short: '8', level: 'secundaria', age: 13 },
  { name: 'Noveno', short: '9', level: 'secundaria', age: 14 },
  { name: 'Décimo', short: '10', level: 'media', age: 15 },
  { name: 'Undécimo', short: '11', level: 'media', age: 16 },
];

/** Grados con dos salones (A/B) en el colegio grande. */
export const TWO_SECTIONS = new Set(['Primero', 'Sexto', 'Undécimo']);

const S = (name, code, area, hours) => ({ name, code, area, hours });
export const CURRICULUM = {
  preescolar: [
    S('Dimensión Comunicativa', 'DCO', 'Preescolar', 5),
    S('Dimensión Cognitiva', 'DCG', 'Preescolar', 5),
    S('Dimensión Corporal', 'DCR', 'Preescolar', 3),
    S('Dimensión Estética', 'DES', 'Preescolar', 2),
    S('Dimensión Socioafectiva', 'DSA', 'Preescolar', 2),
    S('Inglés', 'ING', 'Humanidades', 2),
  ],
  primaria: [
    S('Matemáticas', 'MAT', 'Matemáticas', 5),
    S('Lengua Castellana', 'LEN', 'Humanidades', 5),
    S('Ciencias Naturales', 'CNA', 'Ciencias Naturales', 3),
    S('Ciencias Sociales', 'CSO', 'Ciencias Sociales', 3),
    S('Inglés', 'ING', 'Humanidades', 3),
    S('Educación Artística', 'ART', 'Educación Artística', 2),
    S('Educación Física', 'EFI', 'Educación Física', 2),
    S('Ética y Valores', 'ETI', 'Ética', 1),
    S('Educación Religiosa', 'REL', 'Religión', 1),
    S('Tecnología e Informática', 'TEC', 'Tecnología', 2),
  ],
  secundaria: [
    S('Matemáticas', 'MAT', 'Matemáticas', 5),
    S('Lengua Castellana', 'LEN', 'Humanidades', 4),
    S('Ciencias Naturales', 'CNA', 'Ciencias Naturales', 4),
    S('Ciencias Sociales', 'CSO', 'Ciencias Sociales', 4),
    S('Inglés', 'ING', 'Humanidades', 3),
    S('Educación Artística', 'ART', 'Educación Artística', 1),
    S('Educación Física', 'EFI', 'Educación Física', 2),
    S('Ética y Valores', 'ETI', 'Ética', 1),
    S('Educación Religiosa', 'REL', 'Religión', 1),
    S('Tecnología e Informática', 'TEC', 'Tecnología', 2),
  ],
  media: [
    S('Matemáticas', 'MAT', 'Matemáticas', 4),
    S('Lengua Castellana', 'LEN', 'Humanidades', 3),
    S('Física', 'FIS', 'Ciencias Naturales', 3),
    S('Química', 'QUI', 'Ciencias Naturales', 3),
    S('Ciencias Sociales', 'CSO', 'Ciencias Sociales', 2),
    S('Filosofía', 'FIL', 'Filosofía', 2),
    S('Ciencias Políticas y Económicas', 'CPE', 'Ciencias Sociales', 1),
    S('Inglés', 'ING', 'Humanidades', 3),
    S('Educación Física', 'EFI', 'Educación Física', 2),
    S('Ética y Valores', 'ETI', 'Ética', 1),
    S('Tecnología e Informática', 'TEC', 'Tecnología', 2),
  ],
};

/**
 * Docentes del colegio grande. `teaches` decide qué materias toma de cada salón:
 * - `homeroom: 'Primero A'` = titular de un salón de primaria (todas sus materias salvo inglés y ed. física).
 * - `subjects` + `levels` = especialista por materia.
 */
export const DEMO_TEACHERS = [
  { first: 'Luz Marina', last: 'Arrieta Salcedo', gender: 'F', doc: '64567123', salary: 2650000, homeroom: ['Transición A'], since: '2012-02-01' },
  { first: 'Yolanda', last: 'Benítez Herazo', gender: 'F', doc: '64578234', salary: 2850000, homeroom: ['Primero A'], since: '2010-01-20' },
  { first: 'Rocío del Carmen', last: 'Monterrosa Díaz', gender: 'F', doc: '64589345', salary: 2650000, homeroom: ['Primero B'], since: '2016-01-18' },
  { first: 'Ana Milena', last: 'Payares Ruiz', gender: 'F', doc: '1102834567', salary: 2500000, homeroom: ['Segundo A'], since: '2021-01-25' },
  { first: 'Edilberto', last: 'Chamorro Vitola', gender: 'M', doc: '92512456', salary: 2850000, homeroom: ['Tercero A'], since: '2009-02-02' },
  { first: 'Karen Sofía', last: 'Navarro Peña', gender: 'F', doc: '1102845678', salary: 2500000, homeroom: ['Cuarto A'], since: '2022-01-24' },
  { first: 'José Gregorio', last: 'Martínez Ortega', gender: 'M', doc: '92523567', salary: 2750000, homeroom: ['Quinto A'], since: '2014-01-20' },
  { first: 'Jennifer', last: 'Hoyos Contreras', gender: 'F', doc: '1102856789', salary: 2700000, subjects: ['Inglés'], levels: ['preescolar', 'primaria', 'secundaria', 'media'], since: '2019-01-21' },
  { first: 'Wilfrido', last: 'Romero Sierra', gender: 'M', doc: '92534678', salary: 2600000, subjects: ['Educación Física'], levels: ['primaria', 'secundaria', 'media'], since: '2013-02-04' },
  { first: 'Marta', last: 'Ruiz', existing: true, subjects: ['Matemáticas'], levels: ['secundaria', 'media'] },
  { first: 'Álvaro José', last: 'Núñez Barboza', gender: 'M', doc: '92545789', salary: 3600000, subjects: ['Lengua Castellana'], levels: ['secundaria', 'media'], since: '2008-01-21' },
  { first: 'Diana Carolina', last: 'Vergara Montes', gender: 'F', doc: '64601456', salary: 3400000, subjects: ['Ciencias Naturales', 'Física', 'Química'], levels: ['secundaria', 'media'], since: '2015-01-19' },
  { first: 'Hernán Darío', last: 'Pérez Narváez', gender: 'M', doc: '92556890', salary: 3300000, subjects: ['Ciencias Sociales', 'Filosofía', 'Ciencias Políticas y Económicas'], levels: ['secundaria', 'media'], since: '2011-01-24' },
  { first: 'María Fernanda', last: 'Ibáñez Tovar', gender: 'F', doc: '1102867890', salary: 2900000, subjects: ['Educación Artística', 'Ética y Valores', 'Educación Religiosa'], levels: ['secundaria', 'media'], since: '2020-01-20' },
  { first: 'Óscar Andrés', last: 'Muñoz Pacheco', gender: 'M', doc: '1102878901', salary: 3100000, subjects: ['Tecnología e Informática'], levels: ['secundaria', 'media'], since: '2018-01-22' },
];

/** Administrativos (empleados con cuenta). `role` = rol de usuario creado antes de vincular. */
export const DEMO_ADMIN_STAFF = [
  { first: 'Gloria Inés', last: 'Salgado Mercado', gender: 'F', doc: '64512789', salary: 3200000, type: 'administrativo', position: 'Tesorera', department: 'Finanzas', role: 'finance', emailUser: 'tesoreria', since: '2011-03-01' },
  { first: 'Sandra Patricia', last: 'Tous Atencia', gender: 'F', doc: '64523890', salary: 3400000, type: 'administrativo', position: 'Jefe de Talento Humano', department: 'Talento Humano', role: 'hr', emailUser: 'talento.humano', since: '2013-07-15' },
  { first: 'Liliana María', last: 'Acuña Ricardo', gender: 'F', doc: '1102889012', salary: 2100000, type: 'administrativo', position: 'Secretaria académica', department: 'Secretaría', since: '2017-01-16' },
  { first: 'Carlos Arturo', last: 'Beltrán Paternina', gender: 'M', doc: '92567901', salary: 3900000, type: 'directivo', position: 'Coordinador académico y de convivencia', department: 'Coordinación', since: '2010-01-18' },
  { first: 'Ramiro', last: 'Ordóñez Castaño', gender: 'M', doc: '92578012', salary: 1750905, type: 'servicios', position: 'Auxiliar de servicios generales', department: 'Servicios generales', since: '2019-05-02' },
];

export const FIRST_F = ['Valentina', 'Sofía', 'Isabella', 'Mariana', 'Camila', 'Daniela', 'Luciana', 'Salomé', 'María José', 'Sara', 'Gabriela', 'Ana Sofía', 'Juliana', 'Valeria', 'Antonella', 'Emilia', 'María Paula', 'Mía', 'Victoria', 'Allison', 'Juana', 'Laura Sofía', 'Martina', 'Zharick', 'Dayana', 'Isabel', 'Ángela', 'Nicole', 'Luisa Fernanda', 'Andrea', 'Mariángel', 'Ximena', 'Paula Andrea', 'Melany', 'Lucía', 'Josefina', 'Ainhoa', 'Dulce María'];
export const FIRST_M = ['Santiago', 'Sebastián', 'Matías', 'Samuel', 'Alejandro', 'Nicolás', 'Daniel', 'Jerónimo', 'Juan José', 'Emiliano', 'Tomás', 'Martín', 'David', 'Juan David', 'Andrés Felipe', 'José Ángel', 'Ángel David', 'Thiago', 'Dylan', 'Joel', 'Simón', 'Gabriel', 'Isaac', 'Julián', 'Esteban', 'Maximiliano', 'Luis Ángel', 'Carlos Andrés', 'Miguel Ángel', 'Juan Pablo', 'Iker', 'Joaquín', 'Benjamín', 'Moisés', 'Josué', 'Elías', 'Rubén Darío', 'Óscar'];
export const ADULT_F = ['Mónica', 'Claudia', 'Patricia', 'Yesenia', 'Luz Dary', 'Marcela', 'Adriana', 'Katherine', 'Diana', 'Erika', 'Liliana', 'Yuranis', 'Sandra', 'Martha Lucía', 'Rosa Elena', 'Yolima', 'Ingrid', 'Paola', 'Leidy', 'Carolina', 'Luz Ángela', 'Nelly', 'Beatriz', 'Zulay', 'Milena', 'Ruth', 'Yamile', 'Doris', 'Eliana', 'Nayibe'];
export const ADULT_M = ['Jorge Luis', 'Carlos Alberto', 'Luis Eduardo', 'Juan Carlos', 'Rafael', 'Édgar', 'Fredy', 'José Miguel', 'Alfonso', 'Germán', 'Hernando', 'Iván Darío', 'Nelson', 'Wilson', 'Jaime', 'Rodrigo', 'Ever', 'Eduardo', 'Álex', 'Henry', 'Manuel', 'Ramón', 'Gustavo', 'Néstor', 'Orlando', 'Rubén', 'Efraín', 'Libardo', 'Ómar', 'Arnulfo'];
export const SURNAMES = ['Pérez', 'Martínez', 'Rodríguez', 'Gómez', 'Hernández', 'Díaz', 'Ramírez', 'Sánchez', 'Vásquez', 'Jiménez', 'Álvarez', 'Durán', 'Mejía', 'Montaño', 'Arrieta', 'Mercado', 'Paternina', 'Monterrosa', 'Vergara', 'Salcedo', 'Barboza', 'Montes', 'Ortega', 'Romero', 'Sierra', 'Herazo', 'Chamorro', 'Navarro', 'Payares', 'Narváez', 'Contreras', 'Hoyos', 'Ruiz', 'Tous', 'Atencia', 'Ricardo', 'Pacheco', 'Barrios', 'Tovar', 'Salgado', 'Begambre', 'Vitola', 'Pájaro', 'Meza', 'Oviedo', 'Corrales', 'Buelvas', 'Acosta', 'Castillo', 'Guerra', 'Cárdenas', 'Fuentes', 'Padilla', 'Suárez', 'Torres', 'Morales', 'Rivera', 'Cuello', 'Escobar', 'Amaya'];
/** Apellidos con tilde/ñ usados a propósito para probar la búsqueda sin tildes. */
export const ACCENT_SURNAMES = ['Núñez', 'Peña', 'Muñoz', 'Ibáñez', 'Patiño', 'Castaño', 'Londoño', 'Ordóñez', 'Saldaña', 'Acuña', 'Beltrán', 'Pérez'];
export const EPS = ['Nueva EPS', 'Coosalud EPS', 'Mutual SER', 'Salud Total', 'Sanitas', 'SURA EPS', 'Cajacopi', 'Famisanar'];
export const PENSION_FUNDS = ['Porvenir', 'Protección', 'Colfondos', 'Colpensiones'];
export const ARL = ['ARL SURA', 'Positiva', 'Colmena Seguros', 'Seguros Bolívar'];
export const BANKS = ['Bancolombia', 'Davivienda', 'Banco de Bogotá', 'BBVA', 'Banco Agrario'];
export const OCCUPATIONS = ['Comerciante', 'Docente', 'Enfermera', 'Contador público', 'Ingeniero civil', 'Ama de casa', 'Conductor', 'Abogada', 'Independiente', 'Policía', 'Auxiliar administrativa', 'Mototaxista', 'Médico', 'Ganadero', 'Estilista', 'Técnico electricista', 'Vendedora', 'Funcionario público'];
export const MAIL_DOMAINS = ['gmail.com', 'gmail.com', 'gmail.com', 'hotmail.com', 'outlook.com', 'yahoo.es'];
export const BLOOD = ['O+', 'O+', 'O+', 'A+', 'A+', 'B+', 'O-', 'AB+', 'A-'];
