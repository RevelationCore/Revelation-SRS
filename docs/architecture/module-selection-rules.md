# Module Selection Rules

> Status: Implemented (stages 1–6 below); not yet formally reviewed
> Last updated: 2026-08-02
> Resolves: BP-03-002 OQ-1; BP-03-003 OQ-1; BP-03-004 OQ-1, OQ-2 (partial)

---

## Implementation status (2026-08-02)

Stages 1–6 are built and tested (migration `0005_module_selection_rules.sql`,
`RulesEngine` extensions, `ModuleSelectionService`, portal/admin UI, demo data).
Known gaps, tracked in BP-03-003/BP-03-004 as BR-5/BR-6 rather than silently
assumed:

- **Timetable clash detection** — `timetable-clash-policy` is configurable
  (advisory/blocking) but nothing evaluates it yet: there is no timetable-slot
  data model to detect an actual clash against (BP-03-004 BR-5/OQ-2).
- **Joint-honours balance** — the `joint-honours-balance` rule type exists for
  admins to configure, but `validateSelection` doesn't consume it: there is no
  "subject area" attribute on programme/module to make the check real.
- **Repeat-module requirement** — the `repeat-module-requirement` rule type
  exists but isn't wired to progression/fail data.
- **Ranked/oversubscribed preference allocation** — `preference_rank` is
  captured on `module_selection_proposal_item` but not consumed; oversubscription
  today is all-or-nothing per module (capacity conflict → waitlist → approver
  decision), not a ranked allocation across competing students.
- **Selection windows** — proposals can be created at any time; no
  open/close enforcement per period/cohort yet.

## Purpose

Today Revelation enforces almost none of the rules that govern which modules a
student may actually combine. This document catalogues the rules UK HE
providers commonly apply to module selection, then describes how they are
modelled in the SRS so a student's selection is validated deterministically
against their programme's rules — extending the existing
[configuration-driven rules framework](configuration-rules-framework.md)
rather than replacing it.

---

## 1. What the system enforces today

| Rule | Where | Note |
|---|---|---|
| Enrolment must be active | `ModuleRegistrationService.createRegistration` | — |
| No duplicate active registration for the same offering | `#ensureNoDuplicateCurrentRegistration` | — |
| Offering capacity not exceeded | `#ensureCapacityAvailable` | First-come, no waitlist |
| Prerequisite / co-requisite / exclusion relationships | `#ensureModuleRulesSatisfied`, `module_relationship` table | — |
| Flat maximum credits per period | `#ensureCreditLimitNotExceeded` via `RulesEngine.getMaxCreditsPerPeriod` (`academic_rule`, `rule_type_code = 'max-credits-per-period'`) | Single number, not level- or route-aware |

Everything else — core vs. optional diets, minimum credit loads, level
composition, joint-honours balance, non-condonable modules, part-time
pro-rata, PSRB-mandated modules, exception/approval — is **undocumented and
unenforced**. `programme_rule_set` exists as a bitemporal, route/entry-year
scoped row but carries only a free-text `rule_set_code` — no actual rule
content. Registrations are also created as `registered` immediately; there is
no proposal, validation, or approval stage, despite BP-03-003/004 describing
one.

---

## 2. Rules UK HE institutions commonly apply (research)

This is the standard sector pattern (QAA credit framework / FHEQ, condensed
from typical UK provider academic regulations — England, Scotland, Wales, NI
all follow variants of the same shape):

| Category | Typical rule | Sector variation |
|---|---|---|
| **Credit load** | Full-time study = 120 UK credits/year (60 ECTS); part-time is pro-rata (e.g. 60 credits/year at 50% FTE) | Some providers set load per semester/trimester rather than per year |
| **Module size** | Modules are typically 10, 15, 20, 30, 40 or 60 credits | Institution-specific; some mandate a single size (e.g. all 20-credit) |
| **Compulsory (core) modules** | Auto-allocated, not chosen, usually non-substitutable | Some providers allow substitution with approval |
| **Optional/elective pools** | "Choose N modules from group X" or "choose ≥Y credits from group X" | Pools may be ranked with oversubscription/waitlist allocation |
| **Level composition** | Credits must sit predominantly at the student's current FHEQ level (4/5/6 for UG, 7 for PGT); a bounded number of credits may be taken at an adjacent level (e.g. up to 20 credits at level below/above) | "Trailing" rules for carrying failed lower-level modules into the next year vary a lot by provider |
| **Non-condonable/core-to-pass modules** | Certain modules (esp. PSRB-mandated) must be passed outright — cannot be compensated/condoned even if the overall year passes | Common in accredited programmes (engineering, nursing, law, teacher training) |
| **PSRB-mandated modules** | Professional body accreditation can force specific modules into the compulsory diet regardless of programme design | Applies only to accredited routes; must be traceable to the accrediting body |
| **Joint/combined honours balance** | E.g. 50/50, 60/40 credit split between two subject areas per year, sometimes with a minimum "major" credit floor | Institution- and combination-specific |
| **Progression-linked selection constraints** | A student repeating a failed module must include it (or its designated replacement) in next selection; some providers cap total repeat credit | Ties selection to progression/resit outcomes |
| **Timetable/assessment clash** | Advisory warning at selection; hard block is less common but some providers enforce it for core-timetabled cohorts | BP-03-004 OQ-2 already flags this as an open policy choice |
| **Cross-school/external module approval** | Modules taught outside the owning school/teaching unit may need extra sign-off | — |
| **Capacity & oversubscription** | Waitlist with ranked preference and defined allocation priority (e.g. cohort year, random draw, first-come) | — |
| **Placement/study-abroad years** | Replace the normal diet with a placement-specific rule set (often pass/fail, 0 or reduced credit-bearing) for that year only | — |
| **Recognition of Prior Learning (RPL) / credit transfer** | Recognised credit reduces the credit a student must newly select in a given period | — |
| **Selection windows & deadlines** | Fixed open/close dates per period, sometimes per cohort/level | — |

