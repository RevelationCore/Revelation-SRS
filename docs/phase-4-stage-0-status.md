# Phase 4 Stage 0 Status

> Date: 2026-06-05
> Scope: stabilise the current Phase 4 draft before continuing feature work.

## Baseline Decisions

- Generated build artefacts are not part of the source baseline. The existing `.gitignore` excludes `dist/`, `build/`, declaration maps, JavaScript maps, and `*.tsbuildinfo`.
- Testcontainers-backed suites require Docker socket access. In this environment, Docker is available through OrbStack, but sandboxed commands cannot access the socket. The full test and integration suites were therefore verified with escalated Docker access.
- Phase 4 remains in progress. Student identity, enrolment, programme/module catalogue, academic calendar, module registration, and tenant administration have executable API coverage; OpenAPI output, event consumer tests, and admin UI remain incomplete.

## Stabilisation Fixes Applied

- `StudentService.createPerson()` now runs under `withTenantContext()` so student creation follows the same tenant/RLS pattern as Phase 4 reads and updates.
- Student number sequence handling now matches Drizzle/postgres result shape and guards against an empty sequence result.
- `requirePermission()` now completes the Fastify pre-handler lifecycle for authorised requests. Previously, authorised protected routes could hang until test timeout while forbidden requests returned correctly.
- Enrolment transition route aliases now match the documented/tested API verbs:
  - `/enrolments/:id/intermit`
  - `/enrolments/:id/withdraw`
  - `/enrolments/:id/graduate`
  - `/enrolments/:id/reinstate`

## Verification

All Stage 0 verification commands pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:int`

Docker/Testcontainers verification covered:

- Phase 3 and Phase 4 migrations
- bitemporal helper behaviour
- RLS isolation behaviour
- student identity integration tests
- enrolment lifecycle integration tests

## Remaining Phase 4 Work

- Add event consumer tests for Phase 4 domain events.
- Add versioned OpenAPI output.
- Build the admin UI for student identity and enrolment management.

## Stage 1 Identity Core

> Date: 2026-06-05
> Scope: close the student identity core before moving deeper into enrolment and catalogue work.

Stage 1 is complete.

### Implemented

- Student identity writes now validate configured value-set-backed codes before persistence.
- Student create/update flows validate HESA gender, nationality, and domicile codes where supplied.
- Student address writes validate address type codes.
- Disability declaration writes validate disability category and declaration status codes.
- Student API reads now include explicit tenant predicates as well as tenant-context/RLS execution, so privileged test/admin connections cannot accidentally leak records across tenants.
- HESA student identifier can be updated through `PATCH /api/v1/students/:personId/hesa-id` and is returned by the student record endpoint.
- Identity verification checks can be requested, completed, and listed through:
  - `POST /api/v1/students/:personId/identity-verifications`
  - `POST /api/v1/students/:personId/identity-verifications/:verificationCheckId/completion`
  - `GET /api/v1/students/:personId/identity-verifications`
- Identity verification request/completion paths audit writes and publish Phase 4 identity verification domain events when the event bus is connected.

### Verification Added

- Invalid coded personal data values return `422`.
- Invalid identity update coded values return `422`.
- Cross-tenant student access returns `404`.
- HESA ID update is persisted and returned by the student endpoint.
- Identity verification request, completion, current-state listing, and duplicate completion rejection are covered by API integration tests.

### Stage 1 Verification

All verification commands pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:int`

## Stage 2 Enrolment Lifecycle

> Date: 2026-06-05
> Scope: complete and harden the current enrolment lifecycle before catalogue and module-registration work.

Stage 2 is complete.

### Implemented

- Enrolment writes now validate configured value-set-backed mode of study and funding source codes.
- Enrolment reads now include explicit tenant predicates as well as tenant-context/RLS execution.
- Enrolment creation now generates a durable fee liability ledger row for F009.
- Enrolment creation now creates durable downstream trigger ledger rows for:
  - UCAS enrolment confirmation (`ucas-confirmation`, F046)
  - SLC enrolment confirmation (`slc-confirmation`, F049)
  - UKVI CAS request trigger (`ukvi-cas`, F051)
