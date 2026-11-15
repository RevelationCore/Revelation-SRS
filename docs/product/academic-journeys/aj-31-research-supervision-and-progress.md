# AJ-31 — Sustaining a research project over several years

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Research fixture](research-and-partnership-fixture.md) · [Thesis examination](aj-33-thesis-examination-and-award.md)

**Perspective:** Morgan, the supervisors, a PGR administrator and independent progress reviewers. **Boundary:** approved supervision and research context through evidenced progress, corrective actions and versioned team changes. **Timeline:** tR-6 to tR+156, with tR = 22 September 2031 = t+52. The original candidature anchor never resets at an annual review.

## The story

### A team is nominated, checked and approved — tR-6 to tR-3

Leila and Evan are nominated with roles, expected contribution, dates and capacity. HR supplies employment/eligibility context. The PGR administrator checks suitability and conflicts, and the Director approves the exact team at tR-3 for the candidature starting tR. A nomination remains visible as pending until that authority exists.

Under ADR-023, the SRS supervision case owns the approved assignment. HR's eligibility response supports it; CRIS does not become the academic decision-maker because it displays the names. Morgan receives the approved contact and escalation route, not a placeholder team assembled from an unapproved research proposal.

### Research requires permissions as well as registration — tR+1 to tR+12

Morgan agrees a research and training plan with the supervisors. The project involves a fictional environmental field study and data collection. Training records and an ethics/safety application identify the planned activity, data handling, location and approval scope. Fieldwork cannot start merely because registration or funding is active.

The authorised specialist owners approve the required scope at tR+8. Fieldwork starts at tR+9 only after the operational checks are complete. The initial progress panel at tR+12 reviews the plan, training and permissions, records its evidence and sets the next milestones. A progress panel cannot substitute for an ethics decision or expand a site's safety approval.

### A review identifies work still needed — tR+40 to tR+48

Morgan supplies a dated progress report and agreed work samples. The panel checks its membership, conflicts and quorum under `PGR-GOV-2031@1`. One reviewer declares a conflict and is replaced before the decision. The panel records that the analysis plan needs further work and gives specific actions with a tR+48 review point.

Morgan sees what must change, who can help and the review route. The more-work decision is not a withdrawal, failure of a taught module or automatic loss of funding. At tR+48 the appointed reviewers verify the new evidence and record the authorised continuation outcome. An incomplete response would stay an owned decision under the configured regulations; elapsed time alone cannot pass the milestone.

### A supervisor leaves without erasing the relationship — tR+64 to tR+70

Leila plans to leave the institution at tR+70. The administrator opens a change case at tR+64, consults Morgan and nominates Imani as replacement lead while Evan continues. HR eligibility, capacity and conflicts are checked afresh. The Director approves at tR+68, effective tR+70, before the old assignment ends.

The old team remains reconstructible for work undertaken earlier. Morgan's research record and permissions do not disappear with Leila's staff account. If replacement approval fails, the Director must authorise a bounded interim arrangement and review date; no vacant role is labelled filled. Any effect on project permissions, facilities or funding is referred to its owner.

### Publish milestones without transferring their authority — later reviews

SRS publishes the authorised team and academic milestones to CRIS with source versions and dates. CRIS returns its researcher-profile/publication context and applied-state evidence. A delayed earlier team message cannot reinstate Leila after the replacement takes effect.

A CRIS milestone differing from the ratified SRS decision opens a reconciliation task; it is not ingested as an overwrite. Publication records can inform a review but cannot independently complete it. At tR+92 and tR+144, the panel uses new period-specific evidence. Future thesis success is not included in an earlier progress report.

### Prepare the end of funded study — tR+144 to tR+156

Morgan and the team check submission readiness, outstanding training/permission actions and the examination timetable. The funding officer confirms that funded support ends at tR+156. At tR+148 a separate arrangement addresses fees and access during examination/corrections; there is no assumed extension of the stipend.

Submission readiness is a recommendation to enter AJ-33, not an award decision. An interruption branch would use an authorised return/review plan linked to AJ-28 and adjusted research milestones, with separate funding consequences. The main case preserves its original anchor and actual progress history.

## Starting pack and authority

