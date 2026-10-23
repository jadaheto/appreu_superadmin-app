import type { SqlSession, TenantDatabaseConnector } from '../infrastructure/persistence/tenant-database-connector.js';

export interface RecordedQuery {
  session: string;
  sql: string;
  params: unknown[];
}

type Responder = (sql: string, params: unknown[]) => unknown[] | Error | undefined;

/** In-memory connector: records every statement and answers with a configurable responder. */
export class FakeTenantDatabaseConnector implements TenantDatabaseConnector {
  readonly queries: RecordedQuery[] = [];
  readonly opened: string[] = [];
  closed = 0;
  respond: Responder = () => [];
  failOpen: Error | null = null;

  async openServerSession(): Promise<SqlSession> {
    return this.session('server');
  }

  async openProvisioningSession(database: string): Promise<SqlSession> {
    return this.session(`provisioning:${database}`);
  }

  async openReadOnlySession(database: string): Promise<SqlSession> {
    return this.session(`readonly:${database}`);
  }

  sqlOf(session?: string): string[] {
    return this.queries.filter((q) => !session || q.session === session).map((q) => q.sql);
  }

  private session(name: string): SqlSession {
    if (this.failOpen) throw this.failOpen;
    this.opened.push(name);
    return {
      query: async <T>(sql: string, params: unknown[] = []) => {
        this.queries.push({ session: name, sql, params });
        const result = this.respond(sql, params);
        if (result instanceof Error) throw result;
        return (result ?? []) as T[];
      },
      close: async () => {
        this.closed++;
      },
    };
  }
}

/** Builds an error shaped like the ones thrown by `pg` (SQLSTATE in `code`) or by `net` (`ECONNREFUSED`). */
export const pgError = (code: string): Error =>
  Object.assign(new Error(`${code}: detalle interno host=db-secret`), { code });
