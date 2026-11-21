# Pre-review: Reasonable-adjustment case workflow (D-44, BP-04-004)

> Date: 2026-11-21
> Backlog item: BL-124
> Items reviewed: [BP-04-004 review pack](../04-learning-engagement-and-support/review-pack-bp-04-004.md); [BP-04-004 Manage a reasonable adjustment case](../04-learning-engagement-and-support/bp-04-004-manage-a-reasonable-adjustment-case.md) v0.2; [Phase 5 D-44](../../decisions/phase-5-gap-closure-decisions.md#d-44-the-independent-professional-review-of-the-adjustments-workflow-bp-04-004)
> Roles taken: disability-service practitioner (head of disability and inclusion service); data protection officer
> Status: **AI pre-review.** This is not the independent professional review that D-44 requires, and it does not replace the named disability-service practitioner and DPO. Nothing here is approved, signed off or confirmed. BP-04-004's review record stays "Pending".

## Sources consulted

| Source | Version or date | Used for |
|---|---|---|
| Review pack and BP-04-004 | Pack submitted 2026-11-18; page v0.2, 2026-08-15 | What the project asks and claims |
| [ADR-017](../../decisions/ADR-017-minimum-necessary-outcomes-and-restricted-evidence.md), [ADR-019](../../decisions/ADR-019-per-target-exchange-ledger-and-reconciliation.md), [ADR-021](../../decisions/ADR-021-governed-identity-rights-retention-and-audit.md), [ADR-028](../../decisions/ADR-028-exceptional-circumstances-decision-authority.md) | Accepted | Decided positions; ADR-028's separation pattern applied by analogy |
| Code on branch `phase-1-security-isolation` at 8412e9f, plus uncommitted work in progress | 2026-11-21 | `modules/wellbeing` (adjustment cases), `apps/api/src` (adjustments, distribution, exam entries), `adapters/vle` (Moodle driver), `packages/domain` (permissions), `apps/portal` |
| Equality Act 2010, s.20, s.91 and [Schedule 13](https://www.legislation.gov.uk/ukpga/2010/15/schedule/13) (para 4 competence standards; para 7 code of practice) | As in force; cited in the pack | Duty to make reasonable adjustments in HE |
| Disability Discrimination Act 1995 Part 4, as amended by the Special Educational Needs and Disability (Northern Ireland) Order 2005 | From reviewer knowledge, not re-fetched | Northern Ireland framework |
| *University of Bristol v Abrahart* [2024] EWHC 299 (KB) | From reviewer knowledge, not re-fetched | Anticipatory duty, knowledge, assessment-method adjustments, timeliness |
| EHRC "What reasonable adjustments are" (SRC-057); EHRC Technical Guidance on Further and Higher Education | SRC-057 accessed 2026-07-26 (review-by passed); guidance from reviewer knowledge | Practice expectations |
| UK GDPR Art. 5(1)(c), 5(1)(e), 9(2), 25, 32; ICO guidance on special category data; Data (Use and Access) Act 2025 | From reviewer knowledge, not re-fetched | Minimisation, storage limitation, Article 9 condition |
| OIA Good Practice Framework, Requests for additional consideration (para 42 on third-party evidence) | Read 2026-11-21 | EC free text question in the pack |

## Summary

The case model is a reasonable start: enforced states, an approval precondition, checksummed and access-logged evidence, own-record self-service, and a minimum typed outcome to core. But as deployed it cannot work, and several controls the pack presents as built can be bypassed. The running wellbeing service uses a stub SRS client, so an approved adjustment never reaches core, exams or the VLE. A later panel rejection does not stop approval on an earlier assessment. Assessor and panel chair are taken from the request body. Staff can create a core adjustment with no case, or set a case to `approved` through "status correction". A reviewed or rejected case never changes or withdraws what was sent. Retention closes cases but never deletes evidence. These need fixing before a named practitioner and DPO are asked to sign anything.

**Findings:** Blocker 1 · Major 11 · Minor 6 · Observation 2.

## Findings

| # | Severity | What is wrong | Evidence | What to change |
|---|---|---|---|---|
| F1 | Blocker | The deployed wellbeing service never hands an approval to core. `main.ts` builds the app without SRS clients, and `buildApp` then uses `SrsAdjustmentStubClient` and `SrsEcStubClient`. Approval returns `submitted` with an ID `stub-adj-…`, the case shows `approved` with that reference, and nothing is distributed, so an approved adjustment is not implemented. The real `SrsAdjustmentHttpClient` is used only in a cross-component test, with a static bearer token; no service credential is obtained, and `integration-service` does not hold `adjustment:write`. A failure to implement an agreed adjustment is a breach of the s.20 duty. | `modules/wellbeing/src/main.ts:13`; `modules/wellbeing/src/app.ts:109-110`; `modules/wellbeing/src/srs/srs-adjustment-client.ts:112-129`; `apps/api/test/cross-component/adjustment-handoff.int.test.ts:77`; `packages/domain/src/permissions.ts:56` | Wire the HTTP clients from configuration with a client-credentials token for the wellbeing service; give that client a narrow permission to record an approved adjustment (the ADR-028 item 8 pattern, checked by `azp`); refuse to start with a stub outside development and test. |
| F2 | Major | A panel's rejection does not stop approval. `hasApprovableDetermination` returns true as soon as the latest assessment is `recommended`, before it looks at the panel. A case referred after a recommending assessment and rejected by the panel can still be approved. "Latest" is ordered by `assessed_at` and `panel_date`, both supplied in the request body, so a back-dated record changes which one counts. | `modules/wellbeing/src/repositories/adjustment-case-repository.ts:355-395` | The most recent determination by recorded time wins; a panel decision supersedes any earlier assessment. Add a test: recommended, then panel `rejected`, then approve → 409. |
| F3 | Major | The assessor and the panel chair are taken from the request body (`assessorId`, `panelChairId`), so a caller can record someone else as the assessor or chair. This is the defect BL-170 fixed for EC. | `modules/wellbeing/src/routes/adjustment-cases.ts` (assessments and panel-decisions routes) | Set both from the token; return 400 if a client sends them. |
| F4 | Major | No separation of duties, and registry holds the whole case. `registry-administrator` holds `adjustment-case:read:all`, `adjustment-case:manage`, `panel-decision:write`, `special-category:read` and `disability:write`, so registry staff can open, approve and reject cases and read medical evidence. Nothing in the service stops one person who holds both assessing and approving roles from doing both. ADR-028 removed registry from wellbeing EC on exactly these grounds. | `packages/domain/src/permissions.ts:97-111` | Remove `registry-administrator` from `adjustment-case:*` and `panel-decision:write` by default (registry receives the outcome in core). Refuse approval by the person who recorded the deciding assessment, in the service, unless the institution configures single-officer approval. |
| F5 | Major | A core adjustment can be created with no case and no approval. `POST /students/:personId/adjustments` needs only `adjustment:write` (registry administrators, wellbeing advisers), and `sourceCaseId` is optional. It is then distributed to every target like an approved one. | `apps/api/src/routes/adjustments.ts:59-69, 156-210` | Accept this route only from the wellbeing service client with a `sourceCaseId`, or require a second person to approve a manual adjustment and record why it has no case. |
| F6 | Major | "Status correction" bypasses the approval control. `PATCH /adjustment-cases/:id/status-correction` needs only `adjustment-case:manage`, skips the state machine and accepts any string, so an adviser can set `approved` with no determination and no hand-off. | `modules/wellbeing/src/routes/adjustment-cases.ts` (status-correction route); `adjustment-case-repository.ts:199-230` | Validate the code against the known statuses; never allow `approved` through correction; give correction its own permission and a second-person check. |
| F7 | Major | A review never reaches what was sent. There is one hand-off per case: after `request-review`, a modified outcome short-circuits as `already_sent`, and a rejection or closure does not expire or withdraw the core adjustment. Temporary and anticipatory adjustments "carry their own review dates" (A1.1), but the case has no review date. | `adjustment-cases.ts` approve route (`findHandoffForCase` short-circuit); reject and close routes | Version the hand-off per decision: a modified outcome supersedes the core adjustment, a rejection or closure after approval withdraws it. Add a review date and a due-for-review queue. |
| F8 | Major | The student cannot ask for a review or decline an adjustment. `request-review` needs `adjustment-case:manage`, so A2.1 ("implemented as request-review") is staff-only. Declining an offered adjustment is not modelled at all, although the student's agreement is central to practice. | `adjustment-cases.ts` request-review route; BP-04-004 A2.1 | Let the owning student request a review and accept or decline each offered adjustment; record their response before distribution. |
| F9 | Major | Retention never deletes anything. `POST /admin/retention/apply` only sets wellbeing cases to `closed`. Evidence deletion is soft only, and there is no retention period for adjustment cases or evidence. This breaks storage limitation (Art. 5(1)(e)) for special-category data. | `modules/wellbeing/src/routes/admin-retention.ts:60-111`; `packages/documents` soft delete | Set a retention period per record type (proposed below); after it, erase document content and case narrative, keeping a minimal tombstone of the outcome for the core adjustment's lifetime. |
| F10 | Major | Free-text `notes` from the approval are passed to core and stored on `reasonable_adjustment`, readable by everyone with `adjustment:read:all` (registry, wellbeing advisers, integration service). An approver can easily put diagnosis or narrative there. That defeats the minimum-outcome boundary the pack claims (ADR-017). | `adjustment-cases.ts` approve route (`notes` in payload); `apps/api/src/routes/adjustments.ts:59-69` | Drop `notes` from the hand-off, or replace it with structured, implementation-only fields (for example equipment or room requirements from a value set). |
| F11 | Major | The Moodle driver creates groups named "Extra time +25% (SRS)" and does not set group visibility. In a course with visible groups, participants can see who is in the group, which reveals that a student has an adjustment and implies a disability. | `adapters/vle/src/vle-platforms/moodle-driver.ts:136-148` | Create the group with visibility "members only" or "none" (Moodle 4.2+), use a neutral name, and check the equivalent for Canvas. |
| F12 | Major | No timeliness control. Cases have no target date, no "needed by" date (for example the next exam) and no overdue queue, and there is no interim adjustment while assessment is pending. *Abrahart* shows the duty can arise before a formal process completes, and that delay is a failure in its own right. | Case schema `modules/wellbeing/src/db/schema/adjustment.ts`; no due-date fields | Add a needed-by date and an overdue view; allow an interim adjustment, approved by the adviser, with a short expiry, pending full assessment. |
| F13 | Minor | A refusal is free text only and is not audited: the reject route writes no audit row. There is no reason code, so a competence-standard refusal (Schedule 13 para 4) cannot be distinguished from "not reasonable" or "no barrier identified", and alternatives considered are not recorded. | `adjustment-cases.ts` reject route | Add a refusal reason code (value set, including `competence-standard`), a required "alternatives considered" field, and an audit row. |
| F14 | Minor | The student is not told, at the point of request, who will see what, and the case records no Article 9 condition. The wellbeing case default lawful basis is `gdpr-art6-e`, with no field for the Article 9(2) condition (for example substantial public interest, DPA 2018 Sch 1 para 16 "support for individuals with a particular disability"). No sharing preference is recorded. | `modules/wellbeing/src/db/schema/wellbeing-case.ts:20`; `apps/portal/src/pages/AdjustmentRequestPage.tsx` | Show a short privacy notice on the request page; record the Article 9 condition on the case; record the student's sharing preferences and honour them in distribution. |
| F15 | Minor | Adjustment-case audit rows use `resourceType: 'disability-case'`, the mislabelling BL-170 fixed for EC. | `adjustment-cases.ts` (`appendAudit` calls) | Use `adjustment-case`. |
| F16 | Minor | `forceApprove` needs no reason and is not in the audit context. | `adjustment-cases.ts` approve route | Require a reason when `forceApprove` is set and audit it. |
| F17 | Minor | A failed hand-off says "will be retried", but nothing retries it; only a manual re-approve resends. | `adjustment-cases.ts` (502 problem); no relay for `srs_handoff_outbox` | Add a relay in the worker, or change the message and list failed hand-offs on the case queue. |
| F18 | Minor | The portal offers students "delete my evidence", but the route needs `adjustment-case:manage`, so it fails with 403. | `apps/portal/src/pages/AdjustmentCaseDetailPage.tsx:121`; delete evidence route | Either let the owning student withdraw their own evidence before assessment, or remove the button. |
| F19 | Observation | Uploaded evidence is not virus-scanned (BL-100 already open). | `packages/documents` `NoopScanner` | Keep BL-100 at its priority; it matters more once students upload. |
| F20 | Observation | Good: the minimum outcome to targets really is minimal (type, scope, amount, dates); exam entries compute combined time without invented minutes; the board sees no case content. | `apps/api/src/platform/adjustments/distribution-dispatcher.ts:122-136`; `apps/api/test/exam-entry-adjustments.int.test.ts` | None. |

## Variants

| Variant | Position | Configuration or code |
|---|---|---|
| England, Wales, Scotland | Equality Act 2010 Part 6 and Schedule 13 apply in Great Britain | Same workflow |
| Northern Ireland | DDA 1995 Part 4 as amended by SENDO 2005; similar reasonable-adjustment and competence-standard concepts, different legal references | Configuration: legal basis label and refusal-code wording per nation; same workflow |
| DSA | Student Finance England, Student Finance Wales, SAAS (Scotland), Student Finance NI; the needs assessment report is the student's | Configuration of DSA body; evidence type `dsa-award-letter` already exists |
| Welsh language | Notices and portal text in Welsh | Configuration |
| Placements and apprenticeships | Adjustments at a host organisation need consent to share with the host | Code for F14 sharing preferences |

## Open questions

The pack's nine reviewer questions are P-1 to P-9 below, followed by BP-04-004's own open questions.

| ID | Question | Proposed answer | Confidence | Owner who must decide |
|---|---|---|---|---|
| P-1 | Who may approve: a named delegated authority, or only the panel? | A named disability adviser with delegated authority approves routine adjustments on a recommending assessment, provided they did not record that assessment (F4). Fix F2 and F3 first. Panel only by escalation. | Medium | Head of disability services |
| P-2 | When must a case go to a panel? | When the adjustment may touch a competence standard, when the assessor does not recommend and the student disagrees, when a school says it cannot implement it (E2.1), or on a student's request for review. | Medium | Head of disability services; academic registrar for competence standards |
| P-3 | How long is evidence kept, and who may see it? | Proposed default: evidence and case narrative six years after the student's last enrolment ends (the common HE records schedule for disability support files), then erased (F9); third-party medical evidence as short as practicable. Access: disability service staff only; not registry (F4). | Low (period is institutional) | DPO and records manager |
| P-4 | Minimum content of the outcome to core and targets? | Type, scope, amount, valid dates, case link. Remove free-text `notes` (F10). | High | DPO |
| P-5 | Default fulfilment mode per target? | Keep VLE connected, attendance manual, exams file, but only after F1; a manual target must have an owner and overdue alert set at go-live. | Medium | Integration owner; head of disability services |
| P-6 | How is a refusal recorded; must it give a reason code? | Yes: reason code including `competence-standard`, alternatives considered, a student-facing explanation and review route; audited (F13). | High | Head of disability services; academic registrar |
| P-7 | Should `forceApprove` be allowed, and by whom? | Yes, because a student may need an adjustment before modules are registered (pre-arrival, induction, placement), but only by the approver, with a reason, audited (F16). | Medium | Head of disability services |
| P-8 | Which framework applies to NI students? | DDA 1995 Part 4 as amended by SENDO 2005; the same workflow, with nation-specific legal references and refusal wording. Students of an NI provider studying elsewhere follow the provider's law. | Medium | Four-nation SME; institution's legal adviser |
| P-9 | EC notes as free text in core: acceptable under ADR-017? | No as a default. Where the wellbeing module is the EC case system, the narrative goes there and core keeps scope and outcome; otherwise restrict core notes to the EC roles (BP-04 record F6). | High | DPO |
| BP-04-004 OQ-1 | Owner, workflow boundary, mapping | **Close the boundary**: wellbeing module owns case and evidence, core owns outcome and distribution. Owner: head of disability services. | High | Process owner/architect |
| BP-04-004 OQ-2 | Variants needing configuration | **Stay open**: the variant table above. | Medium | Four-nation SME |
| BP-04-004 OQ-3 | Evidence kept in the specialist system; minimum outcome | **Already answered** on the page; residual EDRMS question is BL-102; add F10 (no free-text notes). | High | DPO |

## Still needs a named person

- **Disability-service practitioner (D-44):** P-1, P-2, P-5 to P-7, F8, F12 and F13, and the whole workflow once F1 to F7 are fixed.
- **DPO (D-44):** P-3, P-4, P-9, F9, F10, F11 and F14; the Article 9 condition and privacy-notice wording; a DPIA for the wellbeing module and its hand-offs.
- **Records manager:** the retention schedule (P-3).
- **Academic registrar:** competence standards (P-2, P-6).
- **Northern Ireland reviewer and legal adviser:** P-8.

## Not checked

- Assistive-technology and accessibility testing of the portal and admin case screens; nothing was run in a browser.
- The demo walkthrough in the pack was not performed.
- Legislation, the EHRC technical guidance and *Abrahart* were not re-fetched; cited from knowledge.
- Canvas group or section visibility (F11) was not checked.
- The institution's disability policy, retention schedule and DPIA: none are in the repository.
- Whether infrastructure manifests outside `modules/wellbeing/src` inject real SRS clients; I found none in the code paths read.

## New work (backlog-ready)

| Title | Type | Area | Priority | Size |
|---|---|---|---|---|
| Wire real SRS clients in the deployed wellbeing service; refuse to start with a stub outside dev and test | Defect | Adjustments & EC | P0 | M |
| Service credential and narrow permission for wellbeing-to-core adjustment and EC hand-offs | Integration | Integrations | P0 | S |
| Approval honours a later panel rejection; order determinations by recorded time | Defect | Adjustments & EC | P0 | S |
| Adjustment assessor and panel chair taken from the token | Defect | Adjustments & EC | P0 | S |
| Adjustment separation of duties; remove `registry-administrator` from `adjustment-case:*` and `panel-decision:write` | Improvement | Adjustments & EC | P1 | S |
| Restrict direct core adjustment creation to the wellbeing client or a second approver | Defect | Adjustments & EC | P1 | S |
| Status correction validates codes, cannot set `approved`, has its own permission | Defect | Adjustments & EC | P1 | S |
| Review outcomes update or withdraw the core adjustment; review dates and queue | Feature | Adjustments & EC | P1 | M |
| Student requests review and accepts or declines offered adjustments | Feature | Admin & portal UI | P1 | M |
| Wellbeing retention erases evidence and narrative after the period | Feature | Wellbeing | P1 | M |
| Remove free-text notes from the adjustment hand-off | Improvement | Adjustments & EC | P1 | S |
| Moodle extra-time groups hidden and neutrally named | Defect | Integrations | P1 | S |
| Needed-by dates, overdue view and interim adjustments | Feature | Adjustments & EC | P2 | M |
| Refusal reason codes (including competence standard), alternatives considered, audit | Improvement | Adjustments & EC | P2 | S |
| Privacy notice, Article 9 condition and sharing preferences on adjustment cases | Feature | Adjustments & EC | P2 | M |
| Adjustment audit resource type, `forceApprove` reason, hand-off retry relay, portal evidence delete | Tech debt | Adjustments & EC | P3 | S |
