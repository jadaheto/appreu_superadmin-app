import { readdir, readFile } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import { Inject, Injectable } from '@nestjs/common';
import { ENVIRONMENT, type Environment } from '../../../../shared/infrastructure/config/environment.js';

export interface SqlScript {
  /**
   * Version recorded in `schema_migrations` of the school database: the file
   * name without `.sql` (`tenant-schema`, `001-identity-…`).
   */
  version: string;
  /** File name, used in reports and error messages. */
  name: string;
  content: string;
  /** `true` for the consolidated schema, `false` for the migrations applied after it. */
  baseline: boolean;
}

/** Supplies the SQL that installs a school database. */
export interface SchemaScriptLoader {
  /** Consolidated schema first, then the migrations ordered by their numeric prefix. */
  load(): Promise<SqlScript[]>;
}

export const SCHEMA_SCRIPT_LOADER = Symbol('SchemaScriptLoader');

const MIGRATION_FILE = /^\d{3,}-[a-z0-9-]+\.sql$/i;

const versionOf = (file: string): string => basename(file).replace(/\.sql$/i, '');

/**
 * Reads `database/postgres/tenant-schema.sql` (`TENANT_SCHEMA_FILE`) and every
 * `NNN-*.sql` of `TENANT_MIGRATIONS_DIR` (`database/postgres/migrations`).
 * The numeric prefix is global, so the lexical order of zero-padded names is
 * the application order.
 */
@Injectable()
export class FileSchemaScriptLoader implements SchemaScriptLoader {
  constructor(@Inject(ENVIRONMENT) private readonly env: Environment) {}

  async load(): Promise<SqlScript[]> {
    const schemaPath = resolve(this.env.provisioning.schemaFile);
    const scripts: SqlScript[] = [
      {
        version: versionOf(schemaPath),
        name: basename(schemaPath),
        content: await readFile(schemaPath, 'utf8'),
        baseline: true,
      },
    ];

    const dir = this.env.provisioning.migrationsDir;
    if (dir) {
      const files = (await readdir(resolve(dir))).filter((file) => MIGRATION_FILE.test(file)).sort();
      for (const file of files) {
        scripts.push({
          version: versionOf(file),
          name: file,
          content: await readFile(join(resolve(dir), file), 'utf8'),
          baseline: false,
        });
      }
    }
    return scripts;
  }
}
