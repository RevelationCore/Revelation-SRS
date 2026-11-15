# AJ-07 — An alternative entry route

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Extension fixture](change-and-exceptions-fixture.md) · [Original admissions journey](aj-06-discovery-application-and-arrival.md)

**Perspective:** Alex, a Clearing adviser and Admissions; Robin provides separate deferral/no-show branches. **Boundary:** changed applicant circumstances through an explicitly accepted place, deferral or closure and accurate external responses. **Timeline:** Alex t-6 to t-2; Robin's deferral t-8 to t-4 and next-intake recheck before t+52; no-show alternative t to t+2. Dates are [fictional weeks](README.md#timeline-convention), not published UCAS deadlines.

## The story

### Alex considers a different university — t-6

Alex misses another university's conditions and contacts Northbridge about Environmental Data Science. The adviser records enquiry `CLEAR-ALEX-001`, the existing application/source alias and Alex's contact preferences. A changed email address is not sufficient reason to create a second identity or merge an uncertain match.

The adviser shows the approved course, fees and remaining capacity. Alex's verified B grades in Mathematics, Geography and Computer Science meet this fixture's academic criteria, but the officer still performs the institution's selection and evidence checks. A previous rejection elsewhere is neither a rejection nor an offer here.

### A short reservation is not a confirmed place — t-6 to t-5

Admissions records the capacity source/version and a reservation with an exact expiry. Two advisers cannot consume the same last place. A seat becoming available does not waive entry criteria, and a qualified applicant cannot be promised a seat already allocated.

An authorised officer creates `OFF-ALEX-001@1`, identifying the approved route, intake, fee-status decision, terms and response window. Alex reads the actual course information and confirms the choice through the permitted channel. Staff retain the external reference and acknowledgement rather than pretending a telephone conversation completes every UCAS action. The precise live channel is a deployment decision.

### Confirmation reaches registration — t-4 to t-2

After evidence and the applicable external acceptance reconcile, Admissions confirms Alex's place. The governed conversion boundary creates or links the prospective record and passes the exact offer, curriculum, aliases and fee-status decision to AJ-16. The registration team still checks identity, terms and financial readiness before authorising enrolment.

A response arriving after reservation expiry does not silently revive the seat. Admissions rechecks capacity and explains the outcome. A lost confirmation receipt is reconciled against the same operation, not submitted as a second acceptance. Declining or cancelling closes the appropriate offer/reservation with its reason and notifications, without deleting the application history.

### Robin defers rather than arriving late — t-8 to t-4, separate person

Robin asks to move an accepted 2030 place to 2031. Admissions checks whether deferral is permitted and obtains the independently accepted 2031 intake, the intended curriculum version, capacity, fee/condition changes and Robin's acknowledgement. The fixture requires these inputs; it does not create next year's availability by adding one to a date.

The authorised deferral links predecessor and successor offer/intake records. Current-year registration invitations and attendance expectations are suppressed. Registry has a future prospective case, not an active 2030 enrolment. Before t+52, Admissions and Registry revalidate outstanding conditions and then perform the normal registration gates. No-show chasing must not override an already authorised deferral.

### No-show needs investigation — t to t+2, alternative branch

In a separate copy where Robin did not defer, an accepted applicant has not completed registration or arrived. Staff check contact attempts, delayed arrival, known decisions and service evidence. Housing check-in alone is not academic registration; absence from housing is not proof of withdrawal.

After the configured response/review process, an authorised officer records the appropriate no-show or other disposition and reconciles the external route, CRM and registration tasks. An unverified assumption cannot be reported as confirmed attendance. Any future application remains linked to the historical record without inheriting a false withdrawal decision.

### Courses awaiting approval use two separate permissions

The variant follows the updated original fixture: permission to advertise before approval does not itself permit offers. Early offers require the separate admissions setting and joint admissions/quality authority, must state the approval status and expected date, and cannot become a confirmed place before approval. Refusal or material change triggers individual communication and options; changing an applicant's course requires an explicit new choice/offer decision. Both settings remain off on Alex's main path.

## Starting pack and authority

