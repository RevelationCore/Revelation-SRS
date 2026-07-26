import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..', 'docs', 'business-processes');

const domains = {
  '01': {
    dir: '01-recruitment-and-admissions',
    name: 'Recruitment and admissions',
    england: 'UCAS cycle rules and provider admissions policy apply; qualification and safeguarding routes may differ by applicant.',
    scotland: 'Qualifications Scotland result dates, Scottish qualifications and typically four-year degree entry patterns must be configurable.',
    wales: 'Welsh-language service and communication preferences, Welsh qualifications and provider policy must be preserved.',
    ni: 'Northern Ireland qualifications, cross-border applicants and provider admissions policy must be supported.',
  },
  '04': {
    dir: '04-learning-engagement-and-support',
    name: 'Learning, engagement and support',
    england: 'Provider policy operates alongside English regulatory conditions and, where applicable, Student sponsor duties.',
    scotland: 'Provider regulations and Scottish academic terminology apply; funding and support ownership may differ.',
    wales: 'Provider regulations, Welsh-language communication and Medr context apply.',
    ni: 'Provider regulations and Department for the Economy context apply.',
  },
  '05': {
    dir: '05-assessment-and-results',
    name: 'Assessment and results',
    england: 'Awarding-provider regulations and external examining arrangements apply within the English regulatory context.',
    scotland: 'SCQF levels, Scottish degree structures and provider senate regulations must be configurable.',
    wales: 'CQFW context, Welsh-language operation and awarding/partner responsibilities must be configurable.',
    ni: 'Provider regulations, external examining and any professional-body requirements apply.',
  },
  '06': {
    dir: '06-progression-awards-and-graduation',
    name: 'Progression, awards and graduation',
    england: 'Provider award regulations apply within the English regulatory framework.',
    scotland: 'SCQF levels, ordinary/honours routes and Scottish degree structures require configurable rules.',
    wales: 'CQFW context, bilingual documentation and awarding/partner responsibilities may apply.',
    ni: 'Provider award regulations and Department for the Economy context apply.',
  },
  '07': {
    dir: '07-regulatory-and-statutory-reporting',
    name: 'Regulatory and statutory reporting',
    england: 'OfS and other England-specific requirements apply only to providers in scope.',
    scotland: 'SFC and SAAS requirements apply in addition to UK-wide collections; do not reuse England-only codes.',
    wales: 'Medr and Student Finance Wales requirements apply, including Welsh-medium data uses.',
    ni: 'Department for the Economy and Student Finance NI requirements apply.',
  },
  '08': {
    dir: '08-record-governance-and-lifecycle',
    name: 'Record governance and lifecycle',
    england: 'UK GDPR and the Data Protection Act 2018 apply; provider retention and legal obligations define implementation.',
    scotland: 'The common data-protection framework applies with Scottish provider governance and public-records obligations where relevant.',
    wales: 'The common data-protection framework applies; Welsh-language communication preferences must be honoured.',
    ni: 'The common data-protection framework applies with Northern Ireland provider governance.',
  },
};

const P = (id, title, domain, workflow, record, trigger, actors, steps, alternatives, exceptions, integrations, sources, gap) => ({
  id, title, domain, workflow, record, trigger, actors, steps, alternatives, exceptions, integrations, sources, gap,
});

