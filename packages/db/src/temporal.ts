import { randomUUID } from 'node:crypto';

import { and, gt, isNull, lte, or, sql } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import type { PgDatabase, PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core';

/**
 * Standard columns for every bitemporal table.
 *
 * Physical PK: version_id — unique row identifier.
 * Logical ID:  id          — stable entity identifier shared by all versions.
 *
 * See docs/architecture/data-model.md §Bitemporal Pattern.
 */
export const bitemporalColumns = {
  versionId:     uuid('version_id').primaryKey().defaultRandom(),
  id:            uuid('id').notNull(),
  validFrom:     timestamp('valid_from',    { withTimezone: true }).notNull(),
  validTo:       timestamp('valid_to',      { withTimezone: true }),
  recordedAt:    timestamp('recorded_at',   { withTimezone: true }).notNull().defaultNow(),
  recordedUntil: timestamp('recorded_until',{ withTimezone: true }),
};

/**
 * Raw SQL constraints to execute after CREATE TABLE for every bitemporal table.
 * Cannot be expressed as Drizzle column definitions because they are
 * index-level constraints, not column-level.
 */
export function bitemporalConstraintsSql(tableName: string): string {
  return `
    ALTER TABLE "${tableName}"
      ADD CONSTRAINT "${tableName}_temporal_check_valid"
        CHECK (valid_to IS NULL OR valid_to > valid_from),
      ADD CONSTRAINT "${tableName}_temporal_check_recorded"
        CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

    CREATE UNIQUE INDEX "${tableName}_unique_logical_transaction"
      ON "${tableName}" (tenant_id, id, recorded_at);

    CREATE UNIQUE INDEX "${tableName}_current_version_unique"
      ON "${tableName}" (tenant_id, id)
      WHERE recorded_until IS NULL;
  `;
}

/** Drizzle helper: the four bitemporal column references on a table. */
type BitemporalTable = {
  id:            { readonly _: { readonly dataType: 'string' } };
  validFrom:     { readonly _: { readonly dataType: 'date' } };
  validTo:       { readonly _: { readonly dataType: 'date' } };
  recordedAt:    { readonly _: { readonly dataType: 'date' } };
  recordedUntil: { readonly _: { readonly dataType: 'date' } };
  tenantId:      { readonly _: { readonly dataType: 'string' } };
  [col: string]: unknown;
};

/** WHERE clause selecting the current state of a logical entity. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function currentVersionWhere(table: BitemporalTable, logicalId: string, tenantId: string): any {
  return and(
    sql`${table.id as unknown as ReturnType<typeof uuid>} = ${logicalId}`,
    sql`${table.tenantId as unknown as ReturnType<typeof uuid>} = ${tenantId}`,
    isNull(table.recordedUntil as unknown as ReturnType<typeof timestamp>),
  );
}

/** WHERE clause for a point-in-time read (valid time + transaction time). */
export function pointInTimeWhere(
  table: BitemporalTable,
  options: {
    logicalId?: string;
    tenantId?:  string;
    validAt?:   Date;
    recordedAt?: Date;
  },
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  const vt = options.validAt  ?? new Date();
  const tt = options.recordedAt ?? new Date();

  return and(
    options.logicalId
      ? sql`${table.id as unknown as ReturnType<typeof uuid>} = ${options.logicalId}`
      : undefined,
    options.tenantId
      ? sql`${table.tenantId as unknown as ReturnType<typeof uuid>} = ${options.tenantId}`
      : undefined,
    lte(table.validFrom  as unknown as ReturnType<typeof timestamp>, vt),
    or(
      isNull(table.validTo  as unknown as ReturnType<typeof timestamp>),
      gt(table.validTo  as unknown as ReturnType<typeof timestamp>, vt),
    ),
    lte(table.recordedAt  as unknown as ReturnType<typeof timestamp>, tt),
    or(
      isNull(table.recordedUntil  as unknown as ReturnType<typeof timestamp>),
      gt(table.recordedUntil  as unknown as ReturnType<typeof timestamp>, tt),
    ),
  );
}

/**
 * Perform a bitemporal update:
 * 1. Close the current version  (set recorded_until = now)
 * 2. Insert a new version with the same logical id and patched values.
 *
 * Runs inside a transaction. Throws if no current version is found.
 */
export async function bitemporalUpdate<
  TTable extends PgTableWithColumns<TableConfig>,
>(
  db: PgDatabase<Record<string, unknown>>,
  table:     TTable,
  logicalId: string,
  tenantId:  string,
  patch:     Partial<Record<string, unknown>>,
  validFrom?: Date,
  validTo?:   Date | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const now = new Date();

    // 1. Close current version
    await tx.execute(
      sql`UPDATE ${table}
          SET recorded_until = ${now}
          WHERE id = ${logicalId}
            AND tenant_id = ${tenantId}
            AND recorded_until IS NULL`,
    );

    // 2. Read what we just closed to carry forward unchanged fields
    const rows = await tx.execute(
      sql`SELECT * FROM ${table}
          WHERE id = ${logicalId}
            AND tenant_id = ${tenantId}
            AND recorded_until = ${now}
          LIMIT 1`,
    ) as Array<Record<string, unknown>>;

    if (rows.length === 0) {
      throw new Error(`bitemporalUpdate: no current version for id=${logicalId} tenant=${tenantId}`);
    }

    const current = rows[0] as Record<string, unknown>;

    // 3. Build the new version row
    const newRow: Record<string, unknown> = {
      ...current,
      ...patch,
      version_id:     randomUUID(),
      recorded_at:    now,
      recorded_until: null,
      valid_from:     validFrom ?? current['valid_from'],
      valid_to:       validTo !== undefined ? validTo : current['valid_to'],
    };

    // Build dynamic INSERT
    const cols = Object.keys(newRow).map((k) => `"${k}"`).join(', ');
    const vals = Object.values(newRow);
    const placeholders = vals.map((_, i) => `$${i + 1}`).join(', ');

    await tx.execute(
      sql.raw(`INSERT INTO "${(table as unknown as { _: { name: string } })._.name}" (${cols}) VALUES (${placeholders})`, vals),
    );
  });
}
