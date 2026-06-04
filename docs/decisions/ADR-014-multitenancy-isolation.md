# ADR-014: Multi-Tenancy Data Isolation Pattern

**Status**: Accepted
**Date**: 2026-06-04

## Context

Core principle §10 requires complete data isolation between tenants enforced at the database layer. Three patterns are viable in PostgreSQL: separate databases per tenant, separate schemas per tenant, or shared schema with row-level security (RLS).

## Decision

**Shared schema with PostgreSQL Row-Level Security (RLS)**.

Every user-data table includes `tenant_id UUID NOT NULL`. A RLS policy on every table restricts queries to rows matching the `tenant_id` set in the session variable `app.current_tenant_id`.

```sql
SET app.current_tenant_id = '<tenant-uuid>';

CREATE POLICY tenant_isolation ON enrolments
  USING (tenant_id = current_setting('app.current_tenant_id', true)::uuid);
```

## Rationale

- **Operational simplicity**: one schema, one set of migrations, one connection pool. Separate databases or schemas per tenant multiply operational overhead linearly with tenant count.
- **Strong isolation**: RLS is enforced by PostgreSQL itself, independent of application code. Even a bug in application-layer tenant filtering cannot leak data across tenants.
- **Tested pattern**: PostgreSQL RLS is mature, well-documented, and used in production by SaaS products at scale.
- **Migration simplicity**: a single `drizzle-kit migrate` applies to all tenants simultaneously. Schema-per-tenant requires running migrations N times.
- **Connection pooling**: shared schema works with a single connection pool (PgBouncer or pg built-in pooling). Separate databases require per-tenant pools.

## Alternatives Considered

| Pattern | Reason rejected |
|---|---|
| Separate database per tenant | Strongest isolation; prohibitive operational overhead; separate backups, connection pools, and migrations per tenant |
| Schema per tenant | Better than separate databases; still N migrations; no cross-tenant analytics possible; Drizzle doesn't natively support runtime schema switching |
| Application-layer filtering only (no RLS) | Insufficient: a single bug in tenant filtering exposes all tenants' data; rejected by principle §10 |

## Consequences

- Every user-data table has `tenant_id UUID NOT NULL REFERENCES tenant(id)`.
- Every table with user data has an RLS policy created in the migration that creates the table.
- The application sets `app.current_tenant_id` on every connection checked out from the pool, derived from the authenticated JWT `tenant_id` claim.
- The `system_administrator` PostgreSQL role is granted `BYPASSRLS` for platform-level operations (tenant provisioning, cross-tenant analytics). All such operations are audit-logged.
- A penetration test verifying cross-tenant isolation is required before production release (NFR-SEC-010).
- The `tenant_id` column is included in the leading position of all composite indexes on user-data tables.