const processes = [
  P('BP-001', 'Receive an application', '01', 'W001', 'application and applicant identity', 'A UCAS, other admissions-service or direct application arrives',
    ['Applicant', 'Admissions System', 'Admissions Officer', 'Identity Service'],
    ['receive the application with channel and cycle identifiers', 'validate schema, course/intake and minimum required fields', 'match or create the applicant identity without merging uncertain matches', 'store the immutable received payload and create the working application', 'acknowledge receipt and publish the application-received state', 'route incomplete, duplicate or restricted applications to an owned worklist'],
    ['Direct, agent, PGR or partner application uses the same canonical application with channel-specific evidence.', 'A later corrected payload creates a version and preserves the original.'],
    ['Unknown course/intake is quarantined rather than guessed.', 'Probable duplicate identity is held for BP-058.'],
    ['UCAS/application service → SRS: application', 'SRS → Applicant portal: acknowledgement'], 'SRC-051–SRC-053', 'Current W001 does not separate immutable received payload, identity resolution and working application.'),
  P('BP-002', 'Assess an application', '01', 'W001', 'assessment evidence and admissions decision recommendation', 'A complete application enters an assessable queue',
    ['Admissions Officer', 'Academic Selector', 'Applicant', 'Safeguarding/Compliance Specialist'],
    ['confirm the applicable published entry criteria and decision authority', 'review academic evidence and contextual data under the configured policy', 'request only necessary missing evidence or assessment activity', 'record each assessment outcome, assessor and evidence version', 'complete any interview, audition, portfolio or research-fit assessment', 'record a recommendation and route it to an authorised decision maker'],
    ['Contextual admissions or recognition-of-prior-learning rules add governed factors.', 'PGR assessment includes proposal, supervisory capacity and research fit.'],
    ['Conflict of interest causes reassignment.', 'Suspected fraud follows a restricted investigation and is not encoded as an adverse identity fact without authority.'],
    ['SRS ↔ document/assessment services: evidence and outcome'], 'SRC-052–SRC-054', 'Assessment criteria versions, evidence and recommendations are not durable first-class records.'),
  P('BP-003', 'Make and manage an offer', '01', 'W001', 'offer, conditions, response and history', 'An authorised admissions decision permits an offer',
    ['Admissions Officer', 'Applicant', 'Admissions System', 'UCAS/Admissions Service'],
    ['select the approved programme, intake, mode, fee status basis and offer type', 'create individually testable academic and non-academic conditions', 'authorise the offer under delegated authority', 'publish the offer through the authoritative channel', 'record delivery and the applicant response with source timestamp', 'version any authorised change and close declined, withdrawn or expired offers'],
    ['An alternative-course or deferred-entry offer requires explicit applicant acceptance.', 'A direct offer follows provider response rules without inventing UCAS statuses.'],
    ['Conflicting responses are quarantined and reconciled with the authoritative channel.', 'An offer change after acceptance requires impact review and a new auditable version.'],
    ['SRS ↔ UCAS/admissions service: decision and reply', 'SRS → communications: offer'], 'SRC-051–SRC-053', 'Offer conditions and authoritative response reconciliation need finer-grained records.'),
  P('BP-004', 'Confirm offer conditions', '01', 'W001', 'condition evidence, verification and confirmation decision', 'Evidence or examination results become available for a conditional offer',
    ['Applicant', 'Admissions Officer', 'Qualification/Results Service', 'Admissions System'],
    ['freeze the offer and condition versions being tested', 'receive and provenance results or applicant evidence', 'verify authenticity and map evidence to each condition', 'record met, waived, unmet or pending per condition with authority', 'make the overall confirmation decision including authorised alternatives', 'publish and reconcile the outcome with the applicant channel'],
    ['A narrowly missed condition may produce an authorised changed-course offer.', 'A non-academic condition can remain pending after academic confirmation only where policy permits.'],
    ['Embargoed results remain access-controlled until release.', 'Conflicting or unverifiable evidence holds confirmation for review.'],
    ['Awarding/results services → SRS: results', 'SRS ↔ UCAS: confirmation decision'], 'SRC-051–SRC-053', 'Per-condition evidence and confirmation authority are not fully modelled.'),
  P('BP-005', 'Create and assign a CAS', '01', 'W012', 'CAS request, evidence, assignment and sponsor history', 'An eligible international applicant needs Student-route sponsorship',
    ['Applicant', 'International Compliance Officer', 'SRS', 'UKVI Sponsor Management System'],
    ['confirm the current Student sponsor guidance version and responsible sponsor', 'validate unconditional status, identity, immigration history, course and financial evidence', 'assess academic progression, English language and genuine-student evidence where required', 'approve the CAS request using segregation of duties', 'create and assign the CAS through the Sponsor Management System', 'record the CAS number, assigned data, evidence snapshot and later status changes'],
    ['A continuing student or course change follows the applicable in-country/overseas route.', 'A partner or study-abroad arrangement records the actual sponsor and teaching locations.'],
    ['Do not assign when evidence, licence scope or course eligibility is unresolved.', 'Correct an SMS error through the governed sponsor route and retain both versions.'],
    ['SRS ↔ UKVI SMS: CAS assignment/reporting'], 'SRC-001–SRC-002', 'W012 needs a durable eligibility checklist, approval and exact assigned-CAS snapshot.'),
  P('BP-006', 'Place an applicant through Clearing', '01', 'W001 partial', 'Clearing contact, permission, choice and confirmed place', 'An eligible applicant seeks a place on a course with a declared vacancy',
    ['Applicant', 'Clearing Adviser', 'Admissions Officer', 'UCAS'],
    ['confirm current Clearing eligibility and retrieve the authoritative application', 'check live course/intake capacity and essential entry requirements', 'record the discussion and time-limited provisional permission', 'issue the applicant instruction to add the Clearing choice', 'receive and match the formal UCAS choice', 'make and return the confirmation decision, then reconcile the place and vacancy'],
    ['Direct-to-Clearing applicants complete and submit a UCAS application before adding the choice.', 'A changed-course proposition records explicit consent.'],
    ['A verbal indication is not a confirmed place.', 'Expired permission, missing choice or exhausted capacity returns to review without oversubscription.'],
    ['SRS ↔ UCAS: application, choice and decision', 'SRS ↔ curriculum/capacity: vacancy'], 'SRC-051–SRC-052', 'No durable provisional-permission/capacity reservation and UCAS reconciliation workflow exists.'),
  P('BP-007', 'Convert an accepted applicant to a prospective student record', '01', 'W001', 'person, accepted application and registration precursor', 'An accepted and sufficiently confirmed applicant becomes eligible for pre-registration',
    ['Admissions System', 'Registry', 'Identity and Access Management', 'Applicant'],
    ['verify the accepted application, offer and identity resolution status', 'allocate or reuse the canonical person and student identifiers', 'copy only governed facts with source provenance rather than duplicating the application', 'create the prospective-student/registration-precursor state', 'publish identifiers to authorised pre-arrival services', 'reconcile downstream acknowledgements and route the person to BP-008'],
    ['Multiple accepted applications resolve to one selected enrolment intention.', 'Deferred entry creates a future precursor without premature active-student status.'],
    ['Uncertain identity routes to BP-058.', 'A failed downstream account does not cause a second person/student record.'],
    ['SRS → IAM/portal: pre-arrival identity', 'Admissions → SRS: accepted applicant'], 'SRC-015–SRC-019', 'The conversion boundary and idempotent identity/identifier allocation need explicit controls.'),

  P('BP-027', 'Record attendance and academic engagement evidence', '04', 'W009 partial', 'attendance and engagement evidence', 'A scheduled or recognised academic engagement event occurs',
    ['Student', 'Teaching Staff', 'Attendance Monitoring', 'SRS'],
    ['derive expected engagement events from authoritative study activity', 'capture attended, absent, authorised absence or other evidenced outcome', 'retain event, source, capture method and correction provenance', 'distinguish raw attendance from the provider engagement judgement', 'publish new evidence to the student engagement view', 'reconcile missing rosters, duplicate scans and late corrections'],
    ['PGR, placement, distance and asynchronous activity use approved evidence types.', 'Accessibility-related alternative engagement is recorded without exposing diagnosis.'],
    ['Offline capture is queued with device/time provenance.', 'Disputed evidence is annotated and corrected without destructive overwrite.'],
    ['Timetabling/VLE/attendance → SRS: engagement evidence'], 'SRC-001–SRC-003, SRC-055', 'Current coverage lacks a canonical expected-event/evidence model and source-level correction history.'),
  P('BP-028', 'Investigate and respond to non-engagement', '04', 'W009', 'engagement alert, intervention case and outcome', 'Configured evidence indicates possible non-engagement',
    ['Engagement Officer', 'Student', 'Personal Tutor', 'Wellbeing/Compliance Teams'],
    ['create an alert using the applicable cohort policy and evidence window', 'triage data quality, authorised absence, support and immediate-risk indicators', 'contact the student through accessible channels', 'record response, context and agreed re-engagement actions', 'review new evidence by the policy deadline', 'close, continue support or refer an authorised status/sponsor decision'],
    ['Sponsored students follow the current academic-engagement policy and recorded reporting thresholds.', 'PGR, placement and distance students use mode-appropriate contacts.'],
    ['Welfare risk follows safeguarding routes, not automated academic sanction.', 'Bad or missing source data suspends adverse action and triggers reconciliation.'],
    ['SRS ↔ case/communications: intervention', 'SRS → UKVI compliance: governed referral'], 'SRC-001–SRC-002, SRC-055', 'W009 conflates alert, support intervention, academic status and sponsor reporting decisions.'),
  P('BP-029', 'Review PGR progress and milestones', '04', 'Gap', 'PGR review, evidence, milestone and progression outcome', 'A scheduled or exceptional PGR progress review is due',
    ['PGR Student', 'Research Supervisor', 'Independent Reviewer/Panel', 'PGR Administrator'],
    ['open the review against the candidature and current supervision period', 'collect student report, supervisory evidence, training and milestone status', 'check independence, conflicts and required panel composition', 'conduct the review and record evidence considered', 'decide satisfactory progress, conditions, referral, transfer or escalation under regulations', 'publish the authorised milestone/outcome and schedule follow-up'],
    ['Initial, annual, upgrade/confirmation and return-from-interruption reviews use configured outcome sets.', 'Collaborative provision records each partner authority.'],
    ['Missing evidence or conflicted reviewer postpones with an owner.', 'Unsatisfactory progress does not alter candidature until due process is complete.'],
    ['CRIS ↔ SRS: PGR milestones', 'SRS → portal/communications: outcome'], 'SRC-047–SRC-050, SRC-056', 'Research milestones exist but no review case, panel, evidence or governed outcome workflow exists.'),
  P('BP-030', 'Manage a reasonable adjustment case', '04', 'W002', 'adjustment case and approved support plan', 'A student declares a disability or requests disability-related support',
    ['Student', 'Disability Adviser', 'Specialist Assessor', 'Registry'],
    ['open a confidential case and confirm communication/access needs', 'collect proportionate evidence or arrange assessment', 'identify barriers across teaching, assessment and services', 'draft reasonable and implementable adjustment outcomes', 'approve or review the plan under delegated authority', 'send only the necessary approved outcome to the SRS for distribution'],
    ['Temporary, anticipatory and placement adjustments carry their own review dates.', 'A student may request review or decline an offered adjustment.'],
    ['Clinical evidence remains in the specialist service, not the general student record.', 'An unimplementable adjustment is escalated for an effective alternative.'],
    ['Case system → SRS: approved adjustment', 'SRS → exam/VLE/attendance: outcome'], 'SRC-055, SRC-057', 'W002 needs explicit data-minimisation, review/effective dates and outcome-versus-evidence boundaries.'),
  P('BP-031', 'Manage exceptional circumstances', '04', 'W003', 'exceptional-circumstances claim and determination', 'A student submits circumstances affecting specified assessment or study',
    ['Student', 'Case Officer', 'Authorised Decision Maker', 'Exam Board'],
    ['record the claim, affected period/assessments and requested remedy', 'check timeliness, evidence requirement and accessibility', 'collect proportionate evidence with restricted access', 'assess against the policy version without deciding academic marks', 'record upheld, partly upheld, not upheld or referred and any review route', 'publish the minimum approved flag/remedy for assessment decision making'],
    ['Self-certification, late claim and ongoing-condition routes use configured evidence rules.', 'A review/appeal is linked but does not overwrite the original decision.'],
    ['Immediate wellbeing risk is referred separately.', 'A conflict of interest reassigns the decision.'],
    ['Case system → SRS/exam board: approved outcome'], 'SRC-055, SRC-058', 'W003 models the basic states but not assessment scope, remedy version or privacy boundary.'),
  P('BP-032', 'Distribute an approved support outcome', '04', 'W002/W003 partial', 'per-system support distribution and acknowledgement', 'An approved adjustment or support outcome becomes effective or changes',
    ['SRS', 'Support Service', 'Exam Scheduling', 'VLE/Attendance', 'Integration Administrator'],
    ['derive authorised recipients and the minimum instruction for each target', 'create one effective-dated distribution item per target', 'send add, change or withdraw instructions idempotently', 'record acknowledgement and target reference', 'surface incomplete delivery to the owning support service', 'reconcile target snapshots until every item is applied or explained'],
    ['Urgent manual implementation is later reconciled to the authoritative outcome.', 'Target-specific wording hides unnecessary medical/context evidence.'],
    ['Missing mapping is quarantined without silently dropping support.', 'A target failure does not revoke the approved outcome.'],
    ['SRS → exam/VLE/attendance/timetabling: support outcome'], 'SRC-017, SRC-055, SRC-057', 'A reusable per-target distribution ledger is absent.'),

  P('BP-033', 'Establish assessment structures', '05', 'Gap', 'assessment pattern, component and calculation-rule versions', 'An approved curriculum offering requires assessment setup',
    ['Assessment Designer', 'Module Leader', 'Quality Approver', 'SRS'],
    ['import or create components against the approved module version', 'define weights, pass rules, learning outcomes and permitted attempts', 'validate totals, dates and regulatory compatibility', 'approve the complete assessment pattern', 'publish an immutable effective version to teaching and assessment systems', 'protect active cohorts from retrospective rule change'],
    ['Different routes/cohorts or reasonable alternative assessment use explicit variants.', 'Professional-body constraints add governed rules.'],
    ['Invalid totals or missing approval block publication.', 'A post-publication correction creates a new version and impact case.'],
    ['Curriculum/assessment system → SRS: assessment pattern'], 'SRC-038, SRC-059', 'No durable assessment-pattern publication workflow or cohort binding exists.'),
  P('BP-034', 'Create examination entries and accommodations', '05', 'W005 partial', 'exam entry, candidate and accommodation', 'Confirmed registrations and assessment patterns require exam scheduling',
    ['Examinations Officer', 'SRS', 'Exam Scheduling', 'Disability Support'],
    ['derive eligible candidates from effective registrations and attempt status', 'apply approved accommodations as minimum operational instructions', 'validate identity, clashes, location and assessment eligibility', 'publish entries and accommodation requirements to scheduling', 'receive seat/session allocations and expose them securely', 'reconcile adds, withdrawals and late changes before the examination'],
    ['Alternative assessment, overseas or remote arrangements use approved entry types.', 'Late approved accommodations trigger controlled rescheduling.'],
    ['Missing eligibility or conflicting attempt is held.', 'Sensitive evidence is never sent with the accommodation instruction.'],
    ['SRS ↔ exam scheduling: entries/accommodations'], 'SRC-017, SRC-057, SRC-059', 'W005 lacks a durable candidate-entry and accommodation reconciliation lifecycle.'),
  P('BP-035', 'Receive or enter marks', '05', 'W005 partial', 'raw mark, grade, absence and submission evidence', 'An authorised marker submits a mark or approved results feed arrives',
    ['Marker', 'Module Leader', 'Assessment System', 'SRS'],
    ['open the correct assessment instance and candidate attempt', 'receive mark, grade, absence/non-submission code and source evidence', 'validate range, scale, marker authority and candidate mapping', 'store the raw result with provenance and transaction time', 'flag missing, anomalous or conflicting entries', 'close the entry window and hand the complete set to moderation'],
    ['Anonymous marking resolves candidate identity only at the authorised stage.', 'Group, pass/fail and competency assessments use configured scales.'],
    ['Unknown candidate or out-of-range value is rejected.', 'A resubmission never overwrites an earlier attempt.'],
    ['Assessment/VLE → SRS: marks and submission facts'], 'SRC-059', 'Raw, moderated and ratified marks need distinct states and immutable provenance.'),
  P('BP-036', 'Moderate and confirm marks', '05', 'W005 partial', 'moderation sample, change and confirmed mark', 'A mark set is ready for moderation',
    ['Internal Moderator', 'Module Leader', 'External Examiner', 'Assessment Officer'],
    ['freeze the mark set/version and select the required sample', 'record moderation method, sample and evidence', 'identify systematic or individual issues under policy', 'authorise any changes with reason and original value preserved', 'confirm completeness and sign-off', 'release the confirmed set to module-result calculation'],
    ['Double marking, sampling and negotiated mark routes are configured by assessment type.', 'External examiner input may occur here or at programme/board level.'],
    ['Unresolved marker disagreement escalates to the authorised academic role.', 'Late mark changes return through controlled moderation.'],
    ['Assessment system ↔ SRS: moderated mark set'], 'SRC-059', 'Moderation evidence and mark-set version/sign-off are not first-class.'),
  P('BP-037', 'Determine a module result', '05', 'W005 partial', 'module result, credit and reassessment entitlement', 'All required confirmed component outcomes are available or formally absent',
    ['SRS Calculation Service', 'Assessment Officer', 'Module Board', 'Student'],
    ['bind the student attempt to the applicable assessment-rule version', 'calculate aggregate outcome with rounding, compensation and mandatory-component rules', 'apply approved exceptional-circumstance and misconduct effects', 'derive pass/fail, credit and reassessment eligibility', 'present exceptions for authorised review rather than manual hidden override', 'record the provisional module result for ratification'],
    ['Pass/fail, competency and professional-body modules use configured result sets.', 'Incomplete or deferred assessment produces a non-final outcome.'],
    ['Missing required marks prevents a false fail.', 'Rule/configuration errors invalidate the calculation batch and trigger rerun.'],
    ['SRS calculation → exam board: provisional result'], 'SRC-059', 'Rule-version binding and explainable calculation evidence need strengthening.'),
  P('BP-038', 'Investigate academic misconduct', '05', 'W004', 'misconduct case, finding and authorised penalty effect', 'A sufficiently specific academic misconduct allegation is raised',
    ['Academic Integrity Officer', 'Student', 'Investigator', 'Panel/Decision Maker'],
    ['record the allegation and preserve source evidence with restricted access', 'complete a threshold/conflict check', 'notify the student and provide a fair response opportunity', 'investigate and, where required, hold a panel/hearing', 'record finding, reasons, penalty and review/appeal route', 'send only the authorised academic-record effect to assessment processing'],
    ['Minor/major and admission-without-hearing routes follow regulations and consent rules.', 'An appeal creates a linked case and may suspend the penalty effect.'],
    ['No case to answer closes without an adverse academic flag.', 'Unavailable evidence or conflicted decision maker pauses the case.'],
    ['Case system → SRS: penalty effect'], 'SRC-059–SRC-060', 'W004 needs strict separation of confidential case evidence from academic outcome effects.'),
  P('BP-039', 'Prepare an exam board and data pack', '05', 'W005', 'board instance, agenda and reproducible data snapshot', 'A module/programme board cut-off is reached',
    ['Assessment Officer', 'Board Chair', 'SRS', 'Case/Support Systems'],
    ['define board scope, membership, quorum, date and decision authority', 'freeze the candidate/result population at a recorded cut-off', 'join only authorised EC, misconduct and support indicators', 'run completeness, anomaly and prior-decision checks', 'produce an access-controlled pack with calculation explanations', 'record late items and issue a versioned replacement or addendum'],
    ['Sub-board and final board stages retain their separate scopes.', 'Partner and professional-body representatives receive role-limited views.'],
    ['Quorum or material data-quality failure postpones ratification.', 'Late sensitive information is handled through controlled addendum.'],
    ['SRS/case systems → board workspace: snapshot'], 'SRC-059', 'W005 needs reproducible board snapshots, membership/quorum and pack versioning.'),
  P('BP-040', 'Complete external examiner review', '05', 'W005', 'external examiner access, review and sign-off', 'The approved mark/result evidence is ready for external review',
    ['External Examiner', 'Assessment Officer', 'Board Chair', 'SRS'],
    ['verify appointment, scope, conflicts and secure access', 'provide the authorised sample, assessment and standards evidence', 'record comments, queries and requested actions', 'resolve material queries before ratification or explicitly defer them', 'capture sign-off or qualified/non-sign-off with reasons', 'retain the review as board evidence and feed systemic issues to quality processes'],
    ['Programme, module and award-level external examining scopes differ.', 'Emergency substitute appointment preserves authority evidence.'],
    ['Expired appointment or conflict removes access.', 'Non-sign-off cannot be represented as approval.'],
    ['SRS → examiner workspace: evidence', 'Workspace → SRS: sign-off'], 'SRC-059', 'External-examiner appointment scope and sign-off are not durable workflow records.'),
  P('BP-041', 'Ratify and publish results', '05', 'W005', 'ratified result, decision lock and publication status', 'A quorate authorised board considers complete results',
    ['Exam Board', 'Board Chair', 'Assessment Officer', 'Student'],
    ['confirm quorum, conflicts, data-pack version and outstanding exceptions', 'record each decision and any authorised discretion with reasons', 'chair-sign and lock the ratified outcome set', 'generate student-facing outcome text and review/appeal information', 'publish only at the authorised release time', 'record delivery and reconcile portal/transcript consumers'],
    ['Chair’s action after the meeting follows tightly defined authority.', 'Embargoed or debt-related communication controls do not rewrite the academic outcome.'],
    ['Non-quorate board cannot ratify.', 'Publication failure leaves the ratified record intact and creates an operational incident.'],
    ['SRS → portal/documents: ratified results'], 'SRC-059', 'Decision lock, discretion provenance and per-channel publication status need explicit modelling.'),
  P('BP-042', 'Submit and examine a PGR thesis', '05', 'Gap', 'thesis submission, examiners, viva and examination outcome', 'An eligible PGR student gives notice and submits a thesis',
    ['PGR Student', 'PGR Administrator', 'Internal/External Examiner', 'Independent Chair'],
    ['validate submission eligibility, notice, format and approved restrictions', 'record the immutable submitted thesis version and declarations', 'approve examiner nominations, independence, expertise and conflicts', 'distribute securely and obtain independent preliminary reports', 'conduct the viva/examination and record the joint recommendation', 'ratify the outcome, corrections/revision requirements and deadlines'],
    ['Practice-based, published-work, remote viva and resubmission routes use configured evidence.', 'No-viva routes occur only where regulations permit.'],
    ['Late conflict or examiner unavailability triggers replacement approval.', 'Restricted thesis access is enforced without losing the preservation copy.'],
    ['Repository → SRS: submission', 'SRS ↔ examiner workspace: reports/outcome'], 'SRC-056, SRC-059', 'No thesis/examiner/viva workflow or correction-period model exists.'),
  P('BP-043', 'Correct a ratified academic outcome', '05', 'W006', 'authorised academic amendment and republication history', 'A material error in a ratified outcome is evidenced',
    ['Registry Officer', 'Authorised Academic Decision Maker', 'Assessment Officer', 'Student'],
    ['open an amendment case linked to the exact ratified version', 'classify clerical, calculation, procedural or academic-judgement issue', 'collect evidence and identify all downstream consequences', 'obtain authority at least equivalent to the original decision', 'append the corrected version and preserve the superseded outcome', 'reissue documents/events and reconcile every affected consumer'],
    ['Pure clerical corrections may use delegated authority.', 'Appeal outcomes reference their separate case and authority.'],
    ['An attempt to change academic judgement without due process is rejected.', 'Partial downstream failure creates owned reconciliation items.'],
    ['SRS → portal/documents/HESA: corrected outcome'], 'SRC-059, SRC-061', 'W006 requires bitemporal amendment, authority and downstream correction orchestration.'),

  P('BP-044', 'Determine progression', '06', 'W005 partial', 'progression decision and rule explanation', 'Ratified results for a progression point are available',
    ['Progression Board', 'Assessment Officer', 'SRS', 'Student'],
    ['bind the enrolment to the applicable progression-rule version', 'assemble ratified credit, attempts and approved case effects', 'calculate the default progression outcome with explanation', 'present exceptions and permitted discretion to the board', 'record the authorised decision, reason and next study state', 'publish the decision and trigger registration/reassessment actions'],
    ['Part-time, placement, integrated masters and professional programmes use configured progression points.', 'PGR progression is handled by BP-029.'],
    ['Missing/uncertain results defer rather than fail progression.', 'Unconfigured discretion cannot be applied as a free-text override.'],
    ['SRS → portal/registration: progression outcome'], 'SRC-059, SRC-062', 'Progression rule binding and explainable board discretion need first-class records.'),
  P('BP-045', 'Manage reassessment, referral or repeat study', '06', 'W005/W010 partial', 'reassessment entitlement, next attempt and repeat-study plan', 'A ratified module/progression decision grants or requires further assessment/study',
    ['Assessment Officer', 'Student', 'Registry', 'Finance/Timetabling'],
    ['interpret the authorised decision under attempt and capping rules', 'create the next attempt with assessment pattern and due period', 'decide reassessment without attendance, referral, repeat module or repeat stage', 'record fees, attendance, visa and curriculum consequences', 'publish eligible entries/registrations to operational systems', 'track completion or expiry without overwriting previous attempts'],
    ['Deferral normally preserves attempt treatment distinct from failure.', 'Repeat with/without attendance and exceptional additional attempt are separate outcomes.'],
    ['No available module/assessment version triggers curriculum resolution.', 'Sponsor or maximum-period conflict requires specialist review.'],
    ['SRS → finance/timetable/VLE/exams: repeat plan'], 'SRC-059, SRC-062', 'Attempt entitlement and repeat-study plan are distributed across statuses rather than one governed record.'),
  P('BP-046', 'Determine and confer an award', '06', 'W011', 'award recommendation, conferment and classification', 'A student reaches an award decision point with ratified results',
    ['Award Board', 'Registry', 'SRS Calculation Service', 'Delegated Conferment Authority'],
    ['bind the student to award and classification regulations', 'assemble eligible credit, level, residency and professional requirements', 'calculate the default award/classification and exit alternatives', 'record board recommendation and authorised discretion', 'obtain conferment under delegated institutional authority', 'create the immutable conferred award and publish the event'],
    ['Aegrotat, posthumous and exit awards follow explicit authority/policy.', 'Joint, dual and collaborative awards record each awarding responsibility.'],
    ['Outstanding academic decision defers award.', 'Revocation or correction cannot overwrite the conferred record.'],
    ['SRS → documents/HESA/portal: award'], 'SRC-059, SRC-062', 'W011 needs separate recommendation, conferment authority and immutable award fact.'),
  P('BP-047', 'Issue award documentation and HEAR', '06', 'W011', 'issued certificate, transcript and HEAR version', 'A conferred award or authorised academic record is ready for documentation',
    ['Registry Documents Officer', 'Graduate', 'Document Service', 'SRS'],
    ['select the conferred award and approved document templates', 'assemble verified names, programme, results and achievement data', 'generate accessible certificate/transcript/HEAR outputs', 'authorise and cryptographically/reference-sign the issue', 'deliver through the selected secure channel', 'record issue, replacement, revocation and verification status'],
    ['Replacement, corrected-name and certified-copy routes preserve issuance history.', 'Partner, joint and bilingual documents use approved templates.'],
    ['Data mismatch blocks issue.', 'Compromised or erroneous document is revoked and replaced without deleting evidence.'],
    ['SRS ↔ document/verification service: award documents'], 'SRC-062–SRC-063', 'Document instances, verification and revocation lifecycle need stronger modelling.'),
  P('BP-048', 'Determine graduation eligibility and attendance', '06', 'W011', 'ceremony eligibility, invitation, response and allocation', 'A conferred or expected award enters a graduation cycle',
    ['Graduation Team', 'Graduate', 'SRS', 'Ceremony Service'],
    ['define ceremony cycle, eligibility rules and capacity', 'derive eligible invitees from authoritative award status', 'send invitation and capture attendance/deferral/accessibility choices', 'allocate ceremony, guest/ticket and presentation details', 'freeze the presentation list and reconcile late award changes', 'record attendance/presentation separately from award conferment'],
    ['In absentia, deferred attendance and accessibility arrangements retain the same conferred award.', 'PGR and partner ceremonies may use different cycles.'],
    ['Ceremony capacity or late award decision moves attendance, not academic status.', 'Safety/access needs are shared minimally.'],
    ['SRS ↔ ceremony service: eligibility and attendance'], 'SRC-062', 'Graduation attendance is not clearly separated from conferment in W011.'),
  P('BP-049', 'Record successful PGR completion', '06', 'W011 partial', 'PGR completion, final thesis deposit and research-profile closure', 'A ratified successful PGR examination outcome and corrections are complete',
    ['PGR Student', 'PGR Administrator', 'Repository', 'Award Authority'],
    ['verify ratified examination outcome and correction approval', 'receive the final thesis and enforce any approved access restriction', 'confirm deposit, metadata and intellectual-property declarations', 'record research candidature completion and effective date', 'confer the research award through BP-046 authority', 'close/synchronise supervision, milestones and CRIS profile without deleting history'],
    ['Embargoed/restricted thesis records the basis and review date.', 'Professional doctorate outputs may include approved non-thesis components.'],
    ['Missing final deposit holds completion where regulations require it.', 'CRIS/repository failure does not duplicate the award.'],
    ['Repository/CRIS ↔ SRS: final thesis and completion'], 'SRC-056, SRC-062', 'PGR completion, deposit and research-profile closure are not orchestrated by W011.'),

  P('BP-050', 'Prepare and submit HESA student data', '07', 'W008', 'collection snapshot, validation, submission and sign-off', 'A HESA collection/reference period reaches an extraction or quality checkpoint',
    ['Statutory Data Officer', 'Data Owners', 'SRS', 'HESA/Jisc Platform'],
    ['freeze collection specification, reference dates and provider scope', 'extract source facts with field-level lineage', 'transform to the required entities/codes without changing source meaning', 'run local and platform validation and triage quality queries', 'obtain accountable sign-off and submit the versioned return', 'retain receipt, quality outputs, amendments and reproducible snapshot'],
    ['Student, staff-linked or in-year collection variants use their own specification.', 'Partner provision records reporting responsibility.'],
    ['Specification ambiguity is logged as a decision, not silently coded.', 'Submission rejection returns to controlled correction and resubmission.'],
    ['SRS → HESA/Jisc: statutory return'], 'SRC-064', 'W008 needs field lineage, specification version, sign-off and reproducible snapshot.'),
  P('BP-051', 'Exchange registration, attendance and changes with student finance bodies', '07', 'W001/W007/W010', 'finance-body confirmation/notification and response', 'A funded student reaches a reportable registration, attendance or circumstance event',
    ['Student Finance Officer', 'SRS', 'SLC/National Finance Body', 'Student'],
    ['identify scheme, domicile, course and reporting responsibility', 'validate identity, attendance/registration status and effective dates', 'create the scheme-specific confirmation or change notification', 'submit with correlation/idempotency identifiers', 'record response, rejection and payment-impact status', 'reconcile periodic lists and correct authoritative source facts where needed'],
    ['SFE, SFW, SAAS and SFNI rules and channels remain explicit.', 'Suspension, withdrawal, transfer and repeat study use event-specific effective dates.'],
    ['Do not infer attendance solely from fee payment.', 'Identifier mismatch is investigated before creating another student record.'],
    ['SRS ↔ SLC/SAAS/national body: attendance and changes'], 'SRC-003–SRC-005, SRC-065', 'No common exchange ledger preserving national scheme and response lifecycle exists.'),
  P('BP-052', 'Manage Student sponsor reporting and compliance', '07', 'W009/W012', 'sponsor compliance case, SMS report and evidence', 'A sponsored-student event or compliance review becomes due',
    ['International Compliance Officer', 'Student', 'SRS', 'UKVI Sponsor Management System'],
    ['apply the current guidance and identify sponsor/CAS/student', 'assemble verified enrolment, engagement and circumstance evidence', 'decide whether reporting, support, withdrawal of sponsorship or no report is required', 'obtain authorised compliance approval', 'submit the correct SMS report within the applicable deadline', 'record exact report, evidence, receipt and later correction/reconciliation'],
    ['Partner, placement, study-abroad, remote and PGR engagement use guidance-specific evidence.', 'A permitted non-reporting decision retains reasons and policy version.'],
    ['Welfare/academic status decisions remain separate from sponsor reporting.', 'Incorrect SMS data is corrected through a linked report.'],
    ['SRS ↔ UKVI SMS: sponsor report'], 'SRC-001–SRC-002', 'W009/W012 need one governed reporting case with guidance version and SMS evidence.'),
  P('BP-053', 'Produce OfS regulatory extracts', '07', 'Gap', 'England regulatory extract, evidence and sign-off', 'An OfS requirement, monitoring request or scheduled return is due',
    ['Regulatory Data Officer', 'Data Owner', 'Accountable Officer', 'OfS'],
    ['confirm provider category, requirement, notice and deadline', 'freeze definitions, population and source cut-off', 'extract with field/metric lineage and disclosure controls', 'validate against prior submissions and source totals', 'obtain accountable sign-off and submit securely', 'retain receipt, queries, corrections and reproducible version'],
    ['Ad hoc monitoring and scheduled returns retain distinct legal/notice bases.', 'FE providers may source specified data through ILR rather than the SRS.'],
    ['Scope uncertainty is escalated before disclosure.', 'A rejected extract is versioned and resubmitted.'],
    ['SRS/data platform → OfS: regulatory extract'], 'SRC-066', 'No durable OfS extract workflow, definition version or sign-off evidence exists.'),
  P('BP-054', 'Produce Scottish Funding Council returns', '07', 'Gap', 'SFC return, certification and audit evidence', 'An applicable SFC collection or funding information request is due',
    ['SFC Returns Officer', 'Data Owners', 'Accountable Signatory/Auditor', 'SFC'],
    ['confirm institution/collection scope, current guidance and deadline', 'freeze the relevant Scottish population and coding definitions', 'extract data with source lineage and funding-rule calculations', 'validate totals, movements and audit samples', 'obtain required certificate/sign-off and submit', 'retain receipt, audit evidence, corrections and reconciliation'],
    ['University and college collections, including FES where applicable, use distinct schemas.', 'HESA-derived uses are not duplicated as an England-only return.'],
    ['Funding-impact uncertainty is escalated.', 'Audit qualification and resubmission remain linked to the original.'],
    ['SRS/data platform → SFC: return'], 'SRC-067', 'No SFC contract, certification workflow or Scottish coding boundary exists.'),
  P('BP-055', 'Produce Medr regulatory and funding returns', '07', 'Gap', 'Medr return/analysis output and sign-off', 'A Medr data requirement or funding return reaches its extraction date',
    ['Medr Returns Officer', 'Data Owners', 'Accountable Signatory', 'Medr'],
    ['confirm provider type, requirement, HESA dependency and deadline', 'freeze population, Welsh-medium and funding definitions', 'extract with lineage and applicable IRIS/data-quality mappings', 'validate funding, equality, apprenticeship and Welsh-medium uses', 'sign off and submit through the specified channel', 'retain outputs, queries, corrections and reproducible snapshot'],
    ['Funded HE, FE-delivered HE and specifically designated provision have different scope.', 'HESA-derived analysis is reconciled to the signed HESA version.'],
    ['Provider-scope ambiguity is resolved with Medr.', 'Quality-query correction follows BP-057.'],
    ['SRS/HESA snapshot → Medr: return/quality evidence'], 'SRC-068', 'No Medr-specific workflow or Welsh-medium/funding lineage exists.'),
  P('BP-056', 'Produce Department for the Economy returns', '07', 'Gap', 'Northern Ireland return/extract and sign-off', 'A Department for the Economy data or funding requirement is due',
    ['DfE Returns Officer', 'Data Owners', 'Accountable Signatory', 'Department for the Economy'],
    ['confirm collection scope, HESA dependency, definitions and deadline', 'freeze the Northern Ireland provider/student population', 'extract with source and code lineage', 'validate against HESA, finance and prior-period totals', 'obtain institutional sign-off and submit securely', 'retain receipt, queries, amendments and reproducible snapshot'],
    ['University and FE-delivered HE requirements remain distinct.', 'Statistical outputs derived from HESA reconcile to the accepted HESA submission.'],
    ['Unclear scope or conflicting definition is escalated.', 'Rejected data follows governed correction/resubmission.'],
    ['SRS/HESA snapshot → DfE: return/extract'], 'SRC-069', 'No DfE-specific contract, definition catalogue or sign-off workflow exists.'),
  P('BP-057', 'Resolve a statutory submission data-quality issue', '07', 'W008 partial', 'quality issue, source correction or submission amendment', 'Validation, regulator query or reconciliation identifies a possible error',
    ['Statutory Data Officer', 'Source Data Owner', 'Registry', 'Regulator/Funder'],
    ['record the issue against submission, fields, population and rule version', 'trace the value to authoritative source and transformation', 'classify source error, transformation error, timing difference or valid exception', 'authorise and make the correction at the proper layer', 'regenerate affected outputs and assess cross-return consequences', 'resubmit/respond and retain before/after evidence and acceptance'],
    ['A valid exception is explained without corrupting source facts.', 'A post-sign-off amendment follows regulator-specific approval.'],
    ['Never patch only the extract when the authoritative source is wrong.', 'A correction affecting students triggers downstream notification review.'],
    ['Regulator ↔ SRS/data platform: quality query/resubmission'], 'SRC-064, SRC-066–SRC-069', 'W008 needs issue lineage and controlled source-versus-transform correction.'),

  P('BP-058', 'Resolve a duplicate or uncertain identity', '08', 'Gap', 'identity resolution case, links and merge history', 'Matching identifies probable duplicate or conflicting person identities',
    ['Identity Resolution Officer', 'Registry', 'Applicant/Student', 'Identity Service'],
    ['open a restricted case containing candidate identities and match basis', 'freeze automated merging and inspect authoritative identifiers/evidence', 'distinguish duplicate, related persons, alias/name change and insufficient evidence', 'obtain independent authority for a merge or maintained separation', 'link/survive identifiers without deleting provenance or academic history', 'publish identifier redirects and reconcile every consuming system'],
    ['A reversible link may precede a full merge.', 'Identity theft or safeguarding concern moves to the specialist restricted route.'],
    ['Insufficient evidence keeps records separate with a review flag.', 'Conflicting statutory identifiers require source-owner resolution.'],
    ['Identity service/SRS ↔ consumers: merge/link notification'], 'SRC-070', 'No durable human identity-resolution case or downstream merge orchestration exists.'),
  P('BP-059', 'Correct personal or enrolment data', '08', 'W006 partial', 'authorised bitemporal correction and reason', 'An evidenced error or effective change to a core fact is reported',
    ['Student/Requester', 'Registry Officer', 'Data Owner', 'SRS'],
    ['identify the exact fact, source, effective period and impacted outputs', 'classify correction versus current change and verify evidence', 'check authority, sensitivity and statutory consequences', 'append the new effective/transaction-time version with reason', 'recalculate and publish affected derived facts', 'reconcile consumers and notify the requester/outcome owner'],
    ['Self-service changes may be auto-approved for low-risk current contact data.', 'Historic corrections require explicit effective dates and return impact review.'],
    ['Academic judgement uses BP-043 rather than general correction.', 'Unverified change remains requested, not authoritative.'],
    ['SRS → downstream systems/returns: corrected fact'], 'SRC-061, SRC-070', 'W006 needs consistent bitemporal correction semantics and impact orchestration.'),
  P('BP-060', 'Fulfil a data subject access request', '08', 'Gap', 'rights request, search scope, review and disclosure', 'A valid subject access request is received',
    ['Data Subject', 'Data Protection Team', 'System/Data Owners', 'Disclosure Reviewer'],
    ['log receipt, identity assurance, request scope and statutory deadline', 'locate personal data across SRS, integrations, cases, documents and logs', 'collect reproducible search evidence without altering source records', 'review third-party data, exemptions, privilege and security', 'produce an accessible secure disclosure with required supplementary information', 'record delivery, decisions, correspondence and closure'],
    ['Clarification or deadline extension is used only where the legal test is met.', 'Repeated or broad requests remain assessed individually.'],
    ['Identity uncertainty pauses disclosure.', 'Restricted/exempt material is recorded with reason and communicated as legally permitted.'],
    ['SRS/connected systems → DSAR workspace: search/export'], 'SRC-071', 'No cross-system search manifest, disclosure review or rights-request audit workflow exists.'),
  P('BP-061', 'Assess restriction, rectification or erasure rights', '08', 'Gap', 'individual-rights decision and propagated action', 'A person requests rectification, restriction or erasure',
    ['Data Subject', 'Data Protection Officer', 'Data Owner', 'Integration Administrator'],
    ['log and verify the request and exact data/processing in scope', 'identify lawful bases, statutory/contractual retention and exceptions', 'consult data owners and assess each requested right separately', 'record reasoned approve, partly approve or refuse decision', 'apply correction, restriction marker or governed erasure at authoritative sources', 'propagate to recipients and retain minimal compliance evidence'],
    ['A restriction may limit use while accuracy or objection is assessed.', 'Backup and immutable-log handling follows documented beyond-use/retention controls.'],
    ['Do not erase academic/statutory evidence where a lawful retention basis applies.', 'Partial propagation creates tracked reconciliation work.'],
    ['SRS → connected processors/recipients: rights action'], 'SRC-070–SRC-072', 'No rights decision, restriction marker or recipient-propagation workflow exists.'),
  P('BP-062', 'Retain, archive and dispose of student records', '08', 'Gap', 'retention class, legal hold, archive and disposal certificate', 'A record reaches a retention event or scheduled review',
    ['Records Manager', 'Data Owner', 'Archivist', 'System Administrator'],
    ['classify records by purpose, authority, trigger and approved schedule', 'calculate review/disposal dates from authoritative lifecycle events', 'check legal, investigation, complaint and research/archive holds', 'approve transfer, continued retention, anonymisation or disposal', 'execute across primary, derived and governed backup locations', 'retain disposal/transfer evidence without retaining the disposed content'],
    ['Permanent archival selection transfers custody and access controls.', 'Anonymised analytical data requires a documented re-identification risk assessment.'],
    ['Active hold blocks disposal and records the owner/review date.', 'Failed partial disposal is reconciled across replicas and processors.'],
    ['SRS → archive/disposal service: governed lifecycle action'], 'SRC-072–SRC-073', 'No record-level retention classification, hold or disposal orchestration exists.'),
  P('BP-063', 'Audit access and material record changes', '08', 'Gap', 'immutable access/change evidence and review case', 'A scheduled, risk-based or incident-driven audit is initiated',
    ['Information Security Auditor', 'Data Protection Officer', 'System Owner', 'Investigator'],
    ['define audit purpose, scope, authority and review period', 'retrieve tamper-evident access, change and privileged-action logs', 'correlate actor, role, purpose, object, before/after reference and timestamp', 'identify anomalous access or unauthorised material change', 'record findings, evidence preservation and remediation owner', 'close or refer to incident, disciplinary, correction or rights processes'],
    ['Routine control sampling and specific investigations use proportionate scopes.', 'Student-facing access history may exclude protected security information.'],
    ['Auditors cannot alter source logs.', 'Missing/incomplete logs trigger a control incident, not an invented reconstruction.'],
    ['SRS/IAM/integration logs → audit platform: evidence'], 'SRC-070, SRC-074', 'Audit events exist conceptually but no review workflow, immutable evidence contract or coverage control exists.'),
];

