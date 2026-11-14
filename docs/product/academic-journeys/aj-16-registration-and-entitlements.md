# AJ-16 — A confirmed place becomes a registered student

Status: **Proposed narrative v0.6**, 13 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [AJ-06](aj-06-discovery-application-and-arrival.md)

**Perspective:** Sam, a Registry enrolment officer and a Finance adviser. **Boundary:** a governed confirmed place enters registration; the story ends with an authorised, dated enrolment and reconciled entitlements or an explicitly owned outstanding service task. Module choices belong to AJ-18. **Timeline:** t-4 to t+1; annual registration recurs before t+52 and t+104. All weeks use [t = 23 September 2030](README.md#timeline-convention).

## The story

### An invitation with a clear purpose — t-4

Sam's Geography result has been verified and Admissions has confirmed the place. Registry receives the exact application, offer, course version and decision references. The officer checks whether the canonical person already exists before creating the prospective registration case. An imported acceptance arriving twice returns the same case; it does not produce two student numbers.

Sam receives a registration invitation explaining the remaining tasks and who can help. The account exposes personal-details and registration functions. It does not yet imply attendance, unrestricted learning access or an approved fee payment. Sam can see that the academic place is secure while registration remains incomplete.

### Identity and terms are checked — t-3

Sam checks the prefilled name, address and contact details, corrects an outdated address and supplies the required identity evidence through the authorised route. The address change retains its source and effective date. A similar person's record is presented only to a restricted identity reviewer; Sam's familiar email address is not sufficient grounds to merge them.

The verification provider initially returns an inconclusive result in an exception branch. Registry seeks the specified additional evidence or uses the configured authorised manual route. It neither rejects the academic place nor silently marks verification successful. On the main path verification succeeds, and Sam accepts the identified version of the terms in an accessible form. The officer records the applicable right-to-study check outcome without assuming that a passport or UCAS application answers every policy question.

### Financial readiness is a separate decision — t-3 to t-2

Before any enrolment exists, Registry asks Finance whether Sam is financially ready to register (A16-I03a). The request carries the registration case, the confirmed place, the home-fee-status decision and the applicable fee-policy reference. Finance records the approved funding/payment arrangement for this fixture and returns it to Registry, or returns a hold with a reason. A payment arrangement can permit registration under Northbridge's policy without pretending that the entire fee has been paid. If Sam disputes fee status, the issue returns to the Admissions owner and any resulting offer change is versioned.

An eligible student-finance branch has its own evidence and authorisation. Registration in advance of the study-start date is not evidence that Sam has started attending. The officer can schedule a confirmation task, but must wait for the facts required by that particular external confirmation. Real channel and eligibility rules remain deployment decisions.

### Registry authorises the enrolment — t-2

The Registry officer reviews identity, terms, the confirmed place and the approved financial arrangement. The decision creates or activates the intended enrolment record, with study starting at t and the exact approved course/route/diet binding. Registry then sends the authorised enrolment to Finance (A16-I03b), which books the dated fee liability against the arrangement it approved earlier and confirms that the two match. The decision time and effective study date are separate. No later catalogue release silently changes this binding.

Sam sees “Registration approved” and the start date, with separate service statuses below it. Authorised pre-entry welcome access can begin at t-1. That entitlement is explicit, rather than obtained by backdating attendance. The six compulsory module registrations are then confirmed by AJ-18 and supplied to teaching services by AJ-20.

### A usable account, not just a welcome email — t-2 to t+1

IAM acknowledges the correct account eligibility. The library and portal receive their required status, and the registration officer can see which consumers applied it. A delayed entitlement stays assigned to its service owner. Resending the original request does not create another account, and an independent employee role is not removed by a student-role update.

At t, arrival and start-of-study evidence are recorded by the relevant services. Any now-eligible external confirmations are authorised and reconciled. At t+1, Sam can use the expected learning services. The later annual cycle rechecks the next period's obligations after the progression decision; completing first registration does not automatically register Sam for all three years.

## Starting pack and responsibilities

Supply the AJ-06 confirmed-place evidence, canonical/source identity links, approved curriculum hand-off, the policies in the shared continuation, synthetic verification and financial-arrangement evidence, scoped actors and isolated consumer stubs. No active study or attendance fact is present initially. Independent fixtures must supply actual synthetic policy inputs, not an empty “approved” label.

| Role | Authority and restriction |
|---|---|
| Sam | Confirms details and terms; cannot verify their own evidence or approve registration. |
| Registry officer / identity reviewer | Own registration and restricted linkage decisions; cannot settle a fee-status dispute by changing academic criteria. |
| Finance/funding adviser | Own the financial arrangement and confirmation eligibility; cannot fabricate academic attendance. |
| IAM and other service owners | Apply the scoped eligibility version; cannot change the academic decision to bypass an outage. |

## Weekly walkthrough

| Scene | Time | Decision / evidence | Result and hand-off |
|---|---|---|---|
| A16-01 | t-4 | Accept the governed admissions outcome; reconcile aliases. | One prospective registration case and invitation. |
| A16-02 | t-3 | Verify identity, personal details and terms. | Attributable verification/acceptance or an owned evidence request. |
| A16-03 | t-3 to t-2 | Finance approves the applicable arrangement (A16-I03a). | Separate fee/financial-readiness state, not assumed payment. |
| A16-04 | t-2 | Registry authorises enrolment and its start date/binding; Finance books the liability (A16-I03b). | AJ-18 may confirm registrations; entitlement distribution begins. |
| A16-05 | t-2 to t-1 | Reconcile each consumer's applied version. | Welcome access works; missing receipts have service owners. |
| A16-06 | t to t+1 | Record the relevant start facts and authorise eligible external notifications. | Confirmations reconcile; annual registration tasks remain separate. |

## Owned interactions

The [shared exchange convention](README.md#exchange-and-evidence-convention) applies to every row.

| Interaction / reference | Trigger, direction and minimum payload | Key / authority | Applied-state evidence and failure path |
|---|---|---|---|
| A16-I01 / A06-I08; BP-01-007 | Admissions → Registry: confirmed application/offer version, aliases, course/intake, fee-status decision and evidence references. | Application + confirmation version; Admissions owns confirmation, Registry conversion. | Canonical person/case receipt; quarantine ambiguous identity, replay existing case. |
| A16-I02 / F-EWP-SIS-01; F-SIS-OIV-01, F-OIV-SIS-01 | Portal ↔ Registry and verification provider: validated self-service updates, terms version, verification request and scoped result. | Update/request ID + version; provider evidence plus Registry authority. | Versioned personal fact and verification decision; inconclusive result stays pending with owner. |
| A16-I03a / GI-11 | Registry ↔ Finance before the enrolment decision: registration case, confirmed place/offer version, fee-status decision and fee-policy reference; returned arrangement or hold with reason. No reference flow covers this step: F-SIS-FIN-01 starts from an approved enrolment. | Registration case + arrangement version; Finance owns the arrangement decision. | Arrangement receipt that Registry cites in its decision; a hold or timeout leaves registration pending with an owner, not refused. |
| A16-I03b / F-SIS-FIN-01, F-FIN-SIS-01 | SRS ↔ Finance after the enrolment decision: authorised enrolment, effective dates and the arrangement reference from A16-I03a; returned dated liability and later payment/hold results. | Enrolment + liability version; Finance owns the ledger. | Liability matches the approved arrangement, or a mismatch task is raised; reconcile arrangement versus cash received; an unexplained hold is reviewed, not an automatic withdrawal. |
| A16-I04 / F-SIS-IAM-01, F-IAM-SIS-01 | SRS ↔ IAM: person, scoped role/eligibility, start/end dates and registration authority; account/lock result returned. | Person + entitlement version; IAM owns credentials. | Applied role/version and account status; retain security locks and unrelated employment roles. |
| A16-I05 / F-SIS-EWP-01, F-SIS-CRM-01, F-SIS-UCAS-01 | SRS → portal, CRM and applicable external route after authorised status: enrolment state/date/version and permitted identifiers. | Status version + recipient; Registry decision. | Portal status and external receipt reconcile; no-show/deferral needs its own governed decision. |
| A16-I06 / F-SIS-SLC-01, F-SLC-SIS-01 | SRS ↔ eligible student-finance route: authorised confirmation with its required facts; returned entitlement/payment implications. | Confirmation type + enrolment + version; funding signatory. | Submission/application evidence through supported channel; do not equate registration with attendance or receipt with loan payment. |

Library entitlement delivery is owned by A17-I01; module confirmation by A18-I03; VLE/attendance rosters by A20-I01. Registration waits for their required outcome receipts where relevant; it does not duplicate their contracts. Documents/retention hand off to [AJ-38](aj-38-records-rights-and-retention.md), which defines search, disclosure, correction and disposition evidence.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A16-AC01 | Complete registration with approved identity, terms and arrangement. | One enrolment, correct curriculum binding and study-start date; distinct financial and per-service states. |
| A16-AC02 | Deliver confirmed acceptance twice or nominate an ambiguous person match. | Replay reuses the case; ambiguity requires governed linkage, never a destructive automatic merge. |
| A16-AC03 | Verification is inconclusive or inaccessible to Sam. | Accessible evidence/manual-review route with owner; no assumed pass or academic rejection. |
| A16-AC04 | Finance has an arrangement but no full payment, or a disputed fee status. | Apply the configured registration policy; show actual financial state; route dispute to the authorised owner. |
| A16-AC09 | Finance receives a readiness request with no enrolment yet, or the post-decision liability differs from the approved arrangement. | Readiness is keyed on the registration case, not an enrolment; a liability mismatch raises an owned task and the enrolment decision stands. |
| A16-AC05 | Request an attendance-based funding confirmation at t-2. | Hold until required start/attendance facts exist; retain the authorised registration. |
| A16-AC06 | Lose an IAM receipt or receive a stale entitlement after a later version. | Query/reconcile and replay safely; no duplicate account or stale role overwrite. |
| A16-AC07 | Another tenant or an unappointed helper attempts access. | Access denied; sensitive evidence remains purpose-restricted and access logged. |
| A16-AC08 | Stage progression is ratified but annual registration is incomplete. | Next-year registration/access remains explicitly pending under policy; no automatic completion. |

## Traceability, implementation and review

BP-01-007 and BP-02-001–005/010 in the [process inventory](../../business-processes/process-inventory.md); SID-001, SID-005, SID-007, ENR-001, ENR-003, ENR-004, ENR-005, ENR-008, IAM-001, IAM-002 and UCR-002 in [core requirements](../../requirements/functional-requirements.md); IGA-001, IGA-002 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-19/GI-20/GI-23 cover channel, assisted access and identity decisions.

The [capability matrix](../current-capabilities.md) records registration as partial. Open decisions for Registry, Finance/funding, identity/privacy and IAM owners: policy inputs, effective dates, manual alternatives and confirmation authority. The closing bundle contains source decisions, registration authority, curriculum binding, terms/verification references and each required consumer receipt or owned exception.
