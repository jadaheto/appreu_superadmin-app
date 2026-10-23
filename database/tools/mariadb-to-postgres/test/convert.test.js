import { describe, expect, it } from 'vitest';
import {
  DEFAULT, Digest, canonicalJson, canonicalSource, canonicalTarget, charLength, convertValue, isBlocking,
  isZeroDate, looseKey, normalizeDecimal, parseDefaultLiteral, parseEnumCheck, parseIndexColumn, pgRenderExpr,
  planColumn, rowsPerInsert, toTimestamptzLiteral, topoSort,
} from '../src/convert.js';

const tgt = (dataType, extra = {}) => ({ dataType, formatType: extra.formatType ?? dataType, nullable: true, hasDefault: false, maxLength: null, enumValues: null, ...extra });
const src = (dataType, columnType = dataType, precision = 0) => ({ dataType, columnType, precision });

describe('planColumn', () => {
  it('clasifica según el tipo de ambos motores', () => {
    expect(planColumn('a', src('tinyint', 'tinyint(1)'), tgt('boolean')).kind).toBe('bool');
    expect(planColumn('a', src('year', 'year(4)'), tgt('smallint')).kind).toBe('year');
    expect(planColumn('a', src('tinyint', 'tinyint(3) unsigned'), tgt('smallint')).kind).toBe('int');
    expect(planColumn('a', src('decimal', 'decimal(12,2)'), tgt('numeric')).kind).toBe('numeric');
    expect(planColumn('a', src('longtext'), tgt('jsonb')).kind).toBe('json');
    expect(planColumn('a', src('enum', "enum('a','b')"), tgt('character varying', { enumValues: ['a', 'b'] })).kind).toBe('enum');
    expect(planColumn('a', src('varchar'), tgt('character varying', { maxLength: 10 }))).toMatchObject({ kind: 'text', maxLength: 10 });
    expect(planColumn('a', src('blob'), tgt('bytea')).kind).toBe('bytes');
  });

  it('timestamp de MariaDB es UTC y datetime usa la zona del legacy', () => {
    expect(planColumn('a', src('timestamp'), tgt('timestamp with time zone')).zone).toBe('UTC');
    expect(planColumn('a', src('datetime'), tgt('timestamp with time zone')).zone).toBe('America/Bogota');
    expect(planColumn('a', src('datetime'), tgt('timestamp with time zone'), { datetimeZone: 'UTC' }).zone).toBe('UTC');
  });
});

describe('fechas', () => {
  it('detecta fechas cero e incompletas', () => {
    for (const v of ['0000-00-00', '0000-00-00 00:00:00', '2024-00-10', '2024-05-00', '0000-05-10 10:00:00']) expect(isZeroDate(v)).toBe(true);
    for (const v of ['2024-05-10', '2024-05-10 00:00:00', null, 2024]) expect(isZeroDate(v)).toBe(false);
  });

  it('arma el literal timestamptz con la zona IANA o UTC', () => {
    expect(toTimestamptzLiteral('2026-03-05 00:00:00', 'America/Bogota')).toBe('2026-03-05 00:00:00 America/Bogota');
    expect(toTimestamptzLiteral('2026-10-16 21:54:46', 'UTC')).toBe('2026-10-16 21:54:46+00');
  });
});

describe('parseEnumCheck / parseIndexColumn / parseDefaultLiteral', () => {
  it('lee los valores del CHECK como los devuelve pg_get_constraintdef', () => {
    const def = "CHECK (((document_type)::text = ANY ((ARRAY['TI'::character varying, 'CC'::character varying, 'CE'::character varying, 'PP'::character varying, 'RC'::character varying])::text[])))";
    expect(parseEnumCheck(def)).toEqual(['TI', 'CC', 'CE', 'PP', 'RC']);
    expect(parseEnumCheck("CHECK (((x)::text = ANY ((ARRAY['it''s'::character varying])::text[])))")).toEqual(["it's"]);
    expect(parseEnumCheck('CHECK ((amount >= (0)::numeric))')).toBeNull();
  });

  it('reconoce columnas simples y lower(col) en índices únicos', () => {
    expect(parseIndexColumn('lower(email::text)')).toEqual({ column: 'email', lower: true });
    expect(parseIndexColumn('key')).toEqual({ column: 'key', lower: false });
    expect(parseIndexColumn('"order"')).toEqual({ column: 'order', lower: false });
    expect(parseIndexColumn('f_unaccent(name)')).toBeNull();
  });

  it('extrae DEFAULT literales y deja las expresiones', () => {
    expect(parseDefaultLiteral("'TI'::character varying")).toBe('TI');
    expect(parseDefaultLiteral("'0.0.0.0'::character varying")).toBe('0.0.0.0');
    expect(parseDefaultLiteral('30')).toBe('30');
    expect(parseDefaultLiteral('false')).toBe(false);
    expect(parseDefaultLiteral('now()')).toBeUndefined();
    expect(parseDefaultLiteral('CURRENT_DATE')).toBeUndefined();
    expect(parseDefaultLiteral(null)).toBeUndefined();
  });
});