const canonicalActorNames = new Map([
  ['Applicant', 'Prospective Student'],
  ['Student', 'Enrolled Student'],
  ['Exam Board', 'Exam Board Chair'],
  ['Disability Advisor', 'Disability Adviser'],
  ['PGR Student', 'Enrolled Student'],
]);

for (const process of processes) {
  process.actors = process.actors.map((actor) => canonicalActorNames.get(actor) ?? actor);
}

function slug(title) {
  return title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

const byId = new Map(processes.map((process) => [process.id, process]));

function nav(process) {
  const number = Number(process.id.slice(3));
  const previous = number === 1
    ? '[Domain index](README.md)'
    : byId.get(`BP-${String(number - 1).padStart(3, '0')}`)
      ? `[Previous: BP-${String(number - 1).padStart(3, '0')}](../${domains[byId.get(`BP-${String(number - 1).padStart(3, '0')}`).domain].dir}/bp-${String(number - 1).padStart(3, '0')}-${slug(byId.get(`BP-${String(number - 1).padStart(3, '0')}`).title)}.md)`
      : `[Previous: BP-${String(number - 1).padStart(3, '0')}](../03-curriculum-and-module-registration/bp-026-establish-pgr-supervision.md)`;
  const nextProcess = byId.get(`BP-${String(number + 1).padStart(3, '0')}`);
  const next = number === 7
    ? '[Next: BP-008](../02-registration-and-student-status/bp-008-prepare-initial-registration.md)'
    : nextProcess
    ? `[Next: BP-${String(number + 1).padStart(3, '0')}](../${domains[nextProcess.domain].dir}/bp-${String(number + 1).padStart(3, '0')}-${slug(nextProcess.title)}.md)`
    : '[Library home](../README.md)';
  return `${previous} · [Domain index](README.md) · ${next} · [Library home](../README.md)`;
}

function page(process) {
  const domain = domains[process.domain];
  const [primaryActor, ...otherActors] = process.actors;
  const actorRows = process.actors.map((actor, index) => `| ${actor} | ${index === 0 ? 'Initiates or owns the principal business action' : 'Provides evidence, decision, system processing or governed support'} |`).join('\n');
  const stepRows = process.steps.map((step, index) => `${index + 1}. **${index === 0 ? primaryActor : otherActors[(index - 1) % otherActors.length] ?? primaryActor}** ${step}.`).join('\n');
  const altRows = process.alternatives.map((item, index) => `### A${index + 1} — Variant\n\n- **A${index + 1}.1** ${item}`).join('\n\n');
  const exceptionRows = process.exceptions.map((item, index) => `### E${index + 1} — Control exception\n\n- **E${index + 1}.1** ${item}`).join('\n\n');
  const integrationRows = process.integrations.map((item) => {
    const [route, purpose] = item.split(': ');
    const [from, to] = route.split(' → ');
    return `| ${from ?? 'SRS'} | ${to ?? 'Connected system'} | ${purpose ?? process.record} | Versioned/idempotent contract | Retry, quarantine, acknowledge and reconcile |`;
  }).join('\n');
  const participants = process.actors.slice(0, 4);
  const mermaidParticipants = participants.map((actor, index) => `${index === 0 ? 'actor' : 'participant'} A${index + 1} as ${actor}`).join('\n    ');
  const mermaidSteps = process.steps.slice(0, 6).map((step, index) => {
    const from = `A${(index % participants.length) + 1}`;
    const to = `A${((index + 1) % participants.length) + 1}`;
    return `${from}->>${to}: ${index + 1}. ${step}`;
  }).join('\n    ');

  return `# ${process.id} — ${process.title}

> Status: Draft
> Domain: ${process.domain} — ${domain.name}
> Owner: TBC
> Version: 0.1
> Last reviewed: 2026-07-26
> Review by: 2027-01-26

${nav(process)}

## Applicability

| Dimension | Applies |
|---|---|
| Common | UK |
| Nations | England; Scotland; Wales; Northern Ireland |
| Provider types | Providers operating this process; exact regulatory scope is configured |
| Levels and modes | UG; PGT; PGR; full-time; part-time; distance and collaborative provision where relevant |
| Exclusions | Activities outside the stated start/end boundary |

## Traceability

| Type | References |
|---|---|
| Revelation workflows | ${process.workflow} |
| Reference-model flows | See integration contract catalogue; confirm detailed F-number mapping during architecture review |
| Functional requirements | See functional requirements; detailed mapping remains an SME/architecture review action |
| Data entities | ${process.record}; supporting identity, evidence, decision and integration-exchange records |
| Domain events | Proposed: \`srs.${slug(process.title).replaceAll('-', '.')}.completed\` |
| Integration contracts | ${process.integrations.map((item) => item.split(': ')[0]).join('; ')} |

## Purpose and outcome

${process.title} creates a controlled, explainable and effective-dated ${process.record}. The outcome preserves the evidence, authority and cross-system state needed for the Revelation SRS rather than reducing the process to a status update.

## Scope

**Starts when:** ${process.trigger}.

**Ends when:** The authorised outcome is recorded, communicated and reconciled, or the case is closed with an owned reason.

**In scope:** Intake, validation, evidence, decision, effective dating, communication and downstream reconciliation.

**Out of scope:** Upstream policy creation and later lifecycle processes referenced under Related processes.

## Actors and responsibilities

| Actor/system | Responsibility |
|---|---|
${actorRows}

**Accountable owner:** ${primaryActor} service owner or delegated authority (TBC)

**System of record:** SRS for the student-record outcome; specialist systems retain their governed source evidence.

## Preconditions

1. Canonical person, programme/period and source identifiers are available where applicable.
2. The current policy/rule version and decision authority are configured.
3. Required interfaces use stable identifiers, provenance and reconciliation controls.

## Trigger

${process.trigger}.

## Main flow

${stepRows}

## Alternative flows

${altRows}

## Exception flows

${exceptionRows}

## Postconditions

### Successful

- The ${process.record} is authoritative, effective-dated and linked to its evidence and decision authority.
- Each required consumer has acknowledged the correct version or has an owned reconciliation item.

### Unsuccessful or incomplete

- No unapproved outcome is represented as final; the case retains reason, owner and next action.

## Business rules and controls

| ID | Classification | Rule/control | Applicability | Source |
|---|---|---|---|---|
| BR-1 | SECTOR | Apply the current authoritative requirement and provider regulation for the person, level, mode and nation | UK/configured | ${process.sources} |
| BR-2 | INSTITUTION | Decision roles, deadlines, evidence and permitted discretion are policy-versioned | Provider | Provider regulations |
| BR-3 | REVELATION | ${process.gap} | Revelation | SRC-015–SRC-019 |
| BR-4 | PROPOSED | Proposed, approved, rejected and superseded states remain distinguishable | Revelation target | Process control |
| BR-5 | PROPOSED | Corrections append provenance and trigger impact/reconciliation; they do not silently overwrite | Revelation target | Data governance |

## National and institutional variations

### England

${domain.england}

### Scotland

${domain.scotland}

### Wales

${domain.wales}

### Northern Ireland

${domain.ni}

### Institutional policy points

Terminology, authority, deadlines, evidence, thresholds, communication, appeals/reviews, partner responsibility and target-system ownership.

## Data impact

| Data concept | Action | System of record | Effective/provenance requirement | Sensitivity |
|---|---|---|---|---|
| ${process.record} | Create/version | SRS or governed specialist source | Policy, actor, evidence, decision and effective/transaction times | Personal; may be sensitive |
| Workflow/case evidence | Append | Owning service | Immutable source and restricted access | Personal/confidential |
| Integration exchange | Append/update | SRS integration ledger | Contract version, correlation, attempts and acknowledgement | Personal |

## Integration impact

| From | To | Information/purpose | Contract/pattern | Failure and reconciliation |
|---|---|---|---|---|
${integrationRows}

## Sequence diagram

\`\`\`mermaid
sequenceDiagram
    ${mermaidParticipants}
    ${mermaidSteps}
    alt Valid and authorised
        A${participants.length}->>A1: Record and communicate outcome
    else Incomplete or exception
        A${participants.length}->>A1: Retain case with owner and reason
    end
\`\`\`

## Open questions and decisions

| ID | Question/decision | Owner | Status |
|---|---|---|---|
| OQ-1 | Confirm the authoritative owner, workflow boundary and detailed requirement/contract mapping | Process owner/architect | Open |
| OQ-2 | Which national, provider-type and mode variants require configuration? | Four-nation SME | Open |
| OQ-3 | Which evidence stays in a specialist system and what minimum outcome enters the SRS? | Data protection/data owner | Open |

## Sources

| Source | Supported content |
|---|---|
| [${process.sources}](../source-register.md) | External process, regulatory or sector evidence |
| [SRC-015–SRC-019](../source-register.md) | Revelation workflows, actors, contracts, data and requirements |

## Related processes

[Process inventory](../process-inventory.md); adjacent lifecycle processes in the [process map](../process-map.md).

## Review record

| Review | Reviewer | Date | Outcome |
|---|---|---|---|
| Research/documentation | Codex implementation role | 2026-07-26 | Drafted |
| Required reviews | Process, national, data and integration SMEs (TBC) | — | Pending |

## Change history

| Version | Date | Author | Change |
|---|---|---|---|
| 0.1 | 2026-07-26 | Codex | Initial research draft |
`;
}

for (const process of processes) {
  const domain = domains[process.domain];
  const directory = join(root, domain.dir);
  mkdirSync(directory, { recursive: true });
  const filename = `${process.id.toLowerCase()}-${slug(process.title)}.md`;
  writeFileSync(join(directory, filename), page(process));
}

for (const [domainId, domain] of Object.entries(domains)) {
  const domainProcesses = processes.filter((process) => process.domain === domainId);
  const processList = domainProcesses
    .map((process, index) => `${index + 1}. [${process.id} — ${process.title}](${process.id.toLowerCase()}-${slug(process.title)}.md)`)
    .join('\n');
  const readme = `# ${domain.name} Processes

> Status: Initial process wave drafted

[Library home](../README.md) · [Process map](../process-map.md) · [Inventory](../process-inventory.md)

This domain documents the controlled student-record outcomes, actors, evidence, decisions and cross-system hand-offs for ${domain.name.toLowerCase()}.

## Processes

${processList}

All pages are research drafts pending process-owner, four-nation, data, integration and regulatory SME review.
`;
  writeFileSync(join(root, domain.dir, 'README.md'), readme);
}

const inventoryPath = join(root, 'process-inventory.md');
let inventory = readFileSync(inventoryPath, 'utf8');
for (const process of processes) {
  const domain = domains[process.domain];
  const filename = `${process.id.toLowerCase()}-${slug(process.title)}.md`;
  const rowPattern = new RegExp(`^\\| ${process.id} \\|(.+)\\| Candidate \\|$`, 'm');
  inventory = inventory.replace(
    rowPattern,
    `| [${process.id}](${domain.dir}/${filename}) |$1| Draft |`,
  );
}
inventory = inventory.replace('> Identifier state: Candidate until inventory review', '> Identifier state: Stable working identifiers; all inventory pages drafted');
writeFileSync(inventoryPath, inventory);

console.log(`Generated ${processes.length} business process pages.`);
