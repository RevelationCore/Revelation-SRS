# AJ-01 — Aisha: from a course idea to an approved catalogue and prospectus

Status: **Proposed narrative v0.5**, 13 November 2026 · [Document status](README.md#status-of-these-documents).

[Shared scenario and course definition](README.md) · [Narrative catalogue](../academic-journey-narrative-catalogue.md) · [Next connected story: Sam](aj-06-discovery-application-and-arrival.md)

**Perspective:** an academic creating a new course, with module leaders, service reviewers, a quality committee, Registry and the web team. **Goal:** a course that can be recruited to and delivered, with an approved academic design, credible resources and an accurate public specification. **Starts:** an idea for new provision. **Ends:** the approved release has been accepted by SRS, published to the prospectus and enabled for the correct admissions intake, with receipts. Teaching and admission of individual students follow in other stories.

**Timeline:** t is Monday 23 September 2030, the start of academic year 2030/31; offsets are calendar weeks. See the [timeline convention](README.md#timeline-convention) and the [combined weekly timeline](README.md#combined-weekly-timeline) for dates.

## The story

### 1. Aisha sees a need — t-100

In autumn 2028, Dr Aisha Patel wants to bring together environmental science and practical data analysis. Existing students encounter the two subjects in separate modules, and potential applicants ask about a coherent degree combining them. She proposes a BSc in Environmental Data Science for entry in 2030.

In the curriculum workspace, Aisha starts proposal `CP-EDS-001`. She records who would study the course, what they should be able to do at graduation, its relationship to existing provision, the intended intake and the evidence behind the proposal. She can save incomplete work. The interface says “Draft”; nothing she types is yet offered to applicants or selectable by students.

The school approves development of the business case. Aisha receives a task list and sees the later gates, their owners and expected dates. Permission to develop the idea does not mean the university has approved the course. Recruitment staff can help research demand but cannot publish the draft as an available degree.

### 2. A course takes shape — t-98 to t-82

Aisha works with module leaders to define three stages of study, each with 120 credits, and the four programme outcomes in the shared scenario. The proposal distinguishes compulsory modules, optional groups and prerequisites. It also records entry requirements, study mode, location, assessment methods, the intended award and resource requirements.

She incorporates existing shared-module definitions by reference where appropriate. Their owners can comment on use and capacity; they cannot unknowingly have an approved module overwritten by another programme's author. New definitions remain drafts. Dated delivery offerings are planned separately from academic module versions.

Aisha reviews a student's possible route through the course. A path selecting Applied Ecology in the final stage without the earlier Ecological Data module is rejected with an explanation. A different path is valid. She can also see that an academically valid route does not yet promise laboratory space or an individual seat.

HR, Finance, Estates and Library reviewers examine the commitments within their authority: staffing and workload, the costed plan, specialist spaces and equipment, and essential accessible resources. They provide dated evidence, not a general tick saying the course is “fine”. A resource question returns to its owner while the rest of the proposal remains visible.

### 3. The first review finds a real gap — t-80

Aisha submits revision `r1`. The submission fixes the content, dependency list and workflow/template version that reviewers will assess. It creates a review pack with comments attached to specific fields and outcomes. Aisha can prepare a later draft, but cannot change the pack under the reviewers' feet.

Before the panel meets, the external academic adviser, a programme leader from another university, sends written scrutiny of `r1`. The employer adviser comments on graduate skills and placement links. The quality panel, which includes both advisers and a student panel member, asks how every student will learn to evaluate ethical and data-governance implications. The external adviser raised the question first. The map shows assessed coverage of `PLO-EDS-03@1` only in Community Field Study, an optional module. A student could legitimately choose the other three options. The map has a link, but the course does not guarantee the outcome is assessed on every permitted route.

The panel returns the proposal for rework. Its recorded reason identifies the outcome, the counterexample route and the required response. Aisha sees who owns the action and when a response is due. The original submission and review remain available; the proposal is not marked rejected or approved merely because a meeting has finished.

### 4. Rework changes the design, not just the label — t-79 to t-76

Aisha revises the compulsory Independent Project. She adds a module outcome and an explicit ethics-appraisal criterion in its proposal component. The component contributes 20% of the module mark, alongside an 80% final report. Students taking any permitted option combination will encounter that assessment.

Because a 20% component could be failed while the module is passed on the report, the panel's question is not fully answered by adding the assessment. Aisha proposes, and the assessment reviewer accepts, that the ethics component must be passed in its own right and cannot be compensated by the report mark. A student who fails it is reassessed in that component.

She submits `r2` with a response to the panel's comment and a comparison against `r1`. The assessment reviewer examines the new criterion, the project leader confirms the teaching and marking load, and the outcome map is checked again. Ten of the twelve simple cross-stage option combinations are reachable under the fixture's prerequisites, and all ten now include the compulsory, must-pass assessed outcome. The two prerequisite failures are explained; they are not disguised as missing learning outcomes.

Earlier reviews remain in the history. Affected approvals must be renewed for `r2`; a late click on an `r1` task cannot approve the revised design. Aisha sees which reviews have been retained under the configured materiality rules, which require renewal and why.

### 5. The panel grants conditional approval — t-74 to t-68

The committee secretary prepares a pack for `r2`, including the external academic adviser's response to the rework. The meeting records attendance, quorum, conflicts and any recusals. Under `APPROVAL-NEW-COURSE@1` the panel cannot approve without the external academic's written scrutiny; the student member takes part in the discussion and decision. The secretary records the committee's collective decision rather than appearing to approve the proposal personally. Aisha cannot be its independent approver.

The panel records explicitly how `PLO-EDS-03@1` is assured: assessed on every reachable route through a must-pass component. It then accepts the academic design subject to blocking condition `C-01`: the agreed specialist computing resource must have documented readiness before release. A named service owner has a deadline and must supply evidence; an independent authorised reviewer verifies it. The system displays “Conditionally approved — publication blocked”, with a clear explanation of what remains outstanding.

The resource owner supplies the readiness record. The verifier discharges `C-01` under the committee's delegated authority. This evidence is appended to the approved revision's decision history; it does not edit the academic content. If the solution had changed teaching or assessment, Aisha would have needed a new revision and the applicable renewed reviews. In this branch, the authorised final approval references unchanged `r2` and the verified condition.

### 6. Registry accepts the approved release — t-67

The publisher prepares `REL-EDS-2030-01`: programme `NBU-EDS@1.0`, route `EDS-FT@1.0`, diet `EDS-2030@1.0`, all required module/outcome/assessment references and their approval evidence. A preview checks completeness, authority, cohort applicability and dependencies. It shows the exact objects that will enter the operational catalogue.

Registry accepts the release as one declared unit. If a required module version is absent or the preview has become stale, nothing in that unit becomes partially available. On success the SRS records a receipt for the accepted content and publishes the corresponding controlled events.

The programme is now in the catalogue for the 2030 entry cohort. Students already studying in another cohort do not acquire its rules. Acceptance today, future academic applicability and permission to recruit are separate facts. The receipt also does not enrol any student or create teaching rosters.

### 7. An approved course is not yet a live prospectus page — t-66 to t-64

The web editor previews `PROS-EDS-2030@1.0`, derived from the accepted academic release. Its public fields describe the course, entry requirements, compulsory study, option rules, delivery, approved costs information and conditions on availability. The editor checks readable language, accessibility and consistency. Committee comments, the confidential cost model and personal reviewer information are excluded.

The first publication attempt fails while the website service is unavailable. Aisha's release dashboard shows “SRS accepted; prospectus pending”, and the web team owns the retry. The system does not undo SRS acceptance or tell admissions that the whole launch succeeded.

After recovery, a retry uses the same content and publication identity. The receiver returns evidence that the correct version is live, and reconciliation checks the published version. Duplicate delivery does not create a second course page. Admissions then confirms the matching course/intake listing and its external aliases through the agreed listing process. Only when all launch prerequisites are met does the recruitment owner open recruitment.

### 8. Aisha can show what was approved and what applicants see — t-63

Aisha opens the course summary. She can navigate from the public specification to its academic version, the release receipt, the committee decision and the resolved rework and condition. Each view respects her permissions. An auditor can reconstruct the evidence without depending on the current web page remaining unchanged.

At t-52 in autumn 2029, Sam begins reading that approved specification. The second narrative begins with the same course and cohort, not a copy assembled from marketing text. Later amendments will need their own authority and impact review; they cannot silently replace the information attached to Sam's eventual offer.

## Actors and decision boundaries

Names other than Aisha are role slots awaiting institutional assignment. CM is curriculum management; SRS/SIS is the authoritative student records core; CMS is the website/content service; EDRMS is the document archive.

| Actor | Can do | Cannot assume |
|---|---|---|
| Aisha / authorised co-authors | Create drafts, submit, respond to requested changes, inspect permitted status/evidence. | Approve their own proposal, edit a submitted snapshot or make a draft operational. |
| Programme/module owners | Confirm shared-module usage and review changes to their definitions and resources. | Treat sharing a module as unlimited delivery capacity. |
| HR / Finance / Estates / Library reviewers | Attest to their scoped resource checks and identify unresolved dependencies. | Confer academic approval or publish a course. |
| Quality officer / committee chair | Check pack completeness, decision authority, quorum/conflicts and academic conditions. | Treat a workflow timeout or missing response as approval. |
| External academic adviser / employer adviser | Give independent written scrutiny of standards, comparability and graduate skills; take part in the panel. | Approve the course alone, or be replaced by internal review where the policy requires external scrutiny. |
| Student panel member | Represent the student perspective in scrutiny and the panel decision. | Be treated as optional when the policy requires student membership. |
| Committee secretary | Assemble the fixed pack and record the evidenced committee decision. | Substitute their own authority for the committee's. |
| Condition owner / independent verifier | Supply evidence / record authorised verification separately. | Rewrite academic content under the guise of discharging a condition. |
| Registry publisher | Authorise a release and its operational acceptance with the required evidence. | Bypass academic approval or rebind existing students. |
| Web editor / admissions listing owner | Approve public presentation / reconcile entry-cycle listing and launch readiness. | Change academic facts or open recruitment on a successful send alone. |
| Integration operator / records manager | Recover delivery, reconcile receipts and archive evidence. | Alter an academic decision to make an exchange succeed. |

## Starting pack and structured walkthrough

Independent starting pack: tenant `NBU-DEMO`; Aisha and scoped review/publisher roles; the authority and escalation policy `APPROVAL-NEW-COURSE@1`; a versioned proposal template and route; organisational/calendar data; referenced approved shared modules, if used; resource-review evidence templates; isolated destination stubs. The starting state has **no approved NBU-EDS release, public course or active intake**. Sample records and stub receipts must be explicitly labelled synthetic.

| Scene / gate | Week relative to t | Trigger and action | Record owner / evidence | Observable next state |
|---|---|---|---|---|
| A01-01 / G0: develop | t-100 | Aisha proposes new provision; school authorises further development. | CM: rationale, decision/authority and development scope. | Draft development permitted; recruitment remains closed. |
| A01-02 / G1: design and feasibility | t-98 to t-82 | Define course/modules/outcomes/diet; obtain scoped resource reviews. | CM owns definitions and references to service-owned attestations. | Complete submission pack or owned missing items. |
| A01-03 / G2: submit and review r1 | t-80 | Pin revision/dependencies/route; external scrutiny received; panel detects optional-path outcome gap. | CM: submitted snapshot, external adviser reports, rule witness, comment and return decision. | Returned for rework; no publication. |
| A01-04 / G2 repeated: resubmit r2 | t-79 to t-76 | Add a compulsory, must-pass ethics component; revalidate and renew affected reviews. | CM: r1→r2 diff, author response, pathway check and review cycle. | r2 eligible for committee; obsolete r1 decisions rejected. |
| A01-05 / G3: committee | t-74 | Record valid meeting, outcome-assurance decision and conditional approval. | CM / controlled archive: pack, external scrutiny, membership, quorum, recusals, decision and `C-01`. | Conditional approval; release blocked. |
| A01-06 / G4: verify condition | t-68 | Owner supplies readiness evidence; independent delegate verifies under panel authority. | CM references resource evidence; condition and final approval recorded. | r2 approved; unchanged content frozen. |
| A01-07 / G5: authorise and accept | t-67 | Publisher previews, authorises and submits complete release. | CM owns release evidence; SRS owns accepted operational versions/receipt. | Atomic catalogue acceptance for cohort 2030; other cohorts unchanged. |
| A01-08 / G6: publish | t-66 to t-65 | Web editor approves public projection; initial delivery fails then recovers. | CMS owns published content; release ledger records each attempt/application receipt. | Prospectus publication evidenced; failed attempts retained. |
| A01-09 / G7: open recruitment | t-64 | Admissions validates listing/aliases and all required launch receipts. | Admissions owns intake readiness; recruitment owner records opening decision. | Course available to applicants for the correct intake. |
| A01-10 / close | t-63 | Reconcile/archive release and approval evidence; hand off to AJ-06. | CM/SRS/EDRMS retain permitted evidence and receipts. | Shared hand-off pack complete, with no unresolved blocking gate. |

These are illustrative configured gates, not a hard-coded universal university process. Reject, defer, return and cancel remain distinct decisions. Every active task has a named assignee, due date, reminder/escalation route and visible reason for waiting. A real person's name and a configured deadline must replace each role slot in an executable institutional fixture.

## Interaction register

The [exchange and evidence convention](README.md#exchange-and-evidence-convention) applies to every row.

| Local interaction / model link | Sender → receiver; trigger and minimum content | Authority / transport | Receipt, retry and reconciliation |
|---|---|---|---|
| A01-I01 / GI-21, GI-22 | CM → reviewers, external advisers and committee on submission: proposal revision, dependency digest, scoped pack and decision task. Reviewer → CM: decision, rationale, authority and condition references. | Internal workflow/human task; authenticated reviewers. Key: proposal + revision + review step + task revision. | Persisted decision receipt; reject stale or conflicted decisions. Missing response escalates; never auto-approves. |
| A01-I02 / GI-10, GI-14, GI-21 | CM ↔ HR/FIN/EST/LIB on feasibility review: scope, capacity/resource question and dated attestation reference. | Initially controlled manual evidence or a future agreed adapter, not an asserted existing API. Each source owns its evidence. | Key: proposal revision + review scope + attestation version. CM acknowledges the evidence reference; changed resource evidence triggers impact review. |
| A01-I03 / F-CM-SIS-01 | CM → SRS after final approval: complete release manifest, rule versions, dates/cohort and approval provenance. | Canonical acceptance boundary; internal module or external API/file adapter with scoped authority. | Key: tenant + provider epoch + release ID + digest. Transactional application receipt; quarantine incomplete/conflicting input; replay returns the same acceptance. |
| A01-I04 / GI-01 | Accepted catalogue/publication service → CMS after public-content authorisation: allowlisted specification, academic version, locale, embargo and publication identity. | Public-content projection owned by the authorised publisher/editor; exact adapter remains to be specified. | Key: release + public-spec version + locale + destination. CMS returns applied version/publication location; recover timeout by status query/reconciliation before replay. CMS outage leaves SRS acceptance intact. |
| A01-I05 / GI-01, GI-03 | Accepted curriculum → admissions/CRM and agreed external course listing service: programme/route aliases, intake, approved requirements, public-spec reference and launch state. | Admissions owns listing and recruitment opening; external transport must be established, not inferred from UCAS application flows. | Key: listing/intake + source version + destination. Reconcile listing acceptance and launch state before recruitment opens. A missing listing receipt is an owned launch blocker. |
| A01-I06 / F-SIS-EDRMS-01, F-EDRMS-SIS-01; GI-21 extension | Release evidence service → EDRMS: immutable specification/decision bundle and retention/access metadata; EDRMS → origin: archive identity, digest and access reference. | Archive owner controls custody; curriculum committee evidence extends the reference document scope and needs an agreed contract. | Key: evidence bundle/version + destination. Verify stored digest and retrievability; failed archive task stays owned. No invented archive receipt. |

F-SIS-CM-01 is **not exercised as actual performance feedback here**: the new programme has no enrolled cohort yet. Demand evidence may be supplied for the proposal, but its source must not be mislabeled as this programme's completion data. AJ-03/AJ-35 later supply that feedback. No student rosters are sent to VLE or timetabling merely because a course is approved.

## Variants and acceptance cases

Each case starts from its own copy of the relevant snapshot.

| Case | Situation / action | Required observable result |
|---|---|---|
| A01-AC01 | Complete the main path, including r1 rework and CMS retry. | One approved programme release; ten reachable option combinations with mandatory, must-pass outcome coverage; distinct SRS, prospectus and listing evidence; recruitment open only at G7. |
| A01-AC02 | Attempt to publish r1 or r2 while `C-01` is open. | Publication denied with the missing gate identified; no operational catalogue/public page change. |
| A01-AC03 | A reviewer decides an r1 task after r2 submission. | Stale decision rejected; old evidence retained, r2 unaffected. |
| A01-AC04 | Author self-approves, committee lacks quorum, conflict remains unresolved, external scrutiny is missing or the student member is absent where required. | Gate blocked or reassigned under authority; attempted action audited. |
| A01-AC05 | A co-author edits a stale draft, or academic content changes after approval. | Conflict/new revision required; no silent overwrite or inherited approval for changed content. |
| A01-AC06 | Validator times out or cannot interpret a mandatory rule. | “Not fully evaluated”, owned investigation, no successful validation/publication claim. |
| A01-AC07 | Release omits a module or references a wrong cohort; repeat with a complete release. | First submission rejected atomically with unchanged catalogue; corrected submission has an attributable new payload/version and valid receipt. |
| A01-AC08 | CMS receives the same publication twice, or accepts it but the response is lost. | Reconciliation finds one applied version; safe replay creates no duplicate page or false second approval. |
| A01-AC09 | Prospectus is live but admissions listing fails. | Course launch stays blocked, page/intake availability is labelled consistently, listing owner has a next action. Existing SRS acceptance is not undone. |
| A01-AC10 | Panel rejects, defers or proposer cancels. | Correct distinct state, rationale and outstanding tasks recorded; no recruitment. Reopening requires authority and retains the history. |
| A01-AC11 | Replace internal CM with a trusted external provider for this release. | Same catalogue/receipt semantics; validate approval provenance rather than rerunning internal academic approval unnecessarily. Missing provenance quarantines the release. |
| A01-AC12 | Inspect as another tenant, public visitor or unauthorised reviewer. | No confidential proposal evidence disclosed; public view contains only approved allowlisted content. |
| A01-AC13 | Navigate proposal, outcome map, revision diff and conditions using keyboard/assistive technology. | Gates, requested changes and status are understandable without colour or pointer-only interaction; failures become owned accessibility findings. |
| A01-AC14 | Policy variant: advertising "subject to approval" is permitted before G3, but offers are not. The panel then refuses or materially changes the course. | Page and listing labelled "subject to approval" from the start. Applications may be received but no offer is made before approval. Applicants are told promptly of the outcome and of alternatives through AJ-07. |
| A01-AC15 | Policy variant: the panel accepts assessment on every route without a must-pass component. | The decision and its rationale are recorded; the outcome map shows "assessed on every route", not "demonstrated by every graduate". |
| A01-AC16 | Policy variant: offers before approval are also permitted, authorised jointly by the admissions policy owner and the course's quality lead. The panel then refuses, delays or materially changes the course. | Each offer states that the course is subject to approval and the date approval is expected. No place is confirmed before approval. On refusal, delay past that date or material change, offer-holders are told promptly and offered alternatives or release through AJ-07; no offer is silently moved to another course. |

## Evidence and hand-off to the next stories

The closing evidence bundle contains the r1 submission/return, r2 diff and review decisions, complete approved definitions, pathway results, resource attestations, committee authority/minutes, condition verification, release digest, acceptance receipts and public/listing references. Readers must be able to distinguish an academic decision from a service delivery result. Recoverable failures remain in the history even after successful recovery.

AJ-06 consumes the [shared hand-off contract](README.md#shared-chronology-and-hand-off-contract). AJ-02 consumes shared-module ownership/dependencies; AJ-19 consumes the resource/delivery assumptions; AJ-03 receives the future review schedule; AJ-37/38 consume publication and archive responsibilities. None receives permission to alter approved facts informally.

## Traceability, implementation position and review decisions

| Story concern | Existing specification / gap |
|---|---|
| Course/module/outcome design | [Curriculum requirements](../../requirements/curriculum-management-system.md): CM-PRG-001, CM-PRG-008, CM-MOD-001, CM-MOD-002, CM-MOD-003, CM-OUT-002, CM-OUT-004, CM-OUT-005. |
| Diet and examples | CM-DIET-002, CM-DIET-004, CM-DIET-011, CM-DIET-012, CM-DIET-017; CAT-001, CAT-002, CAT-003, CAT-004 in [core requirements](../../requirements/functional-requirements.md). |
| Approval/rework/conditions | CM-AUTH-005, CM-AUTH-006; CM-WF-003, CM-WF-004, CM-WF-005, CM-WF-006, CM-WF-007, CM-WF-008, CM-WF-009, CM-WF-010, CM-WF-011, CM-WF-012. GI-21/GI-22 require institutional route/authority decisions. |
| Release and public information | CM-VER-001, CM-VER-007, CM-VER-008; CM-PUB-001, CM-PUB-002, CM-PUB-003, CM-PUB-004, CM-PUB-005, CM-PUB-006, CM-PUB-008, CM-PUB-009; CM-INT-004, CM-INT-007. GI-01/GI-03 require prospectus/listing contracts. |
| Operational catalogue | [BP-03-001](../../business-processes/03-curriculum-and-module-registration/bp-03-001-import-and-publish-curriculum-data.md) begins after approval; [BP-03-002](../../business-processes/03-curriculum-and-module-registration/bp-03-002-assign-programme-route-and-rules.md) later binds students. Authoring/committee approval is additional scope, not already covered by those processes. |
| Current delivery boundary | [Current capabilities](../current-capabilities.md) records partial catalogue capability and no atomic multi-entity publication. The optional curriculum requirements are proposed. Live Temporal supports specific existing review routes; this multi-gate curriculum journey still requires implementation. |

| Review slot / accountable role | Decision needed | Status |
|---|---|---|
| Academic quality lead and programme/module owners | Validate the invented course/outcomes, all-path assessment test, must-pass ethics component, panel composition (external and student members) and actual gate/condition authority. | Unassigned; open. |
| Faculty resource owners | Agree resource evidence, capacity commitment and expiry/revalidation triggers. | Unassigned; open. |
| Registry and integration lead | Agree release atomic unit, provider authority, identifiers, receipts and implementation scope. | Unassigned; open. |
| Recruitment/web owners | Agree public fields, course-listing channel, embargo, option availability wording, recruitment-opening gate and whether advertising "subject to approval" is permitted. Whether offers may be made before approval is a separate decision for the admissions policy owner. | Unassigned; open. |
| Student/accessibility and records/privacy representatives | Review understandable status, accessible interactions, public/private separation and retention. | Unassigned; open. |
