# AJ-32 — One person, distinct student and employee obligations

Status: **Proposed narrative v0.8**, 14 November 2026 · [Document status](README.md#status-of-these-documents) · [Research fixture](research-and-partnership-fixture.md) · [Research award](aj-33-thesis-examination-and-award.md)

**Perspective:** Morgan, a teaching coordinator, HR, Finance and Payroll. **Boundary:** approved teaching employment and separately eligible student support through verified payment and purpose-specific role closure. **Timeline:** first appointment tR+20 to tR+32; second appointment tR+160 to tR+184. Here tR = 22 September 2031 = t+52.

## The story

### The teaching opportunity is a separate appointment — tR+18 to tR+20

A teaching coordinator invites Morgan to assist with an introductory data class. Morgan is already a research student, but that does not make them an employee or authorise payment. HR checks the proposed duties, eligibility, contract, working pattern and applicable constraints against supplied policies. The supervisory team reviews any permitted impact on the research plan without becoming the employer.

HR approves `EMP-MORGAN-001`, effective tR+20 to tR+32. Identity reconciliation links it to the same person as the candidature, retaining distinct employment and student identifiers. An ambiguous match pauses the link for an authorised identity reviewer; matching names or bank details alone cannot merge records.

### Access follows duties and dates — tR+20 to tR+22

The academic assignment owner approves the classes and role. IAM applies the required employee access, while learning services receive the teaching assignment. Morgan may view the assigned class information but not every student's results or support evidence. The research account's existing access does not justify unrestricted marking rights.

The teaching coordinator confirms preparation and supervision for the assigned work. If HR approval or mandatory readiness is incomplete, duties remain pending. Staff must not ask Registry to label Morgan a tutor merely to bypass an employment check or an access fault.

### Evidence supports a payment instruction — tR+23 to tR+24

Morgan records 12 hours worked against the approved activity and period. The teaching manager verifies the claim and authorises it under `GTA-MORGAN-2032@1`. At the fictional £25 gross hourly rate, the authorised gross claim is £300. Payroll applies the supplied pay rules; the narrative neither invents net pay nor assumes the stipend has the same treatment.

Separately, the eligible £1,800 stipend instalment comes from the studentship schedule and its own authority. The system can show two entitlements for the same person without combining them into one indistinguishable payment. It retains the claim, funding source, period and payment-operation identifiers for each.

### A delayed payment needs reconciliation — tR+25 to tR+26

The stipend confirmation arrives, but the salary payment is delayed by an invalid payroll alias. The case view shows the £1,800 confirmed and the £300 salary instruction unresolved. A successful submission receipt is not evidence that Morgan received salary.

HR/Payroll resolve the alias through the authorised mapping route. The operator queries the instruction's applied state before replaying it, reuses the original payment operation and records the correction provenance. If the first instruction had already been paid, the service would return that receipt instead of issuing another £300. A real overpayment would require a separate recovery decision and communication, not a negative student credit entry.

Morgan receives an explanation, owner and expected next action. Payroll's payment confirmation closes the financial task; it does not change research progression or academic marks. Finance reconciles the correct funding/ledger consequences without creating a duplicate ledger inside SRS.

### Closing employment must not close candidature — tR+32

At the appointment end, HR confirms the employment status and IAM removes only expired employee entitlements. Research study, supervision and eligible student services continue. Teaching evidence and payment history follow their own retention controls. A later replay of the appointment-start event cannot restore an ended role.

A security lock remains independently effective; neither current student status nor a salary instruction is permission to override it. [AJ-36](aj-36-access-and-service-support.md) supplies the service-desk route, with explicit source and recovery evidence required.

### Completion reverses the direction of the test — tR+160 to tR+184

Morgan receives a second independently approved teaching appointment, `EMP-MORGAN-002`. It remains valid when the research award is conferred at tR+177. AJ-33 supplies the student completion decision; IAM reviews student access while preserving the employment scope through tR+184.

Stipend support does not restart with the teaching appointment. The second contract has its own pay instructions and approval evidence. When it ends, HR closes that role independently. A person can therefore have a conferred academic award and active employment without conflicting status records or duplicate identities.

## Starting pack and authority

Supply the actual candidature/funding state for the scene, both separately approved employment contracts when applicable, staff eligibility, assignments, claimed hours/rate, payroll aliases and isolated payment responses. Use only synthetic identity and payment data. HR owns employment; academic managers authorise duties/work claims; the studentship owner authorises support eligibility; Payroll owns payment execution; Finance owns ledger consequences; IAM owns scoped access application. No model or integration operator decides entitlement.

## Weekly walkthrough

| Scene | Time | Decision / evidence | Outcome |
|---|---|---|---|
| A32-01 | tR+18 to tR+20 | Verify eligibility and approve teaching appointment. | One person linked to distinct student/employee roles. |
| A32-02 | tR+20 to tR+22 | Assign duties and provision scoped access. | Applied teaching permissions and readiness. |
| A32-03 | tR+23 to tR+24 | Verify 12 hours and authorise salary; separately schedule stipend. | £300 gross claim and £1,800 instalment remain distinct. |
| A32-04 | tR+25 to tR+26 | Reconcile delayed salary and correct alias. | One payment effect or owned failure, no duplicate disbursement. |
| A32-05 | tR+32 | End first employment assignment. | Student role and legitimate research access retained. |
| A32-06 | tR+160 to tR+184 | Second appointment spans research completion, then ends. | Student completion and employee closure applied independently. |

## Owned interactions

Apply the [shared exchange convention](README.md#exchange-and-evidence-convention).

| Interaction / reference | Trigger, direction and payload | Key / authority | Applied-state evidence / recovery |
|---|---|---|---|
| A32-I01 / F-SIS-PAY-01 | Eligible studentship owner/SRS → payment service: authorised support instruction, period, amount and source award. | Entitlement period + instruction version; support authority. | Accepted/payment state distinct; repeats reuse the same operation. |
| A32-I02 / F-SIS-HR-01; GI-13 | SRS ↔ HR via agreed contract: permitted student-staff linkage and separately returned employment approval/status. | Person-role linkage + employment revision; HR decides employment. | Verified aliases and dated role; reference flow alone does not define a full HR appointment API. |
| A32-I03 / F-SIS-PAY-01; GI-13 | Authorised teaching-pay owner → Payroll: claim, verified hours/rate, employment reference and cost allocation. | Claim + authorisation version; designated manager. | Payroll instruction receipt; invalid alias remains owned, not paid by assumption. |
| A32-I04 / F-PAY-SIS-01; GI-13 extension | Payroll → SRS/financial owner: separately identified stipend/salary payment, rejection or correction state. | Payment operation + response version; Payroll source. | Reconciled instruction/receipt; salary confirmation extends the reference stipend scope and needs an agreed contract. |
| A32-I05 / F-SIS-IAM-01; A16-I04 | Authorised role owners → IAM: independently dated student/employee entitlements. | Role eligibility version + target. | Correct scoped access; ending one role preserves the other and security locks. |

## Acceptance cases

| Case | Input / action | Expected result |
|---|---|---|
| A32-AC01 | Research student is invited to teach without HR approval. | Employment/duties remain pending; candidature creates no pay entitlement. |
| A32-AC02 | Approve 12 hours at £25 gross. | £300 gross instruction; deductions/net pay remain Payroll's supplied calculation. |
| A32-AC03 | Same person receives stipend and salary instructions. | Separate eligibility, funding, period and payment references. |
| A32-AC04 | Salary alias fails after stipend is paid. | Only salary remains unresolved; no duplicate stipend or invented salary receipt. |
| A32-AC05 | Replay payment after an ambiguous timeout. | Query/reuse original operation; exactly one authorised payment effect. |
| A32-AC06 | First employment ends while candidature continues. | Employee rights end; valid student/research rights remain. |
| A32-AC07 | Research completion occurs during second employment. | Student effects applied separately; valid employee role retained to its own end. |
| A32-AC08 | Duplicate identity, excessive access or a security lock is encountered. | Governed identity/access review; no automatic merge, broad permission or lock bypass. |

## Traceability, implementation and review

BP-02-005/012 and BP-03-006 in the [process inventory](../../business-processes/process-inventory.md); HRP-001, FIN-003/004 and IAM-001/002 in [core requirements](../../requirements/functional-requirements.md); IGA-001–004 and XIC-001–007 in [P0 requirements](../../requirements/business-process-p0-functional-requirements.md). GI-13 is the explicit employment/payroll contract gap.

The [capability matrix](../current-capabilities.md) does not establish a complete HR/payroll employment journey. Review owners, unassigned: HR, Payroll, Finance, research funding, teaching managers, IAM and privacy. Agree eligibility, pay evidence, corrections and role precedence. Closing evidence is the authorised contracts/claims, distinct payment receipts and independent role history, not a combined student-status flag.
