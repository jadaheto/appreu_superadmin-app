import { describe, expect, it } from 'vitest';
import { UsageError, exitCode, parseCli } from '../src/args.js';

const base = ['--source', 'mysql://root:root@db:3306', '--target', 'postgres://postgres:postgres@pg:5432/postgres'];

describe('parseCli', () => {
  it('colegio: BD apreu_<slug> (guion -> guion bajo) y Bogotá por defecto', () => {
    const o = parseCli([...base, '--tenant', 'colegio-norte', '--create-db']);
    expect(o).toMatchObject({ sourceDb: 'apreu_colegio_norte', targetDb: 'apreu_colegio_norte', createDb: true, batch: 1000, datetimeZone: 'America/Bogota', master: false });
  });

  it('maestra: apreu_master y UTC por defecto', () => {
    expect(parseCli([...base, '--master'])).toMatchObject({ sourceDb: 'apreu_master', targetDb: 'apreu_master', datetimeZone: 'UTC' });
  });

  it('respeta --source-db, --target-db, --batch y banderas', () => {
    const o = parseCli([...base, '--tenant', 'demo', '--source-db', 'legacy_demo', '--target-db', 'apreu_demo2', '--batch', '250', '--fix', '--truncate', '--dry-run']);
    expect(o).toMatchObject({ sourceDb: 'legacy_demo', targetDb: 'apreu_demo2', batch: 250, fix: true, truncate: true, dryRun: true });
  });

  it('rechaza combinaciones inválidas', () => {
    expect(() => parseCli([...base])).toThrow(UsageError);
    expect(() => parseCli([...base, '--tenant', 'a', '--master'])).toThrow(UsageError);
    expect(() => parseCli([...base, '--tenant', 'Demo'])).toThrow(UsageError);
    expect(() => parseCli([...base, '--tenant', 'demo', '--batch', '0'])).toThrow(UsageError);
    expect(() => parseCli([...base, '--tenant', 'demo', '--target-db', 'x;drop'])).toThrow(UsageError);
    expect(() => parseCli(['--source', 'postgres://x', '--target', 'postgres://y', '--tenant', 'demo'])).toThrow(UsageError);
    expect(() => parseCli([...base, '--tenant', 'demo', '--verify-only', '--truncate'])).toThrow(UsageError);
    expect(() => parseCli([...base, '--tenant', 'demo', '--desconocida'])).toThrow();
  });

  it('códigos de salida', () => {
    expect(exitCode('ok')).toBe(0);
    expect(exitCode('dry_run')).toBe(0);
    expect(exitCode('conflicts')).toBe(2);
    expect(exitCode('target_not_empty')).toBe(3);
    expect(exitCode('verification_failed')).toBe(6);
    expect(exitCode('error')).toBe(1);
  });
});