Supply the proposed/approved team at the relevant stage, staff eligibility evidence, research plan, synthetic permissions, progress policy, independent panel and dated review evidence. Use governed core cases under ADR-023, not a new standalone workflow module. PGR authorities own assignments and progress outcomes; specialist bodies own ethics/safety; HR owns employment eligibility; CRIS owns its profile/publication activity. Morgan and supervisors provide evidence but cannot self-ratify a review.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A31-01 | tR-6 to tR-3 | Check and approve supervisory team. | Effective-dated assignment supplied to AJ-30. |
| A31-02 | tR+1 to tR+12 | Plan training, obtain permissions and hold initial review. | Permitted activity and attributable milestones. |
| A31-03 | tR+40 to tR+48 | Review evidence, request further work and verify response. | Explicit action/continuation decisions, no automatic status change. |
| A31-04 | tR+64 to tR+70 | Approve replacement lead before departure. | Continuous approved supervision with retained history. |
| A31-05 | tR+92; tR+144 | Review subsequent periods and reconcile CRIS. | New authorised outcomes against new evidence. |
| A31-06 | tR+148 to tR+156 | Resolve post-funded-period readiness and examination hand-off. | Submission-ready case and separate financial/access arrangement. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A31-I01 / F-HR-SIS-01; GI-14 | HR/staff owner → supervision case: identity, eligibility/capacity and dated staff context. | Staff-check version + nomination; HR evidence authority. | Verified check or owned gap; employment alone is not academic appointment. |
| A31-I02 / BP-03-007; ADR-023 | PGR Director → SRS assignment: approved team, scope and start/end dates. | Case decision + team version. | Current dated assignment, predecessor retained; duplicate decision does not create overlapping leads. |
| A31-I03 / GI-12 | Researcher/supervisors ↔ ethics/safety owners: proposed activity and returned scoped permission. | Application/permission revision; specialist authority. | Valid permission reference and restrictions; pending/expired scope blocks relevant activity. |
| A31-I04 / BP-04-003 | Panel → SRS progress case: membership/conflicts, evidence, outcome and actions. | Review decision + evidence snapshot. | Authorised milestone and owned actions; no timer-generated continuation. |
| A31-I05 / F-SIS-CRIS-01, F-CRIS-SIS-01 | SRS ↔ CRIS: approved candidature/team/milestones; profile/publication context and reconciliation response. | Source fact version + purpose/destination. | Applied state or owned mismatch; incoming CRIS content cannot replace SRS academic authority. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A31-AC01 | Nomination lacks eligibility or Director approval. | Team remains pending; no false current assignment. |
| A31-AC02 | Fieldwork planned before ethics/safety approval. | Relevant activity blocked; funding and registration do not supply permission. |
| A31-AC03 | Conflicted progress reviewer remains appointed. | Resolve/replace before decision; evidence and quorum checks retained. |
| A31-AC04 | Panel requests further work. | Owned actions and review date; no automatic withdrawal or funding cancellation. |
| A31-AC05 | Lead supervisor leaves at tR+70. | Approved replacement effective then, or an explicit interim decision; old relationship preserved. |
| A31-AC06 | Replay an earlier team or conflicting CRIS milestone. | Current SRS authority retained; mismatch reconciled rather than overwritten. |
| A31-AC07 | Funding ends while examination is pending. | Separate approved fee/access plan; no invented stipend extension. |
| A31-AC08 | Review becomes overdue or researcher interrupts. | Owned policy decision and revised plan; no fabricated completed milestone. |

## Traceability, implementation and review

BP-03-007, BP-04-003 and BP-05-010 in the [process inventory](../../business-processes/process-inventory.md); HRP-002–006 in [core requirements](../../requirements/functional-requirements.md); [ADR-023](../../decisions/ADR-023-pgr-supervision-and-examination-authority.md); GI-12/GI-14 cover permissions and resources.

The [capability matrix](../current-capabilities.md) records implemented PGR supervision/progress cases and student views, with supervisor-facing portal gaps. This narrative has not been executed and does not establish the specialist interfaces. Review owners, unassigned: PGR Director, researchers, supervisors, HR, ethics/safety, funding and CRIS. Closing evidence is the authorised team history, permissions, independent reviews, actions and reconciled published milestones.
