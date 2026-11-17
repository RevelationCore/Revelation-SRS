# Phase 4 Gap-Closure Decisions

> Status: Implemented (2026-11-17)
> Date: 2026-11-17
> Context: [Academic journey gap-closure plan](../product/academic-journey-gap-closure-plan.md), Phase 4 (rule depth in module selection and status)
> Made by: the project's solutions-architect agent (`.claude/agents/solutions-architect.md`). Numbering continues from [Phase 3](phase-3-gap-closure-decisions.md).

Each decision lists what an institution must confirm before go-live. All Phase 4 schema goes into one core migration, `0009_rule_depth.sql` (D-34).

## D-23: Which rule types are selection rules, and how the exit is checked

**Decision.**
- **A domain map.** `RULE_TYPE_DOMAIN: Record<RuleTypeCode, 'selection' | 'assessment' | 'progression' | 'award' | 'regulatory'>` and `SELECTION_RULE_TYPES` go in `apps/api/src/platform/rules-engine/engine.ts`. Because it is a `Record`, a new rule type that is left unclassified fails to compile.
- **The seven selection rule types:** `max-credits-per-period`, `credit-load-requirement`, `level-credit-requirement`, `adjacent-level-credit-limit`, `joint-honours-balance`, `repeat-module-requirement`, `timetable-clash-policy`.
- **The rest:**
  - Assessment: `pass-mark`, `late-penalty-rate`, `late-penalty-cap`, `resit-mark-cap`.
  - Progression: `compensation-threshold`, `compensation-credit-limit`, `condonement-threshold`, `progression-credit-requirement`, `progression-pass-requirement`.
  - Award: `classification-boundary`, `classification-algorithm`, `classification-discretion-zone`, `award-credit-requirement`.
  - Regulatory: `ukvi-attendance-threshold`.
- **Remove `late-penalty`.** It has no consumer, and the rate plus the cap replace it.
- **Selection evaluates `max-credits-per-period`** through `resolveForEnrolment`.
- **Confirmation is all or nothing.** It creates every registration in one transaction and does not re-check rules that validation already passed.
- **The exit test** builds a violating fixture for each type in `SELECTION_RULE_TYPES` and asserts that validation reports that `ruleTypeCode`.

**Why.**
- Prerequisites, co-requisites, exclusions and diet groups are relationships and groups, not rule types.
- BP-03-004 E2 forbids partial hidden registration. Today a `max-credits-per-period` failure at confirmation leaves the earlier registrations of the same proposal in place.

**Options considered.**
- Consuming all 22 rule types in selection: rejected, because assessment and progression rules mean nothing at selection.
- Keeping the exit as worded: rejected, because it cannot be checked honestly.

**Consequences.**
- The exit becomes "module-selection validation enforces every rule type in `SELECTION_RULE_TYPES`".
- Three non-selection types have no consumer: `progression-pass-requirement`, `classification-discretion-zone` and `award-credit-requirement`. They are listed under risks.

**Institution must confirm.** None. **Reversibility.** Cheap.

## D-24: Timetable data model, source and refresh (BP-03-006, BP-03-004 step 3)

**Decision.** Three new tables, each with row-level security by tenant.

`timetable_publication` is append-only. It holds:
- the academic period and the source (`ttb`, `srs-admin` or `simulator`);
- a `source_version`, unique per tenant and source;
- a `full_period` flag;
- `applied` or `rejected`, with the rejection reasons;
- the payload hash, the row count, who received it, and when it was received and applied.

