# AJ-17 — Becoming part of the campus

Status: **Proposed narrative v0.6**, 13 November 2026 · [Document status](README.md#status-of-these-documents) · [Shared continuation](taught-student-fixture.md) · [Registration](aj-16-registration-and-entitlements.md)

**Perspective:** Sam, an accommodation officer and a librarian. **Boundary:** accommodation enquiries before entry through move-in, library use and first-year departure; final departure reconnects at AJ-29. **Timeline:** t-24 to t+40, with a final library/access review at t+145 onwards. Use the [shared anchor](README.md#timeline-convention).

## The story

### A place to live is a separate commitment — t-24 to t-7

After responding to the offer, Sam considers accommodation. The housing service explains room types, costs, accessibility, reservation eligibility and cancellation conditions using approved information. Sam's applicant identity can support an enquiry without pretending that an enrolled-student record already exists. A reservation is conditional on its stated terms, not a guarantee of a confirmed academic place.

Sam receives booking `ACC-SAM-001` and can see which housing tasks are outstanding. A parent helping with the booking is not automatically given access to grades, financial evidence or the application. If help is formally authorised, its scope and expiry are recorded. An unclear housing requirement goes to the housing officer, not into the academic selection score.

### Preparing the room and library account — t-3 to t-1

The accommodation officer verifies the relevant status, agrees the allocation and publishes arrival instructions. Once Registry authorises Sam's enrolment, the housing service reconciles that fact with its booking. It does not erase its own reservation history when an applicant becomes a student.

The library receives the separate entitlement authorised by AJ-16. Sam's library account can be ready for welcome access from t-1 under the scenario policy. A pre-existing library identity is matched through governed identifiers so another account is not created. Authentication and licensed-resource access remain separate: a successful login is not proof that every electronic resource is available.

### Arriving and settling in — t to t+2

Sam checks in at t, receives the room inventory and knows how to report a fault. The accommodation record says “checked in”. Registry still relies on its own authorised enrolment, not a housing check-in, when showing academic status.

Sam joins a library induction, borrows a book and opens an essential electronic resource. A resource-access failure is owned by the library or learning-technology service. The librarian checks the entitlement and resource permissions rather than asking Registry to re-enrol Sam. In a separate housing branch, a room fault prompts a transfer: the officer agrees the new allocation, retains the old dates and reconciles keys, inventory and any financial difference.

### Obligations stay with their service — t+3 onwards

A loan becomes overdue in an exception branch. The library records its actual obligation and communicates its resolution route. Under this fixture a fine does not block academic results or an award. The university does not quietly turn a service debt into an academic sanction.

Changes of address or booking are exchanged only as permitted. A student's interruption or withdrawal reaches the housing and library owners as an authorised status change, not as a command to abandon a housing contract without review. The owners decide the service consequences under their policies and confirm them back.

### Leaving a room without leaving the university — t+40

At the end of the first accommodation period, Sam checks out, returns keys and resolves the inventory. Sam has progressed and will return to study, so housing checkout does not close the student identity or cancel library access automatically. At graduation, AJ-29 initiates a different review of student entitlements and any permitted alumni service. Historic borrowing and booking records follow their retention policies rather than being erased at checkout.

## Starting pack and responsibilities

Supply Sam's permitted applicant context, fictional housing terms and booking window, verified source aliases, library eligibility policy and the approved registration outcome when its scene occurs. Housing/loan receipts are synthetic outcomes to generate, not pre-existing success labels. A self-contained departure scene starts with an actual fixture allocation, inventory, loan state and relevant dated academic status.

| Role | Owns | Boundary |
|---|---|---|
| Sam / explicitly authorised helper | Booking choices, inventory responses, loan resolution. | Assistance has scoped permission, not general record access. |
| Accommodation officer | Reservation, contract/allocation, check-in/out and room changes. | Occupancy cannot create or withdraw academic enrolment. |
| Librarian | Resource access, loans and obligations. | No academic hold from a fine under this fixture. |
| Registry / IAM / Finance | Academic status / accounts / their ledger consequences. | Consume housing/library outcomes without taking over the service's process. |

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A17-01 | t-24 to t-7 | Explain terms; create permitted applicant booking. | Conditional reservation with explicit scope and cancellation terms. |
| A17-02 | t-3 to t-1 | Confirm allocation; reconcile registration and library eligibility. | Arrival instructions and applied library entitlement. |
| A17-03 | t to t+2 | Check in and demonstrate access/induction. | Occupancy and resource-access evidence distinct from enrolment. |
| A17-04 | t+3 to t+30 | Resolve a room/loan/access issue in the relevant branch. | Versioned service resolution and notified student. |
| A17-05 | t+40 | Complete first-year room checkout. | Housing closes that allocation; continuing academic rights remain. |
| A17-06 | t+145 to t+156 | Consume final leaver decision from AJ-29. | Student/alumni rights and remaining obligations reconciled separately. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and minimum payload | Key / authority | Acknowledgement and failure path |
|---|---|---|---|
| A17-I01 / F-SIS-LIB-01 | SRS → Library after authorised eligibility/change: person alias, programme context only if needed, access scope and dates. | Person + entitlement version; Registry eligibility, Library application. | Existing/new account link and applied scope/version; reconcile duplicates and failed access. |
| A17-I02 / F-LIB-SIS-01 | Library → SRS on relevant obligation/change: obligation ID, state, amount if applicable, due date and resolution reference. | Obligation + version; Library source authority. | SRS stores permitted consequence/context; stale cleared debt cannot reappear, and no academic block is inferred. |
| A17-I03 / F-SIS-ACC-01 | SRS → ACC on registration/status change: identifiers, dates and minimum allocation-eligibility context. | Enrolment status version; Registry authority. | ACC links existing booking and acknowledges status; mismatch is owned, not a second booking. |
| A17-I04 / F-ACC-SIS-01 | ACC → SRS on allocation/check-in/out: booking/allocation IDs, effective dates and occupancy state. | Allocation + version/action; housing officer authority. | Reconciled service fact; checkout does not itself terminate enrolment. |
| A17-I05 / GI-02, GI-11, GI-20 | Applicant/CRM ↔ ACC before enrolment: booking request, contact authority, terms and payment reference where required. | Booking action + revision; housing process. | Booking/terms receipt and service-owned financial reconciliation; external booking/payment transport still requires definition. |

AJ-16 owns IAM eligibility and AJ-29 owns the eventual academic leaver decision. The library and housing services apply their own scoped consequences rather than duplicating those decisions.

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A17-AC01 | Reserve, allocate, check in and activate library access on the main path. | One linked booking/account and separate occupancy/academic states. |
| A17-AC02 | Retry allocation or library activation after a lost receipt. | Existing operation reconciles; no extra room reservation/account. |
| A17-AC03 | Room fault requires transfer. | Both dated allocations and agreed terms retained; student knows the new arrangements. |
| A17-AC04 | Book is overdue when academic results are released. | Service resolution continues; no academic result/award block under the fixture. |
| A17-AC05 | First-year room checkout occurs while student continues. | Housing period ends; continuing student/library eligibility is not blindly revoked. |
| A17-AC06 | Check-in exists but registration is pending, or a parent requests grades. | Neither occupancy nor relationship bypasses academic/privacy authority. |
| A17-AC07 | Accommodation or library unavailable to assistive technology. | Accessible/assisted alternative records equivalent choices and authority; access fault has an owner. |

## Traceability, implementation and review

BP-02-005/012 and BP-08-005 in the [process inventory](../../business-processes/process-inventory.md); ACC-001, ACC-002, LIB-001, LIB-002 and IAM-001 in [core requirements](../../requirements/functional-requirements.md); XIC-001–007 and IGA-013 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-02/GI-11/GI-15/GI-20 cover pre-entry booking, money, alumni and assisted contacts.

The [reference portfolio](../../reference/revelation-student-records-reference-model.md) identifies library/accommodation integrations as not implemented/tracked; this story specifies their proposed behaviour. Open decisions for Housing, Library, Registry, Finance and privacy/accessibility owners: contract consequences, library licensing, leaver access, representative authority and retention. Closing evidence is the allocation/loan/access history and source status/receipts, consumed by AJ-06 during arrival and AJ-29 during departure.