describe('convertValue', () => {
  const bool = { name: 'is_active', kind: 'bool', nullable: false, hasDefault: true, defaultLiteral: true };
  it('tinyint -> boolean', () => {
    expect(convertValue(bool, 0).value).toBe(false);
    expect(convertValue(bool, 1).value).toBe(true);
    expect(convertValue(bool, '1').value).toBe(true);
    const r = convertValue(bool, 2);
    expect(r.issues[0]).toMatchObject({ code: 'BOOL_RANGE', fixed: false });
    expect(isBlocking(r.issues[0])).toBe(true);
    expect(convertValue(bool, 2, { fix: true })).toMatchObject({ value: true, issues: [{ fixed: true }] });
  });

  it('year -> smallint y 0000 como fecha cero', () => {
    const year = { kind: 'year', nullable: true, range: [-32768n, 32767n] };
    expect(convertValue(year, 2026).value).toBe('2026');
    expect(convertValue(year, 0).issues[0].code).toBe('ZERO_DATE');
    expect(convertValue(year, 0, { fix: true }).value).toBeNull();
  });

  it('enteros fuera de rango', () => {
    const int = { kind: 'int', nullable: true, range: [-2147483648n, 2147483647n] };
    expect(convertValue(int, 4294967295).issues[0].code).toBe('INT_RANGE');
    expect(convertValue(int, '9007199254740993').issues[0].code).toBe('INT_RANGE');
    expect(convertValue(int, 42)).toEqual({ value: '42', issues: [] });
  });

  it('numeric se copia como texto exacto', () => {
    expect(convertValue({ kind: 'numeric', nullable: true }, '1500000.25').value).toBe('1500000.25');
  });

  it('datetime en hora de Bogotá, timestamp en UTC; fechas cero -> NULL o DEFAULT con --fix', () => {
    const dt = { kind: 'timestamp', zone: 'America/Bogota', nullable: true };
    const ts = { kind: 'timestamp', zone: 'UTC', nullable: true };
    expect(convertValue(dt, '2026-03-05 07:30:00').value).toBe('2026-03-05 07:30:00 America/Bogota');
    expect(convertValue(ts, '2026-03-05 12:30:00').value).toBe('2026-03-05 12:30:00+00');
    const zero = convertValue(dt, '0000-00-00 00:00:00');
    expect(zero.issues[0]).toMatchObject({ code: 'ZERO_DATE', fixed: false, rule: 'NULL' });
    expect(convertValue(dt, '0000-00-00 00:00:00', { fix: true }).value).toBeNull();
    const notNullNow = { kind: 'timestamp', zone: 'UTC', nullable: false, hasDefault: true };
    expect(convertValue(notNullNow, '0000-00-00 00:00:00', { fix: true }).value).toBe(DEFAULT);
    const notNullNoDefault = { kind: 'date', nullable: false, hasDefault: false };
    const r = convertValue(notNullNoDefault, '0000-00-00', { fix: true });
    expect(r.issues[0]).toMatchObject({ code: 'ZERO_DATE', fixed: false });
  });

  it('enum: vacío -> DEFAULT (o NULL), mayúsculas -> valor canónico, inválido bloquea', () => {
    const e = { kind: 'enum', enumValues: ['TI', 'CC'], nullable: true, hasDefault: true, defaultLiteral: 'TI' };
    expect(convertValue(e, 'CC')).toEqual({ value: 'CC', issues: [] });
    expect(convertValue(e, '').issues[0]).toMatchObject({ code: 'ENUM_EMPTY', fixed: false });
    expect(convertValue(e, '', { fix: true })).toMatchObject({ value: 'TI', issues: [{ rule: 'DEFAULT ("TI")' }] });
    expect(convertValue({ ...e, hasDefault: false, defaultLiteral: undefined }, '', { fix: true }).value).toBeNull();
    expect(convertValue(e, 'cc ', { fix: true })).toMatchObject({ value: 'CC', issues: [{ code: 'ENUM_CASE' }] });
    expect(convertValue(e, 'XX', { fix: true }).issues[0]).toMatchObject({ code: 'ENUM_INVALID', fixed: false });
  });

  it('JSON inválido o vacío -> NULL (o {} si NOT NULL) con --fix', () => {
    const j = { kind: 'json', nullable: true };
    expect(convertValue(j, '{"a":1}')).toEqual({ value: '{"a":1}', issues: [] });
    expect(convertValue(j, '{mal').issues[0].code).toBe('JSON_INVALID');
    expect(convertValue(j, '', { fix: true }).value).toBeNull();
    expect(convertValue({ kind: 'json', nullable: false }, 'x', { fix: true }).value).toBe('{}');
    const nul = convertValue(j, '{"a":"x\\u0000y"}', { fix: true });
    expect(nul.issues[0].code).toBe('NUL_CHAR');
    expect(JSON.parse(nul.value)).toEqual({ a: 'xy' });
  });

  it('texto: NUL, longitud, espacios finales en claves únicas y correos en minúscula', () => {
    const t = { kind: 'text', nullable: true, maxLength: 3 };
    expect(convertValue(t, 'a\u0000b', { fix: true })).toMatchObject({ value: 'ab', issues: [{ code: 'NUL_CHAR' }] });
    expect(convertValue(t, 'abcd').issues[0].code).toBe('TOO_LONG');
    expect(convertValue(t, 'ñáé').issues).toEqual([]);
    const code = { kind: 'text', nullable: false, unique: true };
    const sp = convertValue(code, 'AL-1  ');
    expect(sp.issues[0]).toMatchObject({ code: 'UNIQUE_TRAILING_SPACE', severity: 'warning' });
    expect(isBlocking(sp.issues[0])).toBe(false);
    expect(convertValue(code, 'AL-1  ', { fix: true }).value).toBe('AL-1');
    const email = { kind: 'text', nullable: false, unique: true, lowerUnique: true };
    expect(convertValue(email, 'Profe@Demo.co').value).toBe('Profe@Demo.co');
    expect(convertValue(email, 'Profe@Demo.co', { fix: true }).value).toBe('profe@demo.co');
  });

  it('NULL en NOT NULL y FK huérfana', () => {
    expect(convertValue({ kind: 'text', nullable: false, hasDefault: false }, null).issues[0]).toMatchObject({ code: 'NOT_NULL', fixed: false });
    expect(convertValue({ kind: 'text', nullable: false, hasDefault: true }, null, { fix: true }).value).toBe(DEFAULT);
    const fk = { kind: 'int', nullable: true, range: [-2147483648n, 2147483647n] };
    const orphans = new Set(['999']);
    expect(convertValue(fk, 999, { orphans }).issues[0].code).toBe('FK_ORPHAN');
    expect(convertValue(fk, 999, { orphans, fix: true }).value).toBeNull();
    expect(convertValue({ ...fk, nullable: false }, 999, { orphans, fix: true }).issues[0]).toMatchObject({ code: 'FK_ORPHAN', fixed: false });
    expect(convertValue(fk, 5, { orphans }).issues).toEqual([]);
  });
});