`timetable_activity` holds:
- the offering and `activity_ref` (the timetabling system's stable id);
- the activity type, from the extensible value set `timetable-activity-type-code`;
- optional `group_set_code` and `group_code`. Activities of one offering that share a group set are alternative groups, and the student attends one.

`timetable_slot` holds:
- the day of the week (ISO 1–7) and the start and end times;
- `week_commencing`: an array of the Monday dates of the weeks it runs;
- a room code.

The weeks are concrete dates, so the core needs no institutional week numbering.

**Source.**
- The inbound flow is F-TTB-SIS-01, contract `timetable-publication.v1`, handled by a dedicated handler.
- The transport is either a manual file (the default) or an in-repo simulator that derives a plausible timetable from offerings. Admin entry writes a publication with source `srs-admin`, so every change is versioned.
- An offering reference is either an offering id or module code plus academic year plus period code. If any reference is ambiguous or unknown, the whole publication is rejected and the previous one stays current (BP-03-006 E4).

**Applying a publication.**
- A valid publication applies automatically. It replaces the activities of each offering it contains, or the whole period when `full_period` is set.
- An offering's current timetable comes from the latest applied publication that contains it.
- No second approver is needed: this is operational data, not a decision about a student.

**Refresh.**
- Each publication applies as it arrives.
- `timetabling.staleAfterHours` (default 168) marks a period whose timetable is stale.

**Permissions and portal.**
- New permissions `timetable:manage` and `timetable:read`.
- The portal timetable shows the slots of the student's registered offerings.

**Institution must confirm.** Its timetabling system and export, how often it publishes (daily is recommended during selection windows), and who uploads files. **Reversibility.** Cheap.

## D-25: What counts as a clash, and advisory versus blocking

**Decision.**

The `timetable-clash-policy` rule value is `{ policy, toleranceMinutes = 0, excludeActivityTypes = ['online-asynchronous', 'drop-in'] }`. When unconfigured, the policy is advisory.

Two slots clash when all of these hold:
- they belong to different offerings;
- they fall on the same day;
- their times overlap by more than the tolerance;
- they share a week;
- neither activity type is excluded.

Offerings are compared unit by unit. A unit is either a single activity or a whole group set. Two units clash only when every option in one clashes with every option in the other, so the student cannot pick a group that avoids the clash. This pairwise check never reports a false clash, but it can miss one that only arises across three or more group choices.

The check covers the proposal's items plus the student's current registrations in academic periods that overlap.

**Severity.**
- Advisory: a warning on both items, and the proposal goes ahead.
- Blocking: an error on both items, and the proposal is returned (E2).
- An offering with no published timetable gets a warning, never an error.
- Each message names both modules, the day, the time, the weeks and the publication.
- A side-effect-free validation preview shows clashes while the student is still choosing.
- Allocation (D-30) never allocates into a blocking clash.

**Institution must confirm.** Advisory or blocking for each programme, which activity types count, and the tolerance. **Reversibility.** Cheap.

## D-26: Provisioning registrations to timetabling (F-SIS-TTB-01, BP-03-006)

**Decision.**

A new delivery flow `F-SIS-TTB-01` (target `ttb`, state sync, producer `implemented`).

**Events.** `ModuleRegistrationService` sends an item, contract `timetable-demand-feed.v1`, wherever a registration is created, withdrawn or changes status.
- Subject: the module registration.
- Payload: action, registration, student number, offering, module code, academic year, period, status and effective date.
- No name, contact details or adjustment data.
- `pre-registration` enrolments send nothing.

**Snapshots.** `runTimetableDemandSnapshot(periodId)` sends one item per offering: the sorted student numbers, a count and a high-water mark.
- An unchanged roster is not re-sent.
- It runs on demand, when a selection window closes, and when an allocation run is applied.

**Acknowledgement.**
- The existing delivery acknowledgement counts as applied.
- `acknowledge` also accepts an optional `targetCount`. A snapshot acknowledged with a different count is recorded as failed with reason `count-mismatch`, and appears on the worklist (E5).

**Attendance.** Attendance is built into the SRS and reads registrations directly, so its target is "not applicable: internal".

**Consequences.** BP-03-006 moves from "Partly built" to "On screen (simulated link)". Registrations never change because a target failed (BR-4).

**Institution must confirm.** Events, snapshots or both; how often to reconcile; the service-level agreement. **Reversibility.** Cheap.

## D-27: Subject areas and joint-honours balance

**Decision.**

*Schema.*
- An extensible value set `subject-area-code`, defined by each tenant; demo data seeds examples.
- A bitemporal `module_subject` table: module, subject area and `proportion_percent`. A module's current rows must sum to 100.
- `module_group_member.counts_towards_subject_area_code` can count a cross-listed module wholly towards one subject in that diet.

*Rule.* `joint-honours-balance` is scoped to the programme, keyed `route:<routeCode>` and falling back to `default`. Its value is `{ components: [{ subjectAreaCode, minPercent, maxPercent }], countExemptions = true, unassigned = 'count-in-total' | 'ignore', tolerancePercent = 0 }`.

*Evaluation.*
- A subject's credit is the sum of credit × proportion over the proposal's items, the student's registrations in the year's other periods, and (when `countExemptions` is on) approved exemptions for that year.
- A component's share outside [min − tolerance, max + tolerance] is an error.
- A module with no subject rows draws a warning.
- The rule is evaluated only when it is configured.

**Why.** BP-03-004 step 2. HESA likewise holds subject at module level, with a proportion (ModuleSubject MODPROPORTION).

**Institution must confirm.** Its subject areas, the bounds for each combination and year, and how unassigned modules are treated. **Reversibility.** Cheap.

## D-28: Repeat-module requirement

**Decision.**

*Where "must repeat" comes from.* Only ratified progression outcomes count:
- `reassessment_plan` rows of type `repeat-module` with status `planned`, in the proposal's academic year (or, when a plan has no period, the first proposal after it was created);
- `repeat-stage` plans. When `repeatStageScope` is `failed-modules`, they expand to the modules failed in that stage.

Resits without attendance, referrals, deferrals and additional attempts need no teaching registration. They show as information only.

*Rule.* `repeat-module-requirement` (key `default`) has the value `{ maxRepeatCredits = null, allowReplacement = 'optional-only' | 'never' | 'any', countTowardsCreditLoad = true, repeatStageScope = 'failed-modules' }`. It applies even when unconfigured, using these defaults.

*Schema.*
- Proposal items gain `reassessment_plan_id` and `is_replacement`.
- `reassessment_plan` gains `repeat_module_registration_id`.
- The item source value set gains `repeat-required`.

*Check.*
- Compulsory population adds the required repeat items.
- Each plan is satisfied by an item for the same module, or by an allowed replacement. A replacement must:
  - come from the same diet group;
  - not come from a compulsory group;
  - not replace a non-condonable module;
  - carry at least the failed module's credit;
  - not be a module the student has failed.
- Anything else is an error. Repeat credit above the cap is an error.
- When `countTowardsCreditLoad` is false, repeat credit is left out of the credit totals.

*At confirmation.* The plan records the registration it produced, so its mark cap can apply to that registration's result.

**Institution must confirm.** Its replacement policy, any cap on repeat credit, whether repeat credit counts towards the load and towards funding, and the scope of a repeat stage. **Reversibility.** Cheap.

## D-29: Selection windows

**Decision.** Rename `registration_window` to `module_selection_window`. Each window has:
- an optional programme and optional FHEQ level;
- an optional `resubmission_closes_at`;
- an allocation mode (`first-come` or `ranked`; `ranked` is the default for new windows);
- an allocation seed;
- who created it.

*Resolving the window.* Overlapping windows with the same scope are refused. The most specific window wins: programme plus level, then programme, then level, then the whole period.

*When the window is checked.*
- Drafts can be created and edited at any time.
- A student's submission must fall inside the window. A returned proposal can be resubmitted until `resubmission_closes_at`.
- Direct registration requests use the same window.
- Confirming a validated or approved proposal, and applying an approved change, skip the window check. This fixes the failure when an approver decides after the window closes.

*Late submission.* Needs `module-selection:submit:late`, a reason from `late-selection-reason-code` and a note. Both are kept on the proposal.

*No window configured.* `moduleSelection.windowEnforcement` is `when-configured` (the default: no window means open) or `required`. It replaces `registrationWindowMode`. Existing windows become whole-period first-come windows. A tenant that used `academic-period` mode becomes `required`.

**Why.** BP-03-003 trigger, precondition 2 and BR-5. D-8 registration periods are a different process (annual confirmation, fee liability, lapse), so they are not reused.

**Institution must confirm.** Window dates for each cohort or level, the resubmission period, and who may submit late. **Reversibility.** Cheap now, costly after go-live.

## D-30: Ranked preference allocation for oversubscribed offerings

**Decision.**

*Ranked choices.*
- Proposal items gain `choice_slot`. Items that share a slot are ranked alternatives for one place, with `preference_rank` 1 as the first choice. Items without a slot are fixed.
- Submission validates the set made of each slot's first choice.
- In a ranked window, a valid submission skips the capacity check and moves to `awaiting-allocation`.

*The run.* `module_allocation_run` records the window, the kind (main or top-up), the status (previewed, submitted, approved, applied, superseded or rejected), the seed, `algorithm_version` (`rsd-1`), the priority order, an `inputs_hash`, the runner, the approver and when it was applied. `module_allocation_result` holds one row per proposal and slot: the item allocated or none, the outcome, the order position and the tier.

*The algorithm (`rsd-1`, random serial dictatorship).*
- Capacity is the offering's capacity minus its registrations.
- Fixed items are always placed. Compulsory overflow is reported, not refused.
- Students are ordered by priority tier (by default a higher stage first), then by HMAC-SHA256(seed, proposalId).
- In that order, each slot gets the student's highest-ranked alternative that has a place and introduces no blocking error. A blocking error is a relationship failure, a blocking clash, a joint-honours imbalance or a credit bound.
- Submission time plays no part.

*Students not fully allocated.*
- A proposal with every slot filled is confirmed when the run is applied.
- Otherwise it is returned (authority `allocation`), listing the unfilled slots and the offerings that still have places.
- The places it did get are held, and count against capacity, until `resubmission_closes_at`.
- A top-up run reuses the recorded order, so the run serves as the waitlist.

*Governance.*
- A holder of `module-selection:allocate` may preview runs.
- The runner submits one preview for review (GovernedReview family `module-allocation-run`). A `module-selection:decide` holder other than the submitter approves it.
- The run is applied only while `inputs_hash` still matches the current inputs.
- The seed is generated once per window and never changed.

*First-come windows, and tenants without windows,* keep the existing waitlisted approver route.

**Why.**
- BP-03-003 A3 and BP-03-004 A5.1.
- Random serial dictatorship is strategy-proof: ranking honestly is each student's best strategy.
- First-come disadvantages students with disabilities, caring responsibilities or poor connectivity, which is a risk under the Equality Act 2010.

**Institution must confirm.** Its priority tiers, whether a lottery is acceptable, how many alternatives students must give, how long allocated places are held, and who runs and who approves a run. **Reversibility.** Costly once results exist.

## D-31: Reduced-intensity study

**Decision.** This is a transfer case, not a new case type.
- `enrolment.study_intensity_percent` (1–100; null means 100) and `student_status_case.destination_study_intensity_percent`.
- A transfer must change at least one of programme, mode or intensity. Students may request it.

*Credit load.* The rule is looked up by `${mode}:${intensity}`, then `${mode}`, then `default`. A matched rule with `scaleByIntensity: true` that is not specific to an intensity is pro-rated: floor(min × i/100) and ceil(max × i/100).

*At decision.* The decision is refused while the student's later registrations exceed the new maximum. It lists the modules to withdraw; nothing is withdrawn automatically.

*SLC.*
- When the student has an SLC reference, a change of study arrangement raises an `slc-confirmation` trigger, `change-of-mode-or-intensity`.
- The decider is warned below 25% intensity, the minimum for a part-time loan in England.

*UKVI.* A sponsored student moving away from full-time needs a compliance assessment that supports the change.

*HESA and finance.* The enrolment's versions keep mode and intensity with their effective dates.

**Institution must confirm.** Its allowed intensities, the pro-rata rule, whether fees are recalculated mid-year, and with its HESA team how a mid-session change is returned. **Reversibility.** Cheap.

## D-32: Transfer credit mapping (credit transfer and RPL)

**Decision.** Reuse `recognised_credit`.

*Internal transfer, a status-case outcome.*
- On a transfer, the destination academic proposes `recognised_credit` rows of type `internal-transfer`. Each is linked to the case and maps to a destination module or stands as general credit.
- A new column, `source_module_result_id`, records where the credit came from.
- The transfer cannot be decided while a linked mapping is still proposed.
- Mappings are approved by an `academic-exception:approve` holder who is not the proposer.

*External RPL.* Stays outside status cases. `evidence_ref` becomes mandatory for `rpcl`, `rpel` and `transfer-in`.

*Mapping.* Any approved recognised credit with a module acts as a module mapping, whatever its basis.

*Effect.*
- Mapped credit satisfies diet groups, the minimum load and repeat requirements.
- It carries no mark into classification.

**Institution must confirm.** Its RPL cap, whether final-stage credit can be recognised, and whether same-module marks carry across a transfer. **Reversibility.** Cheap.

## D-33: Which rule types join ENROLMENT_RULE_FIELDS

**Decision.**
- Add `'joint-honours-balance': ['tolerancePercent']`, `'repeat-module-requirement': ['maxRepeatCredits']` and `'timetable-clash-policy': []`.
- An empty field list means the rule can only be waived.
- A waiver of the clash policy turns blocking clashes into warnings, which are still shown.
- Windows and allocation are not rules: late submission and the approver route cover them.

**Institution must confirm.** Who approves exceptions to each rule. **Reversibility.** Cheap.

## D-34: Migrations

**Decision.**
- Commit the squash first: 0008 and 0009 become `0008_admissions_registration_and_integrations`.
- All Phase 4 schema goes in `0009_rule_depth.sql`, journal idx 9.
- The core set is then at 10 files again, so the next migration must squash first.

## Build order

S0 foundation (D-23); S1 windows (D-29); S2 repeat (D-28); S3 joint honours (D-27); S4 timetable and clashes (D-24, D-25); S5 timetabling provisioning (D-26); S6 ranked allocation (D-30); S7 reduced intensity and credit mapping (D-31, D-32). The D-33 entries land with each rule's slice.

## Risks

1. Partial confirmation (fixed in S0).
2. The window check at confirmation (fixed in S1).
3. The `academic-rule-type-code` value set does not match `RuleTypeCode`. It is aligned in 0009.
4. HESA SBJCA is mapped from `owning_school`, not HECoS with proportions. That belongs to HESA work.
5. Period versus year. The year-level credit and joint-honours checks assume a proposal covers the whole year, or that the year's other periods are already registered.
6. `progression-pass-requirement`, `classification-discretion-zone` and `award-credit-requirement` have no consumer.
7. First-come capacity is counted without a lock. The offering row is locked at confirmation.

## Implementation notes

The core migration set is at 10 of 10 again, so the next migration must squash first.

- **D-34: migrations.**
  - The squash was committed separately (`0008_admissions_registration_and_integrations`), with schema and data identical per `scripts/verify-migration-squash.sh`.
  - `0009_rule_depth` holds all Phase 4 schema. It also adds `module_selection_proposal.fheq_level`, the student's current level, which window scoping and allocation tiers need, and `module_selection_proposal_item.held_until` for held allocated places.
  - The `academic-rule-type-code` value set now lists the 21 engine rule types, each tagged with its domain. The six old category codes are retired.
- **D-23: rule-type domains.**
  - `RULE_TYPE_DOMAIN` and `SELECTION_RULE_TYPES` are in `rules-engine/engine.ts`, and `late-penalty` is removed.
  - Confirmation goes through `ModuleRegistrationService.confirmSelection`: one transaction, no rule re-checks.
  - An automatic first-come confirmation locks the offerings and recounts places. If the last place has gone, the proposal routes to the approver instead.
  - The exit test is `apps/api/test/selection-rule-coverage.int.test.ts`. It is read through the new `GET /module-selection-proposals/:id/validation` preview, because proposal-level errors otherwise reach only `decisionReason`.
- **D-29: selection windows.**
  - The service is `module-selection/window-service.ts` and the routes are `/module-selection-windows`. `/registration-windows` is gone: a breaking change, acceptable in Alpha.
  - Direct registration requests use whole-programme windows, because their level is not known.
- **D-28: repeat modules.**
  - Plans are read from `reassessment_plan`, and `repeat-stage` failures come from current `module_result` rows (`fail`, `resit-required`) in the decision's year.
  - **Not built:** the plan's mark cap is recorded against the repeat registration, but `module-result-service` does not yet apply it.
- **D-27: joint honours.**
  - Subjects are managed on Programme rules. The value set has no seed rows, so each tenant adds its own.
  - Exemptions count by their module's subjects.
- **D-24 and D-25: timetables and clashes.**
  - The routes are `/timetable-publications`, `/academic-periods/:id/timetable-simulation`, `/academic-periods/:id/timetable-status` and `/module-offerings/:id/timetable`.
  - The manual file is a JSON upload. CSV is not accepted.
  - Clash messages name the overlap and cite the publications.
- **D-26: timetabling provisioning.**
  - The producer is `delivery/producers/timetable-demand.ts`, called from every registration create, confirm and transition.
  - The snapshot runs through `POST /delivery-flows/F-SIS-TTB-01/run` and after an applied allocation. It does not yet run automatically when a window closes.
  - `acknowledge` accepts `targetCount`.
- **D-30: ranked allocation.**
  - The service is `module-selection/allocation-service.ts`, with routes under `/module-selection-windows/:id/allocation-runs` and `/allocation-runs/:id`.
  - Submission starts a GovernedReview of family `module-allocation-run` (seeded in `0009_rule_depth`, now `0008_registration_integrations_and_rule_depth`), with a task for `programme-approver` and on Temporal when the tenant's rollout selects it. The approver must hold `module-selection:decide` and be neither the runner nor the submitter; the effect checks that again and re-checks `inputs_hash`, so a refused approval leaves the review open for a rejection. Applying is safe to repeat: a retried activity resumes with the proposals not yet confirmed or returned. Only one run per window may await a decision. (First delivered as a direct check; brought into line with this decision on 2026-11-17.)
  - Alternatives are blocked by a blocking clash, an exclusion, or carrying more credit than their slot's first choice. That is an approximation of "no blocking errors" that avoids judging a partial selection against minimum bounds.
  - Priority comes from `moduleSelection.allocation.priority`, defaulting to stage descending. `minAlternatives` is not enforced.
- **D-31: reduced intensity.**
  - `study_intensity_percent` is carried on every enrolment version.
  - The 25% SLC warning appears on the case.
  - **Not done:** HESA `mapMode` still reads the current version, not the session's, and the change is not yet sent to finance as a fee recalculation beyond the existing F-SIS-FIN-01 snapshot.
- **D-32: transfer credit mapping.**
  - `approvedExemptionsFor` now treats any approved credit with a module as a mapping.
  - **Not done:** a transcript and HEAR line for recognised credit, and `recognisedCreditExcluded` in the classification evidence. Classification already ignores recognised credit, because it averages module outcomes only.
