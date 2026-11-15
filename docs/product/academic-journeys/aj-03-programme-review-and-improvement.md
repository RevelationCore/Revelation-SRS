# AJ-03 — Evidence becomes improvement

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Shared-module change](aj-02-shared-module-change.md)

**Perspective:** Aisha, student representatives, the external examiner and a quality-review panel. **Boundary:** period-specific evidence through a reasoned improvement proposal, approved future release and later effectiveness review. **Timeline:** first-year review t+40 to t+88 for entry 2033 at t+156; first-graduate review t+144 to t+160. All weeks retain the [2030 anchor](README.md#timeline-convention).

## The story

### Review what is actually known — t+40 to t+44

After first-stage results are published, Aisha opens `REVIEW-EDS-2031-001`. The pack identifies the 2030 cohort, applicable curriculum, source cut-off and calculation definitions. It contains first-year attainment/progression, demand, appropriately aggregated student feedback and external-examiner comments. It contains no completion or graduate-outcome claim: nobody in the new course has graduated yet.

A defined synthetic feedback summary and sampled assessment evidence suggest students struggle to interpret statistical uncertainty. These are issues to investigate, not a claim that one module caused poor results. Student representatives explain how teaching and assessment felt in practice. Small-group results and personal support/case details are withheld or suppressed under the agreed disclosure rules.

### Translate concerns into owned actions — t+44 to t+50

The panel distinguishes an operational fix from an academic change. A confusing timetable message goes to the delivery owner. Statistics content and criteria need module review, so Aisha commissions AJ-02. Each action has an owner, intended evidence, affected population and review date. Closing the review meeting does not mark those actions complete.

The first module proposal introduces a prerequisite that breaks concurrent first-year study. The panel returns that part for rework. It also asks Aisha to show that every permitted programme route still assesses the programme outcomes, and that existing students and returners retain a deliverable completion route.

### Reassemble the whole course — t+74 to t+78

AJ-02 returns approved `SCI440@2.0`, the reworked design and legacy-delivery commitments. Aisha assembles the programme proposal for entry 2033: `NBU-EDS@2.0`, `EDS-FT@2.0` and `EDS-2033@1.0`. Other module versions, the 360-credit structure and the compulsory project's ethics hurdle remain as specified. The programme version changes because its dependency set changes, even though its title and total credits do not.

The review pack repeats the ten valid pathway checks and the two combinations that fail the existing `EDS570` prerequisite for `EDS660`. The Statistics change must not erase that rule. It identifies the current full-time cohorts, Jo's separate part-time route and Omar's return plan as protected existing bindings, not automatic members of the new release. The part-time route keeps `EDS-PT@1.0` for its existing students. Recruiting to it on version 1 alongside full-time version 2 would be a permitted, governed coexistence; Northbridge instead chooses, for resourcing reasons, to close it to new entry from 2033. Closure instruction `CLOSE-EDS-PT-2033@1` is approved with the release at t+84 by the same panel, with the admissions policy owner's agreement. It names the affected intakes (2033 onwards), leaves the 2031 and 2032 part-time students untouched, and says how deferral requests into 2033 are handled. A part-time version 2 would need its own proposal and approval.

### Approval has content, authority and conditions — t+78 to t+84

The panel reviews the exact revised content, consultation responses, delivery/resources, public-information impacts and transition analysis. Academic and student contributors can challenge the evidence; the author cannot approve her own proposal. Minutes distinguish a panel decision from the secretary recording it.

At t+84 the properly constituted panel approves the frozen manifest after required conditions have been verified. Any material content change after that point returns to the appropriate review route. A date on the plan or an overdue task cannot substitute for an approval decision. This story adopts AJ-01's governance pattern rather than granting an analytics dashboard publication authority.

### Publish a future release and verify each destination — t+86 to t+88

The publisher previews and authorises `REL-EDS-2033-01`. SRS accepts the complete dependency closure atomically at t+86. Public specification `PROS-EDS-2033@1.0` is published at t+88 (31 May 2032) for entry t+156, with the correct intake, approved wording and publication receipt. The date is set by the recruitment cycle: summer open days and the September opening of 2033-entry applications need the approved course, and the main path does not advertise before approval. The specification states that 2033 entry is full-time only, but the prospectus is not the closure: Admissions must first confirm that the 2033 part-time intake is closed on every application channel. SRS acceptance, public availability, recruitment permission and academic applicability are separately recorded.

If the prospectus rejects a field, its task remains owned while the accepted catalogue stays intact. The relevant recruitment gate remains blocked until required destinations reconcile. Jo and Omar do not inherit new rules because the latest web page changes. Geography needs its own release to adopt version 2; it cannot be changed through EDS's approval.

### Find out whether the action worked — t+144 to t+160 and later

When the first cohort's awards are available, Aisha opens a new period-specific review using actual ratified outcomes. Ben's later award is pending until his supplementary and conferral decisions exist; it cannot be backfilled into an earlier snapshot as if already known. Sensitive individual circumstances remain outside general programme dashboards.

The panel can now examine the original cohort's completion evidence, but cannot claim the 2033 Statistics revision improved it: that cohort has not yet studied the revision. Effectiveness review for the changed module is scheduled after its first actual delivery and assessment. The first-graduate review may raise further actions, each with its own evidence and approval path.

The [AJ-04 closure and teach-out story](aj-04-closure-and-teach-out.md) expands the approved part-time closure, channel checks and remaining-study commitments without changing this release’s dates.

## Starting pack and authority

Supply period/cohort-bound aggregate datasets, metric definitions, external review and representative feedback, existing curriculum manifests and approved review policy. Where AJ-35 is not yet expanded, use labelled synthetic aggregate inputs and record the unresolved collection/analytics contract. Aisha owns the proposal, data owners attest sources, reviewers make academic decisions, resource owners commit delivery and publishers own release authority. BI and survey tools cannot decide changes.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A03-01 | t+40 to t+44 | Assemble first-year evidence and student interpretation. | Versioned review pack with no premature graduate claims. |
| A03-02 | t+44 to t+50 | Classify concerns and commission module work. | Owned actions; AJ-02 rework tracked. |
| A03-03 | t+74 to t+78 | Integrate approved module and validate complete future course. | Exact new manifest, pathway checks and legacy commitments. |
| A03-04 | t+78 to t+84 | Review, verify conditions and approve. | Frozen academic version and attributable authority. |
| A03-05 | t+86 to t+88 | Accept release and reconcile public destinations. | Future 2033 course published; old bindings retained. |
| A03-06 | t+144 to t+160 | Review actual first-graduate outcomes with new cut-offs. | New evidence period and actions; no claim of effects before delivery. |
| A03-07 | After t+156 delivery/assessment | Review the changed module's actual operation. | Evidence-based action closure or further proposal; exact review date configured. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A03-I01 / F-SIS-CM-01 | SRS → CM review: permitted cohort/period/version metrics with source cut-off and definitions. | Evidence snapshot + review scope; source data authority. | Reproducible aggregate receipt; stale or mismatched periods rejected. |
| A03-I02 / F-SETS-SIS-01; GI-21 | Survey/evidence owners → controlled review inputs: aggregates, external findings and scoped consultation responses. | Source summary version + review; respective owners. | Provenance and disclosure review; no raw sensitive case dump. AJ-35's wider analytics process remains separate. |
| A03-I03 / A02-I04; CM-WF-005 | Module owner → programme review: approved definition/manifest and verified legacy conditions. | Dependency version + programme revision. | Accepted proposal dependency; changed input invalidates affected preview/review. |
| A03-I04 / F-CM-SIS-01; A01-I03 | CM → SRS: complete approved future release, applicability and authority evidence. | Provider epoch + release + digest. | Atomic acceptance receipt; replay returns same acceptance, conflicting payload quarantined. |
| A03-I05 / GI-01; A01-I04 | Release owner → public-content/admissions owners: approved specification, intake availability and any authorised intake-closure instruction. | Release or closure instruction + destination/publication version. | Applied publication/listing receipt and Admissions' channel-closure receipt; failure leaves recruitment gate visibly unresolved. |
| A03-I06 / CM-QUAL-004 | Review owner → action owners: scoped action, required evidence and review deadline. | Review decision + action revision. | Evidence-backed closure or escalation; elapsed time never implies completion. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A03-AC01 | First-year review requests graduate outcomes. | Mark unavailable/not yet applicable; do not invent completions. |
| A03-AC02 | Supply aggregate without cohort, period or definition. | Evidence incomplete; no unsupported comparison or decision. |
| A03-AC03 | Shared-module proposal breaks a route. | Rework and new review; old approval not transferred to changed content. |
| A03-AC04 | Validate the unchanged option structure. | Ten valid cross-stage combinations; two fail the existing ecology prerequisite. |
| A03-AC05 | Release version 2 for entry 2033. | Sam/Jo/Omar and Geography bindings unchanged; future applicability explicit; 2033 part-time entry closed only by the approved closure instruction and Admissions' confirmation that every channel is closed, not by the prospectus alone. |
| A03-AC06 | SRS accepts but public publication fails. | Catalogue receipt retained; destination recovery and recruitment gate remain owned. |
| A03-AC07 | Review task closes without action evidence. | Action stays open; meeting completion is not implementation. |
| A03-AC08 | Credit 2030 graduates' results to the undelivered 2033 change. | Unsupported attribution rejected; evaluate only after actual delivery evidence. |

## Traceability, implementation and review

CAT-004–009 in [core requirements](../../requirements/functional-requirements.md); CM-QUAL-001–004, CM-WF-003–010, CM-VER-008/009 and CM-PUB-001–009 in [curriculum requirements](../../requirements/curriculum-management-system.md). GI-01/GI-14/GI-21 cover public publication, resources and governance. Existing assessment/reporting processes supply evidence; they do not implement the proposed programme-review workflow.

The [capability matrix](../current-capabilities.md) does not establish this full curriculum-management cycle. Review owners, unassigned: programme leadership, students, quality, external examining, analytics/privacy, resource and public-content owners. Agree metrics, suppression, materiality, consultation and action closure. Closing evidence links the review to exact approved changes, protected cohorts, accepted/public releases and a scheduled effectiveness check.