These map closely to what BP-03-003/BP-03-004 already describe qualitatively
(BR-1–BR-4 in each) but with no data model behind them.

---

## 3. Proposed data model additions

Everything below is bitemporal, tenant-scoped, and follows the existing
`version_id`/`id`/`valid_from`/`valid_to`/`recorded_at`/`recorded_until`
pattern already used throughout `packages/db/migrations`.

### 3.1 Give `programme_rule_set` actual content: module diet groups

```
module_group
  id, tenant_id, programme_rule_set_id, fheq_level_id?  -- which stage/year this group applies to
  group_code, title
  group_type            -- 'compulsory' | 'optional-pool' | 'elective-pool'
  min_modules, max_modules        -- nullable; count-based constraint
  min_credits, max_credits        -- nullable; credit-based constraint
  min_fheq_level, max_fheq_level  -- bounds for modules drawn into this group (adjacent-level trailing)

module_group_member
  id, tenant_id, module_group_id, module_id
  is_default            -- true for compulsory auto-allocation
  is_non_condonable     -- true = must be passed outright, cannot be compensated
```

`programme_rule_set` already carries `programme_route_id` and
`entry_academic_year`, so a diet is automatically route- and cohort-versioned
— a curriculum revision creates a new `programme_rule_set` + new
`module_group` rows, and existing students keep the version they were bound
to (this is exactly the guarantee BP-03-002 is written to protect).

### 3.2 Bind the enrolment to its route and rule set (resolves BP-03-002 OQ-1)

```
enrolment_curriculum_binding   -- new bitemporal table, one row per enrolment period of applicability
  id, tenant_id, enrolment_id
  programme_route_id, programme_rule_set_id
  decision_authority     -- 'automatic' | 'registry-administrator' | 'academic-approver'
  decision_reason
  valid_from, valid_to, recorded_at, recorded_until
```

Kept as a separate table (rather than a column on `enrolment`) because the
binding can change on an authorised transfer while enrolment itself doesn't
otherwise version at that granularity, and because it needs its own
decision/authority provenance per BP-03-002 BR-4.

### 3.3 Selection proposal workflow (resolves BP-03-003 OQ-1, BP-03-004 OQ-1)

```
module_selection_proposal
  id, tenant_id, enrolment_id, academic_period_id
  programme_rule_set_id      -- pinned at proposal creation (BP-03-003 E4)
  status                     -- 'draft' | 'submitted' | 'validated' | 'approved' |
                              --  'returned' | 'waitlisted' | 'rejected' | 'confirmed'
  submitted_at, decided_at, decision_authority, decision_reason

module_selection_proposal_item
  id, tenant_id, proposal_id, module_id, module_offering_id?
  preference_rank            -- for ranked/oversubscribed options; null for compulsory/single-choice
  source                     -- 'compulsory-auto' | 'student-choice' | 'staff-assisted'
  validation_state           -- 'pending' | 'passed' | 'failed'
  validation_messages        -- jsonb array of rule-check results, for student-facing feedback
```

`module_registration` remains the confirmed, downstream-facing record
(unchanged shape); it is only created once a proposal reaches `approved`/
`confirmed`, closing the gap BP-03-004 BR-4 flags today (registrations
currently skip straight to `registered`).

### 3.4 Non-condonable flag reused elsewhere

`module_group_member.is_non_condonable` should be read by the existing
progression/compensation rules described in
[configuration-rules-framework.md](configuration-rules-framework.md) —
compensation/condonement evaluation must exclude any module flagged
non-condonable regardless of fail margin.

