# Valid Values Review

## Summary

The valid-value/value-set direction is sound. A central `value_set`, `value_set_member`, and `field_value_set` model is the right foundation for fixed statutory codes, SRS internal enumerations, UI dropdowns, API validation, and historical reconstruction.

The implementation is currently a partial scaffold. It should not yet be treated as authoritative HESA coding support or as enforced validation for Phase 4 writes.

## What Is In Place

| Area | Current state |
|---|---|
| Schema | `value_set`, `value_set_member`, and `field_value_set` exist in Drizzle schema and migration. |
| RLS | `value_set_member` allows platform values plus tenant-specific extension values. |
| Seed data | Initial HESA and SRS internal value sets are seeded. |
| Field mapping | `field_value_set` maps a small number of Phase 3 fields to value sets. |
| API/service | `ValueSetService` and value-set routes exist. |
| Extensibility | Tenant-specific extensions are supported for value sets marked extensible. |

## Gaps To Close

### VV-001 - Complete API wiring

The route file and service are not registered in `buildApp()`. Add:

- `ValueSetService` construction and `fastify.decorate('valueSetService', valueSetService)`
- Fastify type augmentation for `valueSetService`
- `await fastify.register(valueSetsRoutes, { prefix: '/api/v1' })`
- tests for list, lookup, field mapping, 404, tenant extension, and permission enforcement

### VV-002 - Fix request typing and tenant-scoped access

Value-set member RLS is tenant-aware, but the service uses `this.db` directly and manually mirrors tenant filters. Decide whether value-set reads intentionally bypass RLS with explicit predicates, or whether route handlers should call the service through `request.withDb`.

Completion requirement:

- document the chosen access pattern
- test platform values plus tenant extension visibility through API calls
- prove tenant A cannot see tenant B extension values

### VV-003 - Treat HESA seed data as non-authoritative until sourced and completed

The seed migration labels HESA sets as `2024-25`, but only includes selected values for some sets. It defines empty/catalogue-only HESA sets for domicile and nationality with no members. The 2026 project state should not assume a 2024-25 subset is sufficient for future HESA submission work.

Completion requirement:

- define whether Phase 3 only establishes the value-set framework or must seed complete statutory reference data
- if seeding statutory data in Phase 3, load the complete official HESA/Jisc values for the active collection year
- store source URL/version/retrieval date in `source_metadata` or a separate `reference_data_source` table
- add tests that required HESA sets are non-empty and versioned

### VV-004 - Expand field mappings beyond Phase 3 tables

`field_value_set` currently maps only audit, integration, and one value-set metadata field. It does not yet map the major `_code` fields already named in `docs/architecture/data-model.md`, such as:

- `person_identity.gender_code`
- `person_identity.ethnicity_code`
- `person_identity.domicile_code`
- `programme.qualification_type_code`
- `award.qualification_code`
- `disability_declaration.disability_category_code`
- `enrolment.status_code`
- `module_registration.status_code`
- `mark.status_code`
- HESA, SLC, UKVI, CAS, visa, attendance, hold, and document status fields

Completion requirement:

- generate a review list of every `_code` column in `data-model.md`
- classify each as platform-fixed, statutory-versioned, tenant-extensible, or free text
- add `field_value_set` mappings for all fields that are fixed/controlled

### VV-005 - Add write-time validation pattern

`ValueSetService.validateFieldValue()` exists, but no write services use it. Database-level constraints also do not enforce value membership.

Completion requirement:

- define a standard service/repository validation step for every `_code` write
- add a domain validation error when a code is inactive or unknown
- decide whether critical platform tables should also use database constraints/triggers for defence in depth
- add tests for unknown code, retired code, future-active code, tenant extension, and non-extensible set rejection

### VV-006 - Add lifecycle management for retired and replaced values

The model has `active_from` and `active_to`, which is good. Missing pieces:

- no API to retire a tenant extension value
- no explicit replacement/supersedes relationship
- cache keys use raw Date object stringification for historical lookups
- no audit of tenant value additions or retirements

Completion requirement:

- add retirement/update APIs for tenant-extensible sets
- include `activeAt` normalized ISO/date in cache keys
- audit all tenant value-set changes
- preserve retired values for historical reads

### VV-007 - Add value-set tests

There are currently no value-set tests.

Minimum tests:

- migration seeds expected sets
- list value sets
- get active members as tenant A
- tenant A cannot see tenant B extensions
- non-extensible HESA set rejects tenant extension
- extensible set accepts tenant extension
- historical `activeAt` lookup includes retired values only in the correct interval
- `validateFieldValue()` returns `true`, `false`, and `null` correctly

## Recommended Scope Decision

For Phase 3, it is acceptable to finish the value-set framework and seed only the Phase 3 platform codes if the roadmap explicitly defers full HESA/Jisc reference data ingestion to Phase 6 regulatory compliance.

If the project wants HESA values now, the seed must be complete, sourced, versioned, and verified against the official current collection-year coding manual before Phase 3 is closed.