describe('representación canónica (suma de control por fila)', () => {
  it('origen MariaDB y destino PG renderizado coinciden', () => {
    const cases = [
      [{ kind: 'bool' }, 1, '1'],
      [{ kind: 'bool' }, 0, '0'],
      [{ kind: 'numeric' }, '400000.00', '400000.00'],
      [{ kind: 'numeric' }, '0.50', '0.5'],
      [{ kind: 'year' }, 2026, '2026'],
      [{ kind: 'int' }, '9007199254740993', '9007199254740993'],
      [{ kind: 'timestamp', zone: 'America/Bogota' }, '2026-03-05 00:00:00', '2026-03-05 00:00:00'],
      [{ kind: 'json' }, '{"b": 1, "a": [1, 2]}', { a: [1, 2], b: 1 }],
      [{ kind: 'bytes' }, Buffer.from('hi'), '6869'],
      [{ kind: 'text' }, 'ñandú', 'ñandú'],
      [{ kind: 'text' }, null, null],
    ];
    for (const [col, s, t] of cases) expect(canonicalSource(col, s)).toBe(canonicalTarget(col, t));
    expect(canonicalSource({ kind: 'bool' }, true)).toBe('1');
    expect(canonicalSource({ kind: 'bool' }, false)).toBe('0');
  });

  it('pgRenderExpr renderiza fechas en la zona de origen', () => {
    expect(pgRenderExpr({ name: 'payment_date', kind: 'timestamp', zone: 'America/Bogota', fsp: 0 }))
      .toBe(`to_char("payment_date" AT TIME ZONE 'America/Bogota', 'YYYY-MM-DD HH24:MI:SS')`);
    expect(pgRenderExpr({ name: 'x', kind: 'timestamp', zone: 'UTC', fsp: 3 })).toBe(`left(to_char("x" AT TIME ZONE 'UTC', 'YYYY-MM-DD HH24:MI:SS.US'), 23)`);
    expect(pgRenderExpr({ name: 'is_active', kind: 'bool' })).toContain("THEN '1'");
    expect(pgRenderExpr({ name: 'key', kind: 'text' })).toBe('"key"::text');
  });

  it('normalizeDecimal y canonicalJson', () => {
    expect(normalizeDecimal('0012.3400')).toBe('12.34');
    expect(normalizeDecimal('-0.00')).toBe('0');
    expect(normalizeDecimal('100')).toBe('100');
    expect(normalizeDecimal(null)).toBe('\\N');
    expect(canonicalJson({ b: { d: 1, c: [true, null] }, a: 'x' })).toBe('{"a":"x","b":{"c":[true,null],"d":1}}');
  });

  it('Digest no depende del orden y distingue contenidos', () => {
    const a = new Digest(); const b = new Digest(); const c = new Digest();
    ['1', '2', '3'].forEach((x) => a.add(x));
    ['3', '1', '2'].forEach((x) => b.add(x));
    ['1', '2', '4'].forEach((x) => c.add(x));
    expect(a.hex()).toBe(b.hex());
    expect(a.hex()).not.toBe(c.hex());
    expect(a.count).toBe(3);
    expect(new Digest().hex()).toBe('0'.repeat(32));
  });
});