---

## 4. New rule types on the existing `academic_rule` framework

Add to the rule-type table in `configuration-rules-framework.md` rather than
inventing a second rules mechanism:

| `rule_type_code` | Description | Applied by |
|---|---|---|
| `credit-load-requirement` | Min/max total credits per period, per mode of study (pro-rata for part-time) | Selection validation |
| `level-credit-requirement` | Minimum credits that must sit at the enrolment's current FHEQ level per period | Selection validation |
| `adjacent-level-credit-limit` | Maximum credits permitted from an adjacent level (trailing) | Selection validation |
| `joint-honours-balance` | Required credit split between two subject areas, with a minimum "major" floor | Selection validation |
| `repeat-module-requirement` | Failed modules that must reappear in the next selection, and any cap on total repeat credit | Selection validation, fed by progression outcomes |
| `timetable-clash-policy` | `advisory` or `blocking`, settable per tenant/programme | Selection validation (resolves BP-03-004 OQ-2) |

`max-credits-per-period` (already implemented) is superseded conceptually by
`credit-load-requirement` but can stay as-is or be migrated — not a blocker
either way.

These follow the same precedence (programme-specific over tenant-wide),
bitemporal versioning, and JSON-Schema-validated `rule_value` already
described in the framework doc — no new storage mechanism, just new
`rule_type_code` values and their schemas.

---

## 5. Rules engine extension

Add to `RulesEngine` (`apps/api/src/platform/rules-engine/engine.ts`):

```typescript
interface RulesEngine {
  // existing methods unchanged...
  getModuleDiet(ctx: RuleContext, routeId: string, ruleSetId: string, periodId: string): Promise<ModuleGroup[]>;
  getCreditLoadRequirement(ctx: RuleContext, modeOfStudy: string): Promise<CreditLoadRule>;
  getLevelCreditRequirement(ctx: RuleContext, fheqLevel: number): Promise<LevelCreditRule>;
  getTimetableClashPolicy(ctx: RuleContext): Promise<'advisory' | 'blocking'>;
  validateSelection(proposal: ModuleSelectionProposal): Promise<SelectionValidationResult>;
}
```

`validateSelection` is the single entry point BP-03-004 step 2 calls: it
evaluates group membership, count/credit bounds per group, level composition,
joint-honours balance, repeat-module inclusion, prerequisite/co-requisite/
exclusion (existing logic, reused as-is), capacity, and timetable policy —
returning a structured list of pass/fail results per proposal item, which is
what populates `module_selection_proposal_item.validation_messages` for
student-facing feedback (BP-03-003 step 4).

Exceptions (BP-03-004 A5b) are recorded as an approval decision against a
specific rule + proposal item, with authority and rationale — never by
mutating the underlying rule.

---

## 6. Build stages (all delivered 2026-08-02)

1. **Schema** ✅ — `module_group`, `module_group_member`, `enrolment_curriculum_binding`, `module_selection_proposal`, `module_selection_proposal_item`, `programme_rule_set` CRUD (migration `0005_module_selection_rules.sql`); new `rule_type_code` values.
2. **Rules engine** ✅ — `getCreditLoadRequirement`, `getLevelCreditRequirement`, `getAdjacentLevelCreditLimit`, `getTimetableClashPolicy` on `RulesEngine`; diet/credit/level/relationship/capacity checks in `ModuleSelectionService#validateSelection`.
3. **Service layer** ✅ — proposal create/add-item/remove-item/submit/decide; `module_registration` rows are created only from `#confirmProposal`, called after automatic (A4) or approved (A5) validation, reusing `ModuleRegistrationService.createRegistration` (with `skipCapacityCheck` for an authorised waitlist allocation).
4. **Approval workflow** ✅ — not a bespoke Temporal workflow (no Temporal worker/client actually runs in this codebase today — see `WorkflowBridgeService`); instead uses the same DB-backed workflow-instance/task/decision-audit bridge every other Revelation domain workflow uses (`module-selection-approval` definition, seeded in the migration).
5. **Portal/admin UI** ✅ — `apps/portal` `ModuleSelectionPage` (proposal-based selection, additive alongside the existing direct `ModuleAddPage`); `apps/admin` `ModuleSelectionProposalsPage` for approve/return/reject decisions (the generic Task Inbox lists the underlying workflow task but can't record a decision, since that requires proposal-specific business logic).
6. **Demo data & docs** ✅ — `packages/demo-data` S3 scenario gained a `diet-groups` phase (BSc Computer Science level-4 core + optional groups) and a validator; this doc and BP-03-002/003/004 updated to close their Open Questions (see "Implementation status" above for what remains open).