- Enrolment status transitions now preserve SLC/UCAS references across bitemporal versions.
- Enrolment status transitions now record reason code, reason text, actor, and effective time in an append-only transition ledger.
- Enrolment lifecycle APIs now expose:
  - `GET /api/v1/enrolments/:enrolmentId/history`
  - `GET /api/v1/enrolments/:enrolmentId/transitions`
  - `GET /api/v1/enrolments/:enrolmentId/fee-liabilities`
  - `GET /api/v1/enrolments/:enrolmentId/downstream-triggers`
- Domain events were added for fee liability and downstream trigger creation.

### Verification Added

- Invalid enrolment coded values return `422`.
- Cross-tenant enrolment access returns `404`.
- Fee liability rows are generated on enrolment creation.
- UCAS, SLC, and UKVI downstream trigger rows are generated when applicable.
- Bitemporal enrolment history exposes all status versions.
- Transition ledger exposes reason code/text.
- Event publishing is covered with a fake event bus consumer test for student enrolment, fee liability, and downstream trigger events.

### Stage 2 Verification

All verification commands pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:int`

## Stage 3 Catalogue and Calendar

> Date: 2026-06-05
> Scope: implement programme/module catalogue and academic calendar APIs.

Stage 3 is complete.

### Implemented

- Programme catalogue APIs now support create, list, current read, bitemporal update, and history.
- Module catalogue APIs now support create, list, current read, bitemporal update, and history.
- Learning outcomes can be created and listed for either a programme or module.
- Module prerequisite/co-requisite/exclusion relationships can be created and listed.
- Academic periods can be created, listed, filtered by academic year, and read by id.
- Module offerings can be created, listed, filtered by academic period/module, and read by id.
- Programme, module, academic period, and module offering APIs use explicit tenant predicates as well as tenant-context/RLS execution.
- Programme/module/calendar write paths record audit entries.

### Verification Added

- Programme creation, retrieval, bitemporal update, history, and cross-tenant isolation.
- Module creation, bitemporal update/history, relationships, learning outcomes, and cross-tenant isolation.
- Academic period creation/retrieval.
- Module offering creation/listing and cross-tenant isolation.

### Stage 3 Verification

All verification commands pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:int`

## Stage 4 Module Registration

> Date: 2026-06-05
> Scope: implement module selection/registration, rule checks, confirmation state, and timetable data provision.

Stage 4 is complete.

### Implemented

- Module registration `501` stubs were replaced with tenant-scoped API routes.
- Module registrations now support create, list, current read, bitemporal history, withdrawal, and completion.
- Registration creation validates active enrolment status, academic-period registration window, duplicate registrations, offering capacity, prerequisites, co-requisites, and exclusions.
- Timetable-oriented registration data is exposed for active registered module offerings.
- Module registration write paths record audit entries.
- Domain event payload contracts were added for module registration and withdrawal.

### Verification Added

- Successful module registration and timetable data feed.
- Bitemporal withdrawal and history exposure.
- Cross-tenant registration isolation.
- Duplicate registration and capacity rejection.
- Academic-period window validation.
- Prerequisite and exclusion rule enforcement.

### Stage 4 Verification

Verification commands pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/module-registrations.int.test.ts --reporter=verbose`
- `pnpm test`
- `pnpm test:int`

## Stage 5 Tenant Administration

> Date: 2026-06-05
> Scope: implement tenant provisioning, tenant configuration management, and configuration-scoped academic rule management.

Stage 5 is complete.

### Implemented

- System administrators can create, list, read, update, activate, and deactivate tenants.
- Tenant administrators can read and merge tenant-local configuration.
- Academic rules can be created, listed, read, updated bitemporally, and read through history endpoints.
- Academic rule writes invalidate the in-memory rules-engine cache for the tenant.
- Tenant and academic-rule write paths record audit entries.
- Tenant provisioning uses `tenant:manage`; tenant configuration uses `config:write`; academic rules use `rule:read` and `rule:write`.

### Verification Added

- System-administrator tenant provisioning and update coverage.
- Tenant-administrator provisioning denial.
- Tenant configuration read and merge coverage.
- Academic-rule create/list/read/update/history coverage.
- Academic-rule cross-tenant isolation.

### Stage 5 Verification

Verification commands pass:

- `pnpm typecheck`
- `pnpm lint`
- `pnpm --filter @revelation-srs/api exec vitest run --config vitest.int.config.ts test/tenant-admin.int.test.ts --reporter=verbose`