describe('utilidades', () => {
  it('topoSort pone padres antes que hijos e ignora autorreferencias', () => {
    const order = topoSort(['payments', 'users', 'payment_applications', 'charges', 'entries'], [
      { table: 'payments', refTable: 'users' },
      { table: 'payment_applications', refTable: 'payments' },
      { table: 'payment_applications', refTable: 'charges' },
      { table: 'entries', refTable: 'entries' },
    ]);
    expect(order.indexOf('users')).toBeLessThan(order.indexOf('payments'));
    expect(order.indexOf('payments')).toBeLessThan(order.indexOf('payment_applications'));
    expect(order.indexOf('charges')).toBeLessThan(order.indexOf('payment_applications'));
    expect(order).toHaveLength(5);
  });

  it('topoSort no pierde tablas con ciclos', () => {
    expect(topoSort(['a', 'b'], [{ table: 'a', refTable: 'b' }, { table: 'b', refTable: 'a' }]).sort()).toEqual(['a', 'b']);
  });

  it('rowsPerInsert respeta 65535 parámetros', () => {
    expect(rowsPerInsert(1000, 10)).toBe(1000);
    expect(rowsPerInsert(1000, 100)).toBe(655);
    expect(rowsPerInsert(5, 0)).toBe(5);
  });

  it('looseKey imita utf8mb4_general_ci', () => {
    expect(looseKey('José  ')).toBe(looseKey('jose'));
    expect(looseKey('AL-1')).toBe('al-1');
    expect(looseKey('a ')).not.toBe(looseKey(' a'));
  });

  it('charLength cuenta puntos de código', () => {
    expect(charLength('😀a')).toBe(2);
  });
});
