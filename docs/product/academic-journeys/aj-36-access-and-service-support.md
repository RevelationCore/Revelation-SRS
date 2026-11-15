# AJ-36 — Restoring access without corrupting the student record

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Service fixture](flexible-learning-and-service-fixture.md) · [Independent employment roles](aj-32-student-employment-and-payments.md)

**Perspective:** Farah, a service-desk analyst, IAM/security staff and the responsible Registry or HR owner. **Boundary:** verified access incident through authorised technical repair and observed service recovery. **Timeline:** Farah tX-1 to tX+2; separate Morgan branch tR+177. tX = t+104; tR = t+52.

## The story

### A verified learner reports a specific failure — tX-1

Farah has completed registration for her online course but cannot open ONL710 in the VLE. She can reach the portal and uses its help route; an accessible alternative exists for someone who cannot sign in at all. The desk creates `IT-FARAH-2032-001`, records the affected service, time, error and teaching impact, and verifies her identity through the approved support process.

The desk does not request a password, copy identity documents into a general ticket or infer the person solely from a shared name. The support view contains the permitted identity, registration and eligibility references required for diagnosis. Private wellbeing or payment evidence is unnecessary. Farah receives an owner, reference and next update time rather than an unsupported promise that the issue is already fixed.

### Compare authoritative eligibility with applied access — tX-1

The analyst checks Registry's confirmed enrolment and module registration, their effective dates, the IAM subject link and the VLE's applied role. Registry is correct: Farah is eligible. IAM's account is active, but the VLE target lacks the particular module membership. This identifies a technical provisioning failure, not a reason to cancel and recreate her enrolment.

If the enrolment were genuinely pending, the desk would refer that academic/registration question to Registry. If a duplicate identity were suspected, the restricted identity-resolution process would decide the link. A broad administrator role would conceal the fault and expose other students' records; it is not an acceptable shortcut. [AJ-39](aj-39-integration-failure-and-reconciliation.md) supplies the retry/reconciliation pattern when the missing role follows a failed exchange.

### The responsible owner repairs the narrow fault — tX

IAM and learning-service owners verify the authoritative module-role instruction and the receiver's actual state before applying the missing membership. They reuse the original operation where appropriate and retain the person, registration revision and target correlation. A lost acknowledgement is recovered by querying applied state rather than provisioning another learner account.

If diagnosis requires temporary support access, a separate approver grants a read-only, target-limited role until the end of the recorded support shift. It is logged and expires independently of the ticket. The analyst cannot impersonate Farah to submit assessed work, download private case evidence or grant themselves permanent access. A temporary workaround, if authorised, has an owner, expiry and reconciliation plan; it is not recorded as a completed permanent repair.

### Prove the learner can do the intended task — tX to tX+1

The service returns an applied-membership reference, and Farah confirms she can open the correct learning area and accessible sample resource. Library access is checked separately, because a VLE fix does not prove resource licensing or library entitlement. The support record links technical checks with the learner's observed outcome before first teaching at tX+1.

Farah's assessment deadline and marks remain untouched. If lost access has academic consequences, an assessment officer considers a separate remedy under [AJ-10](aj-10-distance-learning-and-online-support.md) and the applicable policy. The desk can supply outage evidence; it cannot silently award an extension or credit. Any required alternative service remains owned until the learner can use it.

### Close the incident, then verify the controls — tX+2

The analyst records cause, exact repair, consumer state, user confirmation and unresolved limitations. Temporary diagnostic rights have expired; their removal is checked rather than assumed from closing the ticket. The support-resolution event records the service effect and may update a status display, but cannot act as a new academic eligibility decision.

In a separate security-lock variant, identity and registration are both valid but the security owner has an active account restriction. The desk escalates securely and supports permitted communication; it does not clear the hold because teaching is imminent. Only the authorised security decision can release that restriction. After release, effective eligibility is checked again before provisioning, so an old positive registration event cannot override a newer closure or lock.

### One role can end while another continues — tR+177

A second independent scenario uses Morgan's existing research conferral and `EMP-MORGAN-002`, which continues to tR+184. A coarse student-leaver operation has incorrectly removed access required for the active teaching assignment. The analyst compares both authority streams rather than reopening Morgan's completed candidature or keeping all student entitlements indefinitely.