Supply Alex's source application/aliases, verified results, approved EDS intake and criteria, actual capacity snapshot, fee-status evidence and channel contract. Robin's branch additionally supplies a permitted, accepted next intake and deferral policy. Admissions owns selection/offers/confirmation; the applicant owns their choice; Registry owns conversion/registration; service owners own reservation and message application. Clearing staff cannot approve a new curriculum or an early-offer policy exception themselves.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A07-01 | t-6 | Receive Alex's enquiry and verify identity/results. | Assessed application against the approved intake. |
| A07-02 | t-6 to t-5 | Reserve capacity and issue authorised offer. | Dated offer and expiring reservation, no enrolment. |
| A07-03 | t-5 to t-4 | Reconcile Alex's choice and external acceptance. | Confirmed place or owned discrepancy. |
| A07-04 | t-4 to t-2 | Governed conversion and registration hand-off. | One prospective record; separate registration gates. |
| A07-05 | t-8 to t-4, Robin | Assess and authorise deferral to supplied 2031 intake. | Linked future offer; current-year invitations suppressed. |
| A07-06 | Before t+52, Robin | Recheck future conditions and registration readiness. | Next-year authority, not automatic rollover. |
| A07-07 | t to t+2, alternative | Investigate non-arrival and decide disposition. | Accurate closure/delay outcome and external reconciliation. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A07-I01 / F-UCAS-SIS-01 | Permitted admissions source → SRS: application, Clearing/choice event, source alias and version. | Provider event + version; trusted channel. | Accepted mapping or identity quarantine; replay cannot create another person. |
| A07-I02 / GI-03; BP-01-003/006 | Admissions ↔ applicant/permitted channel: offer, exact course/intake, reservation, terms and response. | Offer revision + action; authorised officer/applicant respectively. | Choice/offer acknowledgement; expired reservation requires recheck, not assumed success. |
| A07-I03 / A16-I01; UCR-002 | Admissions → Registry: confirmed place and governed identity/curriculum evidence. | Application + confirmation version. | Prospective case receipt; active enrolment requires AJ-16 authority. |
| A07-I04 / F-SIS-UCAS-01; GI-03 | Admissions/Registry → applicable external route: authorised deferral, cancellation or no-show outcome and predecessor reference. | Disposition version + recipient; relevant source authority. | External applied/accepted state or owned channel exception; preserve earlier offer history. |
| A07-I05 / F-SIS-CRM-01, F-SIS-EWP-01 | SRS → CRM/portal: permitted current/future status, choices and next tasks. | Outcome publication version + audience. | Correct invitations/contact state; failed delivery assigned, no fabricated acknowledgement. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A07-AC01 | Alex meets criteria and capacity is available. | New assessed offer, verified choice and one confirmed-place hand-off. |
| A07-AC02 | Two applicants compete for the last seat. | Single allocation under authority; other case remains owned, no oversubscription by retry. |
| A07-AC03 | Choice arrives after reservation expiry. | Recheck capacity/authority; no automatic revival or silent rejection. |
| A07-AC04 | External acceptance is duplicated or identity uncertain. | Same receipt or governed quarantine; no duplicate student record. |
| A07-AC05 | Robin requests next-year deferral without an accepted intake. | Decision remains pending; no invented course availability or active enrolment. |
| A07-AC06 | Approved deferral meets current-year no-show automation. | Deferral respected; inappropriate chasing/reporting prevented. |
| A07-AC07 | Non-arrival has no authorised disposition yet. | Owned investigation; no positive attendance or automatic withdrawal. |
| A07-AC08 | Advertising is permitted but early offers are disabled. | Enquiry allowed; offer blocked. Enabled early offers still require joint authority and course approval before confirmation. |
| A07-AC09 | Provisional course is refused or materially changed. | Individual explanation and explicit alternatives/choice; offer never silently moved. |

## Traceability, implementation and review

BP-01-001–004/006/007 and BP-02-011 in the [process inventory](../../business-processes/process-inventory.md); UCR-001–003 and ENR-004 in [core requirements](../../requirements/functional-requirements.md); IGA-001/002 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-03/GI-19 cover complete offer exchange and real channel boundaries.

The [capability matrix](../current-capabilities.md) records admissions and external exchanges as partial. Review owners, unassigned: admissions policy, quality, Registry, recruitment, identity and UCAS integration owners. Agree deadlines, reservation/deferral policy, next-intake evidence and external acknowledgements. Closing evidence is the versioned offer/choice/disposition, capacity decision, accepted external state and governed registration hand-off.
