# Configuration-Driven Business Rules Framework

> Status: Draft — Phase 2
> Last updated: 2026-06-04
> This document describes how institutional business rules (assessment regulations, progression rules, classification algorithms) are modelled, stored, evaluated, and administered without code changes.

---

## Purpose

UK HE institutions apply materially different rules for the same academic processes: different pass marks, different classification boundaries, different compensation thresholds. These rules also change over time — a new programme regulation applies from a specific academic year while historical decisions remain governed by the rules in force at the time.

The configuration-driven rules framework allows institutions to configure their own rules as data, evaluated by a shared rules engine, without forking the codebase or writing code.

---

## Rule Types

| `rule_type_code` | Description | Applied by |
|---|---|---|
| `pass-mark` | Minimum mark required to pass a module | Assessment aggregation |
| `late-penalty` | Penalty applied per day/week late on submissions | Mark processing |
| `late-penalty-cap` | Maximum late penalty as % of available mark | Mark processing |
| `resit-mark-cap` | Maximum mark available on a resit attempt | Mark processing |
| `compensation-threshold` | Maximum fail margin eligible for compensation | Progression evaluation |
| `compensation-credit-limit` | Maximum credits that can be compensated per year | Progression evaluation |
| `condonement-threshold` | Maximum fail margin eligible for condonement | Progression evaluation |
| `progression-credit-requirement` | Minimum credits required to progress | Progression evaluation |
| `progression-pass-requirement` | Minimum module passes required per year | Progression evaluation |
| `classification-boundary` | Mark boundaries for each degree classification | Classification engine |
| `classification-algorithm` | Which years/stages contribute and at what weight | Classification engine |
| `classification-discretion-zone` | Borderline uplift zone width (e.g. 1% below boundary) | Classification engine |
| `award-credit-requirement` | Total credits required for a specific award | Award eligibility |

---

## Storage Model

Rules are stored bitemporally in the `academic_rule` table (see [data-model.md](data-model.md)). This allows:

- Different rules for different programmes within the same tenant.
- Rule changes that take effect from a specific academic year, while historical rules remain intact for reconstructing past decisions.
- Point-in-time rule lookup: "what classification algorithm applied to this student's entry cohort?"

```sql
-- Current pass mark for a specific programme
SELECT rule_value
FROM academic_rule
WHERE tenant_id    = $tenantId
  AND (programme_id = $programmeId OR programme_id IS NULL)   -- programme-specific first, then tenant default
  AND rule_type_code = 'pass-mark'
  AND rule_key     = 'undergraduate-default'
  AND valid_from  <= NOW() AND (valid_to IS NULL OR valid_to > NOW())
  AND recorded_at <= NOW() AND recorded_until IS NULL
ORDER BY programme_id NULLS LAST   -- programme-specific takes precedence
LIMIT 1;
```

### Rule value structure (`rule_value JSONB`)

Each rule type has a defined JSON schema for its value. Examples:

```jsonc
// pass-mark
{ "mark": 40, "unit": "percentage" }

// late-penalty
{ "penaltyPerDay": 5, "unit": "percentage-of-available-mark" }

// compensation-threshold
{ "maxFailMargin": 5, "unit": "percentage-points-below-pass-mark" }

// classification-boundary
{
  "boundaries": [
    { "code": "1",   "minimumMark": 70 },
    { "code": "2.1", "minimumMark": 60 },
    { "code": "2.2", "minimumMark": 50 },
    { "code": "3",   "minimumMark": 40 },
    { "code": "pass","minimumMark": 0  }
  ],
  "unit": "percentage"
}

// classification-algorithm
{
  "stages": [
    { "yearOfStudy": 3, "weight": 0.7 },
    { "yearOfStudy": 2, "weight": 0.3 }
  ],
  "method": "weighted-average"
}
```

---

## Rules Engine Design

The rules engine is a service in `apps/api/src/platform/rules-engine/`. It exposes a typed evaluation interface consumed by domain modules.

```typescript
// packages/domain/src/rules/types.ts
interface RuleContext {
  tenantId:    string;
  programmeId: string;
  asOfDate?:   Date;   // defaults to today — bitemporal lookup
}

interface RulesEngine {
  getPassMark(ctx: RuleContext, level: FheqLevel): Promise<number>;
  getLatePenalty(ctx: RuleContext): Promise<LatePenaltyRule>;
  getCompensationThreshold(ctx: RuleContext): Promise<CompensationRule>;
  getClassificationBoundaries(ctx: RuleContext): Promise<ClassificationBoundary[]>;
  getClassificationAlgorithm(ctx: RuleContext): Promise<ClassificationAlgorithm>;
  getProgressionRequirements(ctx: RuleContext, yearOfStudy: number): Promise<ProgressionRule>;
}
```

### Rule precedence

When evaluating a rule, the engine applies a two-level precedence:

1. **Programme-specific rule** (narrower): `programme_id IS NOT NULL AND programme_id = $programmeId`
2. **Tenant-wide default** (broader): `programme_id IS NULL`

The most specific matching rule wins. If no rule is found, the engine throws a `RuleNotConfiguredError` rather than silently defaulting.

### Caching

Rules are cached in memory per tenant with a 5-minute TTL. The cache is invalidated immediately when a rule is updated via the administration API. This means rule changes take effect within 5 minutes without a restart.

---

## Rule Administration API

Tenant administrators configure rules via a dedicated admin API endpoint.

```
GET    /api/v1/academic-rules?ruleType={type}&programmeId={id}
GET    /api/v1/academic-rules/:id
POST   /api/v1/academic-rules
PATCH  /api/v1/academic-rules/:id
```

Creating a rule:
```json
POST /api/v1/academic-rules
{
  "ruleTypeCode":  "pass-mark",
  "ruleKey":       "undergraduate-default",
  "programmeId":   null,
  "validFrom":     "2025-09-01",
  "validTo":       null,
  "ruleValue":     { "mark": 40, "unit": "percentage" },
  "description":   "Default undergraduate pass mark, all programmes"
}
```

Updating a rule (creating a new version with a new valid period):

`PATCH` on an active rule sets `validTo` on the current version and creates a new version:
```json
PATCH /api/v1/academic-rules/abc123
{
  "validFrom":  "2026-09-01",
  "ruleValue":  { "mark": 35, "unit": "percentage" }
}
```

This is implemented by the bitemporal update pattern — the old record gains `recorded_until = NOW()` and a new record is inserted. The prior rule remains queryable via `asOfDate`.

---

## Audit of Rule Changes

Every rule creation and update generates an audit record:
- `entity_type`: `academic_rule`
- `before_value`: previous rule value (null for new rules)
- `after_value`: new rule value
- `actor_id`: the Keycloak subject of the tenant administrator
- `reason_text`: required field on rule creation/modification

This provides a complete, immutable history of what rules applied when, and who changed them.

---

## Rule Validation

When a rule is submitted via the administration API, the rules engine validates:

1. The `rule_value` JSON conforms to the JSON Schema for the given `rule_type_code`.
2. There are no overlapping valid periods for the same `rule_type_code` + `rule_key` + `programme_id` combination.
3. The rule values are internally consistent (e.g. classification boundaries are monotonically decreasing).

Validation errors are returned as RFC 7807 `422 Validation Error` responses with field-level detail.
