import type { Db } from '@revelation-srs/db';

import type { ValidationIssue } from '../validation/types.js';

/**
 * What each import phase loaded and why any row was not loaded (BL-385).
 *
 * The whole import runs in one transaction. Each row is written in its own
 * savepoint: in PostgreSQL a failed statement aborts the enclosing
 * transaction, so without one, every later row would fail too and the commit
 * would silently roll back everything the report counted as loaded.
 */
export class ImportLog {
  readonly #counts = new Map<string, { loaded: number; failed: number }>();
  readonly issues: ValidationIssue[] = [];

  #count(entity: string): { loaded: number; failed: number } {
    let c = this.#counts.get(entity);
    if (c === undefined) { c = { loaded: 0, failed: 0 }; this.#counts.set(entity, c); }
    return c;
  }

  counts(entity: string): { loaded: number; failed: number } {
    return { ...this.#count(entity) };
  }

  entities(): string[] {
    return [...this.#counts.keys()];
  }

  /** A row not loaded because something it refers to was not loaded. */
  unresolved(entity: string, externalId: string, message: string): void {
    this.#count(entity).failed++;
    this.issues.push({ code: 'UNRESOLVED_REFERENCE', severity: 'error', entity, externalId, message });
  }

  /**
   * Write one row in a savepoint and say whether it was loaded. On failure
   * the savepoint is rolled back, the row is counted as failed with the
   * database's reason, and the import carries on.
   */
  async row(db: Db, entity: string, externalId: string, write: (tx: Db) => Promise<void>): Promise<boolean> {
    try {
      await db.transaction(async (sp) => write(sp as unknown as Db));
      this.#count(entity).loaded++;
      return true;
    } catch (err) {
      this.#count(entity).failed++;
      this.issues.push({
        code: 'ROW_LOAD_FAILURE', severity: 'error', entity, externalId,
        message: `${entity} ${externalId} was not loaded: ${reason(err)}`,
      });
      return false;
    }
  }
}

/**
 * The database's reason, without the query and its parameters: a query
 * error's own message repeats the statement and every value in the row, which
 * is the personal data being migrated, and the report is written to a file.
 * The database's message may still name the one value it rejected.
 */
function reason(err: unknown): string {
  const cause = err instanceof Error && err.cause instanceof Error ? err.cause : err;
  if (!(cause instanceof Error)) return String(cause);
  const code = (cause as { code?: unknown }).code;
  const message = cause.message.startsWith('Failed query:') ? 'query failed' : cause.message;
  return typeof code === 'string' ? `${message} (SQLSTATE ${code})` : message;
}
