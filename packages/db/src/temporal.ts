import { randomUUID } from 'node:crypto';

import { and, gt, isNull, lte, or, sql, type SQL, type SQLWrapper } from 'drizzle-orm';
import { timestamp, uuid } from 'drizzle-orm/pg-core';
import type { PgTableWithColumns, TableConfig } from 'drizzle-orm/pg-core';

import type { Db } from './pool.js';

/**
 * Standard columns for every bitemporal table.
 *
 * Physical PK: version_id - unique row identifier per recorded version.
 * Logical ID:  id          - stable entity identifier shared by all versions.
 *
 * See docs/architecture/data-model.md sectionBitemporal Pattern.
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
 * SQL constraints for every bitemporal table - applied in migrations, not by
 * Drizzle column definitions, because they involve partial/expression indexes.
 * Also used in Testcontainers test setup for ephemeral tables.
 */
export function bitemporalConstraintsSql(tableName: string): string {
  return `
    ALTER TABLE "${tableName}"
      ADD CONSTRAINT "${tableName}_temporal_check_valid"
        CHECK (valid_to IS NULL OR valid_to > valid_from),
      ADD CONSTRAINT "${tableName}_temporal_check_recorded"
        CHECK (recorded_until IS NULL OR recorded_until > recorded_at);

    CREATE UNIQUE INDEX IF NOT EXISTS "${tableName}_unique_logical_transaction"
      ON "${tableName}" (tenant_id, id, recorded_at);

    CREATE UNIQUE INDEX IF NOT EXISTS "${tableName}_current_version_unique"
      ON "${tableName}" (tenant_id, id)
      WHERE recorded_until IS NULL;
  `;
}

// Minimal structural interface for a bitemporal Drizzle table's column objects.
type BitemporalTable = {
  id:            SQLWrapper;
  tenantId:      SQLWrapper;
  validFrom:     SQLWrapper;
  validTo:       SQLWrapper;
  recordedAt:    SQLWrapper;
  recordedUntil: SQLWrapper;
  [col: string]: unknown;
};

/**
 * WHERE clause returning the current state of a logical entity.
 *
 * "Current" means:
 *   - transaction-time current: recorded_until IS NULL
 *   - valid-time current:       valid_from <= now AND (valid_to IS NULL OR valid_to > now)
 *
 * Use pointInTimeWhere() for historical reads.
 */
export function currentVersionWhere(table: BitemporalTable, logicalId: string, tenantId: string): SQL | undefined {
  const now = new Date();
  return and(
    sql`${table.id} = ${logicalId}`,
    sql`${table.tenantId} = ${tenantId}`,
    isNull(table.recordedUntil),
    lte(table.validFrom, now),
    or(
      isNull(table.validTo),
      gt(table.validTo, now),
    ),
  );
}

/**
 * WHERE clause for a point-in-time read on both axes.
 *
 * validAt    - the valid-time query point (default: now)
 * recordedAt - the transaction-time query point (default: now)
 */
export function pointInTimeWhere(
  table: BitemporalTable,
  options: {
    logicalId?:  string;
    tenantId?:   string;
    validAt?:    Date;
    recordedAt?: Date;
  },
): SQL | undefined {
  const vt = options.validAt   ?? new Date();
  const tt = options.recordedAt ?? new Date();

  return and(
    options.logicalId ? sql`${table.id} = ${options.logicalId}` : undefined,
    options.tenantId  ? sql`${table.tenantId} = ${options.tenantId}` : undefined,
    lte(table.validFrom, vt),
    or(isNull(table.validTo), gt(table.validTo, vt)),
    lte(table.recordedAt, tt),
    or(isNull(table.recordedUntil), gt(table.recordedUntil, tt)),
  );
}

/**
 * Perform a bitemporal update:
 * 1. Close the current transaction-time row (set recorded_until = now).
 * 2. Insert a new version with the same logical id and patched field values.
 *
 * Runs inside a single transaction. Throws if no transaction-current row
 * exists for the given logical id and tenant.
 *
 * validFrom / validTo optionally override the valid-time window.
 * If not supplied, the values from the closed row are carried forward.
 */
export async function bitemporalUpdate<
  TTable extends PgTableWithColumns<TableConfig>,
>(
  db:        Db,
  table:     TTable,
  logicalId: string,
  tenantId:  string,
  patch:     Partial<Record<string, unknown>>,
  validFrom?: Date,
  validTo?:   Date | null,
): Promise<void> {
  await db.transaction(async (tx) => {
    const now       = new Date();
    const tableName = (table as unknown as { _: { name: string } })._.name;

    // 1. Close the current version (recorded_until IS NULL)
    const closeResult = await tx.execute(
      sql`UPDATE ${table}
          SET recorded_until = ${now}
          WHERE id = ${logicalId}
            AND tenant_id = ${tenantId}
            AND recorded_until IS NULL
          RETURNING *`,
    ) as Array<Record<string, unknown>>;

    if (closeResult.length === 0) {
      throw new Error(
        `bitemporalUpdate: no transaction-current version found for id=${logicalId} tenant=${tenantId} in table ${tableName}`,
      );
    }

    const closed = closeResult[0] as Record<string, unknown>;

    // 2. Compose the new version row
    const newRow: Record<string, unknown> = {
      ...closed,
      ...patch,
      version_id:     randomUUID(),
      recorded_at:    now,
      recorded_until: null,
      valid_from:     validFrom ?? closed['valid_from'],
      valid_to:       validTo !== undefined ? validTo : closed['valid_to'],
    };

    // 3. Insert with parameterised values. Column names come from the row
    // returned by PostgreSQL plus caller patch keys, so callers must use
    // physical snake_case column names when patching.
    const cols = Object.keys(newRow).map((k) => `"${k}"`).join(', ');
    const vals = Object.values(newRow).map((value) => sql`${value}`);

    await tx.execute(
      sql`INSERT INTO ${table} ${sql.raw(`(${cols})`)} VALUES (${sql.join(vals, sql`, `)})`,
    );
  });
}