HR confirms the current employment and the academic assignment owner confirms required teaching scope. IAM restores only those entitlements, preserving research completion and any independent security restriction. At the contract end, employee access has its own closure instruction. This tests the same person's distinct relationships with the institution; a single “active student” flag cannot govern every role.

## Starting pack and authority

Supply `ACCESS-SUPPORT@1`, Farah's confirmed registration and IAM/VLE states, role/target policies, ticket identity verification and isolated receiver responses. For Morgan, supply the actual tR+177 conferral and still-current employment/assignment evidence from AJ-32/33. Registry owns academic eligibility, HR owns employment, IAM owns access application, security owns holds and the desk owns diagnosis/communication. No helpdesk ticket substitutes for any of those decisions.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A36-01 | tX-1 | Verify requester and capture service-specific impact. | Scoped ticket and owned response. |
| A36-02 | tX-1 | Compare registration, identity link and actual target role. | Missing VLE membership isolated without academic edits. |
| A36-03 | tX | Apply authorised narrow repair; limit diagnostic access. | One correct membership and time-limited support role. |
| A36-04 | tX to tX+1 | Test learning/resource access with Farah. | Usable service before teaching; no academic remedy inferred. |
| A36-05 | tX+2 | Verify resolution and privilege expiry; test security-lock variant separately. | Evidence-backed closure or owned security referral. |
| A36-06 | tR+177 | Reconcile Morgan's completed research and active employment. | Employment access restored independently through its own end date. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A36-I01 / F-SIS-ITSM-01 | SRS → authorised support view: minimum identity, dated registration and eligibility context. | Ticket + scoped source version; permitted requester. | Audited context access; private evidence excluded. |
| A36-I02 / F-SIS-IAM-01, F-IAM-SIS-01 | Eligibility owner ↔ IAM: scoped entitlement and actual account/lock/role state. | Person-role + eligibility revision; independent security authority. | Correct role/hold interpretation; technical repair cannot change source eligibility. |
| A36-I03 / F-SIS-VLE-01; GI-14 | Registration/access owners ↔ VLE/library service: permitted role and usable-resource checks. | Registration + target operation/version. | Applied membership and task verification; retries do not create duplicate accounts. |
| A36-I04 / F-ITSM-SIS-01 | Service desk → SRS/status view: resolution reference, actual effect and remaining restriction. | Ticket resolution revision; service owner. | Status reconciled with IAM; ticket closure cannot enrol or unlock independently. |
| A36-I05 / GI-13; A32-I05 | HR/academic assignment owner ↔ IAM/support: active employment and independently ended student relationship. | Employment/assignment revisions + target. | Correct employee rights retained without reopening candidature. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A36-AC01 | Unverified requester seeks account repair or another learner's details. | Identity/scope check blocks disclosure and change. |
| A36-AC02 | Valid registration exists but VLE role is absent. | Repair target membership; preserve original enrolment and identity. |
| A36-AC03 | Registration is pending or identity linkage is ambiguous. | Refer to authorised source process; no broad admin-role workaround. |
| A36-AC04 | A security lock remains active for an enrolled student. | Security authority retained; no automatic unlock. |
| A36-AC05 | Repair acknowledgement is lost. | Query applied state and reuse operation; no duplicate account/membership. |
| A36-AC06 | Temporary diagnosis completes or support shift ends. | Scoped support rights expire and removal is verified. |
| A36-AC07 | Service ticket is closed but resource access still fails. | Relevant readiness remains unresolved; user task evidence required. |
| A36-AC08 | Morgan's student role ends while employment remains current. | Preserve/restore justified employee scope only, without reopening candidature. |

## Traceability, implementation and review

ITSM-001/002, IAM-001/002, VLE-001 and PLT-SEC requirements in [core requirements](../../requirements/functional-requirements.md); BP-03-006 and BP-08-001/006 in the [process inventory](../../business-processes/process-inventory.md); IGA-001–004 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-13 covers employment-role context and GI-23 uncertain identifier reconciliation.

The [capability matrix](../current-capabilities.md) does not establish this complete external helpdesk/IAM repair journey; identity redirects also require downstream reconciliation. Review owners, unassigned: service desk, IAM, security, Registry, HR, learning technology, library and privacy. Closing evidence is correct authority-scoped access and a verified learner task, not merely a green ticket.
