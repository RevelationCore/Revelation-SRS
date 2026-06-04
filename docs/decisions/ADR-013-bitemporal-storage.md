# ADR-013: Bitemporal Storage Pattern

**Status**: Accepted
**Date**: 2026-06-04

## Context

Core principle §3 requires bitemporal data storage for all temporally mutable records. Several implementation patterns are possible in PostgreSQL: separate history tables, period columns with `tstzrange`, a single table with four timestamp columns, or a temporal extension.

## Decision

**Four-column approach** using explicit `TIMESTAMPTZ` columns: `valid_from`, `valid_to`, `recorded_at`, `recorded_until`.

```sql
valid_from      TIMESTAMPTZ NOT NULL,
valid_to        TIMESTAMPTZ,           -- NULL = still valid
recorded_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
recorded_until  TIMESTAMPTZ            -- NULL = current record
```

Open-ended records use `NULL` (not a sentinel date like `9999-12-31`) for both `valid_to` and `recorded_until`.

## Rationale

- **Explicit and readable**: column semantics are immediately clear to any developer or DBA; no need to understand `tstzrange` operators.
- **Standard SQL**: no dependency on PostgreSQL-specific range type operators for the common case; compatible with standard ANSI SQL temporal queries.
- **Drizzle ORM support**: `TIMESTAMPTZ` columns map cleanly to Drizzle's `timestamp` with timezone type; `tstzrange` requires custom type handling.
- **Indexing**: individual `TIMESTAMPTZ` columns are indexed with standard B-tree indexes; range type indexes (`GiST`) are less familiar and harder to tune.
- **Null for open-ended**: using `NULL` for open-ended records is semantically clearer than a sentinel date; queries that check `valid_to IS NULL` read as "currently valid" without magic constants.

## Alternatives Considered

| Pattern | Reason rejected |
|---|---|
| `tstzrange` PostgreSQL range type | Cleaner for overlap exclusion constraints; but requires GiST indexes, custom Drizzle handling, and less readable queries |
| Separate history tables | Double the table count; more complex migrations; harder to query across time |
| Temporal extension (e.g. `temporal_tables`) | Adds a PostgreSQL extension dependency; limited community; partially automates history but reduces transparency |

## Consequences

- All bitemporal tables include the four columns via the `bitemporalColumns` Drizzle helper defined in `packages/db/src/temporal.ts`.
- `UPDATE` is never used on bitemporal rows. The `bitemporalUpdate()` helper in `packages/db` encapsulates the correct pattern (set `recorded_until`, insert new row).
- Point-in-time queries use the standard four-predicate pattern defined in [data-model.md](../architecture/data-model.md).
- Drizzle migrations for bitemporal tables always include `NOT NULL DEFAULT now()` on `recorded_at` and no default on `valid_from` (application sets it explicitly).
