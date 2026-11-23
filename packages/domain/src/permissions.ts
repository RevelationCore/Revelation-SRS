/** All RBAC roles defined in the actor catalogue. */
export const ROLES = [
  'student',
  'module-tutor',
  'personal-tutor',
  'engagement-officer',
  'research-supervisor',
  'wellbeing-advisor',
  'wellbeing-mental-health-advisor',
  'wellbeing-specialist-assessor',
  'wellbeing-panel-chair',
  'wellbeing-auditor',
  'exam-board-member',
  'exam-board-chair',
  'external-examiner',
  'integrity-officer',
  'registry-administrator',
  'regulatory-officer',
  'finance-administrator',
  'dpo',
  'tenant-administrator',
  'system-administrator',
  'integration-service',
  'programme-approver',
  'pgr-administrator',
  'pgr-director',
  // Phase 5 D-38: self-service audiences outside the back office.
  'applicant',
  'pgr-examiner',
  // ADR-028: exceptional-circumstances claims, named after the BP-04-005 actors.
  'ec-case-officer',
  'ec-decision-maker',
  // ADR-029: the wellbeing service's own role for its two hand-offs, honoured
  // only from its tenant-bound client (packages/auth bindServiceRoles).
  'wellbeing-service',
  // ADR-032: the VLE connector's own role, honoured only from its tenant-bound
  // client; it holds the three VLE-only permissions and nothing else.
  'vle-connector-service',
  // ADR-031: BP-08-001's Identity Resolution Officer prepares and decides merges (never both on one case).
  'identity-resolution-officer',
  // ADR-033: approves manual adjustments (and releases migrated ones) under
  // BP-04-004's delegated authority; never held with adjustment:propose.
  'adjustment-approver',
  // SME-6: proposes a manual adjustment, for disability-service staff outside registry.
  'adjustment-proposer',
  // BP-06 pre-review G5 (BL-279): the academic authority that confers awards
  // (a Registrar or Senate delegate), not an IT role.
  'conferment-authority',
] as const;

/** The integration contracts the VLE connector serves (ADR-032). */
export const VLE_CONTRACT_IDS: readonly string[] = ['vle-course-provisioning.v1', 'vle-adjustments.v1', 'vle-assessment-results.v1'];

export type Role = (typeof ROLES)[number];

/**
 * Permission → roles that hold it.
 * Application middleware checks these at route level.
 */
export const PERMISSION_ROLES = {
  'student:read:own':          ['student'] as Role[],
  'student:read:all':          ['registry-administrator', 'exam-board-chair', 'wellbeing-advisor', 'wellbeing-mental-health-advisor', 'dpo', 'external-examiner'] as Role[],
  'student:write':             ['registry-administrator'] as Role[],
  'student:decide':            ['registry-administrator', 'personal-tutor'] as Role[],
  'enrolment:read:own':        ['student'] as Role[],
  'enrolment:read:all':        ['registry-administrator', 'exam-board-chair', 'wellbeing-advisor', 'finance-administrator', 'external-examiner'] as Role[],
  'enrolment:write':           ['registry-administrator'] as Role[],
  'mark:read:own':             ['student'] as Role[],
  'mark:read:all':             ['registry-administrator', 'module-tutor', 'exam-board-chair', 'exam-board-member', 'external-examiner'] as Role[],
  'mark:write':                ['registry-administrator', 'module-tutor', 'integration-service'] as Role[],
  'exam-board:read':           ['registry-administrator', 'exam-board-chair', 'exam-board-member', 'external-examiner'] as Role[],
  'exam-board:ratify':         ['exam-board-chair', 'registry-administrator'] as Role[],
  'adjustment:read:own':       ['student'] as Role[],
  'adjustment:read:all':       ['registry-administrator', 'wellbeing-advisor', 'integration-service', 'adjustment-approver'] as Role[],
  'adjustment:write':          ['registry-administrator', 'wellbeing-advisor'] as Role[],
  // ADR-029: record an adjustment the wellbeing service approved; needs sourceCaseId.
  'adjustment:record-approved':         ['wellbeing-service'] as Role[],
  // ADR-034 item 4: end an adjustment its wellbeing case recorded, naming that case.
  'adjustment:withdraw-approved':       ['wellbeing-service'] as Role[],
  // ADR-033 item 2: a case-less adjustment is a proposal a second person
  // approves. SME-6: not wellbeing-advisor, who has the governed case instead.
  'adjustment:propose':        ['registry-administrator', 'adjustment-proposer'] as Role[],
  'adjustment:approve-manual': ['adjustment-approver'] as Role[],
  // ADR-033 item 7, SME-8: distribute a reconciled migration batch.
  'adjustment:release-migrated': ['adjustment-approver'] as Role[],
  // ADR-034 item 8: end a manual, migrated or legacy adjustment early, by a
  // proposal a second person decides. wellbeing-advisor may propose (these
  // adjustments have no case); no role both proposes and approves.
  'adjustment:propose-withdrawal': ['registry-administrator', 'adjustment-proposer', 'wellbeing-advisor'] as Role[],
  'adjustment:approve-withdrawal': ['adjustment-approver'] as Role[],
  // Work the adjustment task queue: confirm, by hand, that an instruction for
  // a target with no connected system was applied or removed.
  'adjustment:fulfil':         ['registry-administrator', 'engagement-officer', 'tenant-administrator'] as Role[],
  // Work the integration task queue for other outbound flows (library,
  // accommodation, ...) whose target system is not connected.
  'delivery:fulfil':           ['registry-administrator', 'tenant-administrator'] as Role[],
  // Records other systems report about a student (library, accommodation):
  // read on the student record, and entered by hand where no connector exists.
  'external-record:read':      ['registry-administrator', 'tenant-administrator', 'personal-tutor'] as Role[],
  'external-record:write':     ['registry-administrator', 'tenant-administrator'] as Role[],
  // Student support schedules (AJ-32): staff record awards and instalments;
  // the award owner approves them, which sends payroll the instruction.
  'support:read':              ['registry-administrator', 'finance-administrator', 'pgr-administrator', 'pgr-director'] as Role[],
  'support:write':             ['registry-administrator', 'finance-administrator', 'pgr-administrator'] as Role[],
  'support:approve':           ['finance-administrator', 'pgr-director'] as Role[],
  // Student employment links (not appointments: HR owns those) and work limits.
  // research-supervisor reads only their own supervisees, through the assigned routes (D-40).
  'employment-link:read':      ['registry-administrator', 'pgr-administrator', 'pgr-director'] as Role[],
  'employment-link:write':     ['registry-administrator', 'pgr-administrator'] as Role[],
  // Student status cases (BPR-D04): interruption, suspension, return,
  // withdrawal, transfer and leaver closure. Reviewers advise; only the
  // registry decides, and never on a case they opened.
  'status-case:read':          ['registry-administrator', 'programme-approver', 'finance-administrator', 'regulatory-officer', 'pgr-administrator', 'personal-tutor'] as Role[],
  'status-case:request:own':   ['student'] as Role[],
  'status-case:write':         ['registry-administrator', 'pgr-administrator'] as Role[],
  'status-case:assess':        ['registry-administrator', 'programme-approver', 'finance-administrator', 'regulatory-officer'] as Role[],
  'status-case:decide':        ['registry-administrator'] as Role[],
  // Curriculum publications (BPR-D05): the curriculum system sends them
  // (integration-service), the registry reviews and applies them.
  'curriculum-publication:read':    ['registry-administrator', 'tenant-administrator', 'integration-service'] as Role[],
  'curriculum-publication:receive': ['integration-service', 'registry-administrator'] as Role[],
  'curriculum-publication:apply':   ['registry-administrator'] as Role[],
  // Recognised credit and rule exceptions: proposed by the registry,
  // approved by a programme approver (never the proposer).
  'academic-exception:read':        ['registry-administrator', 'programme-approver', 'personal-tutor', 'exam-board-chair'] as Role[],
  'academic-exception:propose':     ['registry-administrator', 'programme-approver'] as Role[],
  'academic-exception:approve':     ['programme-approver', 'registry-administrator'] as Role[],
  // Reasonable-adjustment *case* (wellbeing-module-hosted process — referral,
  // assessment, panel, approve/reject), distinct from the `adjustment:*`
  // permissions above which gate the core-SRS *distributed outcome* record.
  'adjustment-case:read:own':  ['student'] as Role[],
  // BL-237: registry receives the decided outcome in core (ADR-017), not the case.
  'adjustment-case:read:all':  ['wellbeing-advisor', 'wellbeing-specialist-assessor', 'wellbeing-panel-chair'] as Role[],
  'adjustment-case:write:own': ['student'] as Role[],
  'adjustment-case:manage':    ['wellbeing-advisor'] as Role[],
  // BL-239: correcting a case's status outside the state machine is its own permission.
  'adjustment-case:correct-status': ['wellbeing-advisor', 'wellbeing-panel-chair'] as Role[],
  'adjustment-case:assess':    ['wellbeing-specialist-assessor', 'wellbeing-advisor'] as Role[],
  'special-category:read':     ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-panel-chair', 'wellbeing-auditor', 'dpo', 'registry-administrator'] as Role[],
  'mh-session-note:read':      ['wellbeing-mental-health-advisor', 'wellbeing-auditor', 'dpo'] as Role[],
  // Mental-health cases and early-warning alerts are narrower than special-category:read:
  // wellbeing practitioners and oversight only, never registry or panel roles.
  'mh-session-note:write':     ['wellbeing-mental-health-advisor'] as Role[],
  'mental-health-case:read':   ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-auditor', 'dpo'] as Role[],
  'mental-health-case:manage': ['wellbeing-advisor', 'wellbeing-mental-health-advisor'] as Role[],
  'early-warning:read':        ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-auditor', 'dpo'] as Role[],
  'early-warning:triage':      ['wellbeing-advisor', 'wellbeing-mental-health-advisor'] as Role[],
  'panel-decision:write':      ['wellbeing-panel-chair'] as Role[],
  'wellbeing-sar:export':      ['wellbeing-auditor', 'dpo'] as Role[],
  'wellbeing-retention:write': ['wellbeing-auditor', 'registry-administrator'] as Role[],
  'config:read':               ['registry-administrator', 'tenant-administrator', 'system-administrator'] as Role[],
  'config:write':              ['tenant-administrator'] as Role[],
  /** Platform-wide wording for a value (a translation every institution sees). */
  'value-set:translate-platform': ['system-administrator'] as Role[],
  'integration:read':          ['registry-administrator', 'tenant-administrator', 'system-administrator', 'integration-service'] as Role[],
  'integration:manage':        ['tenant-administrator', 'integration-service'] as Role[],
  // ADR-032: machine permissions named after their target; the target is enforced in the route.
  'integration-registration:use:vle': ['vle-connector-service'] as Role[],
  'mark:record-from-vle':             ['vle-connector-service'] as Role[],
  'adjustment-distribution:reply:vle': ['vle-connector-service'] as Role[],
  'audit:read':                ['dpo', 'system-administrator', 'wellbeing-auditor'] as Role[],
  'tenant:manage':             ['system-administrator'] as Role[],
  'rule:read':                          ['registry-administrator', 'tenant-administrator'] as Role[],
  'rule:write':                         ['tenant-administrator'] as Role[],
  'module-registration:read:own':       ['student'] as Role[],
  'module-registration:read:all':       ['registry-administrator', 'module-tutor', 'integration-service', 'external-examiner'] as Role[],
  'module-registration:write:own':      ['student'] as Role[],
  'module-registration:write':          ['registry-administrator'] as Role[],
  'module-registration:decide':         ['registry-administrator', 'personal-tutor'] as Role[],
  'catalogue:read':                     ['student', 'module-tutor', 'personal-tutor', 'registry-administrator', 'programme-approver', 'exam-board-member', 'exam-board-chair', 'integration-service', 'external-examiner'] as Role[],
  'catalogue:write':                    ['registry-administrator', 'tenant-administrator'] as Role[],
  'calendar:read':                      ['student', 'module-tutor', 'registry-administrator', 'tenant-administrator', 'integration-service'] as Role[],
  'calendar:write':                     ['registry-administrator', 'tenant-administrator'] as Role[],
  'disability:read:own':                ['student'] as Role[],
  'disability:read':                    ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-panel-chair', 'wellbeing-auditor', 'dpo', 'registry-administrator'] as Role[],
  'disability:write':                   ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'registry-administrator'] as Role[],
  'exam-board:write':                   ['registry-administrator'] as Role[],
  'circumstances:read:own':             ['student'] as Role[],
  'circumstances:read':                 ['registry-administrator', 'wellbeing-advisor', 'ec-case-officer'] as Role[],
  'circumstances:write':                ['registry-administrator', 'ec-case-officer'] as Role[],
  /** Decide a proposed EC outcome (D-41); never the proposer or the person who recorded the claim. */
  // ADR-028: deciding is held only by the decision maker (amends Phase 5 D-41).
  'circumstances:decide':               ['ec-decision-maker'] as Role[],
  // ADR-029: record an EC outcome the wellbeing service determined (amends ADR-028 item 8).
  'circumstances:record-determined':    ['wellbeing-service'] as Role[],
  /** Wellbeing EC claims (modules/wellbeing): the advisers who run the claim workflow. Needs institutional sign-off. */
  // ADR-028: registry receives the decided outcome in core (ADR-017), not the claim.
  'ec-claim:read':                      ['ec-case-officer', 'ec-decision-maker', 'wellbeing-advisor', 'wellbeing-auditor'] as Role[],
  'ec-claim:manage':                    ['ec-case-officer', 'wellbeing-advisor'] as Role[],
  'ec-claim:determine':                 ['ec-decision-maker'] as Role[],
  'progression:read':                   ['registry-administrator', 'exam-board-chair', 'exam-board-member'] as Role[],
  'progression:write':                  ['registry-administrator'] as Role[],
  'regulatory:read':                    ['registry-administrator', 'regulatory-officer', 'dpo', 'tenant-administrator', 'system-administrator'] as Role[],
  'regulatory:write':                   ['registry-administrator', 'regulatory-officer', 'dpo', 'tenant-administrator', 'system-administrator'] as Role[],
  // One CAS record (Phase 3 D-16): CAS work is the compliance team's, not every regulatory writer's.
  'cas:read':                           ['regulatory-officer', 'registry-administrator'] as Role[],
  'cas:prepare':                        ['regulatory-officer'] as Role[],
  'cas:approve':                        ['regulatory-officer'] as Role[],
  // Right to study (Phase 3 D-17), separate from identity verification.
  'right-to-study:read':                ['registry-administrator', 'regulatory-officer', 'dpo'] as Role[],
  'right-to-study:record':              ['registry-administrator', 'regulatory-officer'] as Role[],
  'right-to-study:decide':              ['regulatory-officer'] as Role[],
  'right-to-study:submit:own':          ['student'] as Role[],
  // Financial registration (Phase 3 D-18): Finance owns amounts; the SRS owns fee status.
  'financial-registration:read':        ['finance-administrator', 'registry-administrator'] as Role[],
  'financial-registration:write':       ['finance-administrator', 'integration-service'] as Role[],
  'fee-status:propose':                 ['registry-administrator', 'finance-administrator'] as Role[],
  'fee-status:decide':                  ['finance-administrator'] as Role[],
  'regulatory:decide':                  ['registry-administrator', 'regulatory-officer'] as Role[],
  'workflow:read':                      ['registry-administrator', 'tenant-administrator'] as Role[],
  'workflow:write':                     ['tenant-administrator'] as Role[],
  'workflow-task:complete':             ['registry-administrator', 'module-tutor', 'personal-tutor', 'wellbeing-advisor', 'exam-board-member', 'exam-board-chair', 'regulatory-officer', 'finance-administrator', 'tenant-administrator'] as Role[],
  'feature-flag:read':                  ['registry-administrator', 'tenant-administrator', 'system-administrator'] as Role[],
  'feature-flag:write':                 ['tenant-administrator', 'system-administrator'] as Role[],
  'feature-flag:govern':                ['system-administrator'] as Role[],
  'environment:read':                   ['registry-administrator', 'tenant-administrator'] as Role[],
  'environment:write':                  ['tenant-administrator'] as Role[],
  'globalisation:read':                 ['registry-administrator', 'tenant-administrator'] as Role[],
  'globalisation:write':                ['tenant-administrator'] as Role[],
  'communications:read':                ['registry-administrator', 'tenant-administrator'] as Role[],
  'communications:write':               ['registry-administrator', 'tenant-administrator'] as Role[],
  // Email: the institution's mailbox, the provider's inbound hook, and the fake mail server.
  'email:read':                         ['registry-administrator', 'tenant-administrator'] as Role[],
  'email:send':                         ['registry-administrator', 'tenant-administrator'] as Role[],
  'email:receive':                      ['integration-service'] as Role[],
  'email-simulator:use':                ['registry-administrator', 'tenant-administrator', 'system-administrator'] as Role[],
  'audit-log:read':                     ['dpo', 'system-administrator', 'registry-administrator', 'wellbeing-auditor'] as Role[],
  // BP-08 pre-review R08-8 (BL-287): reviewing the audit trail is not part of
  // reading it, and is not open to the people whose actions are audited.
  'audit-review:manage':                ['dpo'] as Role[],
  'audit:seal':                         ['dpo', 'system-administrator'] as Role[],
  // BL-284: irreversible disposal is a DPO decision, not an IT operation.
  'retention:enforce':                  ['dpo'] as Role[],
  // BL-327: a second person approves a disposal plan; never its preparer (enforced in the service).
  'retention:approve':                  ['dpo'] as Role[],
  'notifications:read':                 ['student', 'registry-administrator', 'tenant-administrator', 'system-administrator', 'external-examiner'] as Role[],
  'notifications:write':                ['registry-administrator', 'tenant-administrator', 'system-administrator'] as Role[],
  'circumstances:submit':               ['student'] as Role[],
  'engagement:event:read':              ['module-tutor', 'personal-tutor', 'engagement-officer', 'registry-administrator', 'integration-service'] as Role[],
  'engagement:event:write':             ['engagement-officer', 'registry-administrator', 'integration-service'] as Role[],
  'engagement:observation:create':      ['module-tutor', 'engagement-officer', 'registry-administrator', 'integration-service'] as Role[],
  'engagement:observation:correct':     ['module-tutor', 'engagement-officer', 'registry-administrator', 'integration-service'] as Role[],
  'engagement:timeline:read':           ['personal-tutor', 'engagement-officer', 'registry-administrator'] as Role[],
  'engagement:policy:read':             ['engagement-officer', 'registry-administrator', 'tenant-administrator'] as Role[],
  'engagement:policy:manage':           ['tenant-administrator'] as Role[],
  'engagement:evaluation:run':          ['engagement-officer', 'registry-administrator', 'integration-service'] as Role[],
  'engagement:alert:read':              ['personal-tutor', 'engagement-officer', 'registry-administrator'] as Role[],
  'engagement:case:read':               ['personal-tutor', 'engagement-officer', 'registry-administrator'] as Role[],
  'engagement:case:manage':             ['engagement-officer', 'registry-administrator'] as Role[],
  'engagement:case:refer':              ['engagement-officer', 'registry-administrator'] as Role[],
  'engagement-outcome:write':           ['integration-service', 'engagement-officer', 'registry-administrator'] as Role[],
  'engagement-outcome:read:own':        ['student'] as Role[],
  'engagement-outcome:read:all':        ['personal-tutor', 'engagement-officer', 'registry-administrator', 'integration-service'] as Role[],
  'identity:manage':                    ['dpo', 'registry-administrator'] as Role[],
  // ADR-031: identity resolution cases. Deciding a merge is the officer's alone, and never the preparer's.
  'identity-resolution:read':           ['identity-resolution-officer', 'registry-administrator', 'dpo'] as Role[],
  'identity-resolution:prepare':        ['identity-resolution-officer', 'registry-administrator'] as Role[],
  'identity-resolution:decide':         ['identity-resolution-officer'] as Role[],
  // Identity verification results, including fraud flags: only those who act on them (D-6).
  'identity-verification:read':         ['registry-administrator', 'dpo', 'regulatory-officer'] as Role[],
  // Academic misconduct outcomes and their effects, never allegations or evidence (D-5; ADR-017).
  'misconduct:record':                  ['integrity-officer', 'registry-administrator'] as Role[],
  'misconduct:read':                    ['integrity-officer', 'registry-administrator', 'exam-board-chair'] as Role[],
  'module-selection:read:own':          ['student'] as Role[],
  'module-selection:write:own':         ['student'] as Role[],
  'module-selection:read:all':          ['registry-administrator', 'personal-tutor', 'programme-approver', 'integration-service'] as Role[],
  'module-selection:decide':            ['registry-administrator', 'programme-approver'] as Role[],
  'module-selection:configure':         ['registry-administrator', 'tenant-administrator'] as Role[],
  /** Submit a selection outside its window, with a reason (Phase 4 D-29). */
  'module-selection:submit:late':       ['registry-administrator'] as Role[],
  /** Preview and submit ranked allocation runs (D-30); a different module-selection:decide holder approves. */
  'module-selection:allocate':          ['registry-administrator'] as Role[],
  /** Receive or enter timetable publications (D-24). */
  'timetable:manage':                   ['registry-administrator', 'tenant-administrator', 'integration-service'] as Role[],
  'timetable:read':                     ['registry-administrator', 'tenant-administrator', 'integration-service', 'personal-tutor', 'programme-approver'] as Role[],
  'curriculum-binding:read':             ['registry-administrator', 'programme-approver'] as Role[],
  'curriculum-binding:write':            ['registry-administrator'] as Role[],
  // A binding change something already depends on is decided by a programme approver (D-11).
  'curriculum-binding:approve':          ['programme-approver'] as Role[],
  // Annual and initial registration (D-8, D-10): the registry opens and closes
  // periods and may confirm on a student's behalf; students confirm their own.
  'registration-period:manage':          ['registry-administrator'] as Role[],
  'registration:read':                   ['registry-administrator', 'personal-tutor'] as Role[],
  'registration:confirm:assisted':       ['registry-administrator'] as Role[],
  // Failure to register (BP-02-011; D-9): chase lapsed students and decide non-registration.
  'non-registration:manage':             ['registry-administrator'] as Role[],
  // Clearing (BP-01-006; D-13): the one-step decision, and the next-day review by someone else.
  'clearing:decide':                     ['programme-approver', 'registry-administrator'] as Role[],
  'clearing:review':                     ['programme-approver'] as Role[],
  'registration:confirm:own':            ['student'] as Role[],
  // Phase 5 D-39: an applicant's own applications (scoped to srs_person_id).
  'application:read:own':                ['applicant'] as Role[],
  'offer:respond:own':                   ['applicant'] as Role[],
  'condition-evidence:submit:own':       ['applicant'] as Role[],
  'application:withdraw:own':            ['applicant'] as Role[],
  'pgr-case:read':                       ['pgr-administrator', 'pgr-director', 'registry-administrator'] as Role[],
  // Phase 5 D-40: research staff see only the cases they are assigned to (scoped to srs_person_id).
  'pgr-case:read:assigned':              ['research-supervisor', 'pgr-examiner'] as Role[],
  'pgr-review:contribute:assigned':      ['research-supervisor'] as Role[],
  'pgr-report:submit:own':               ['pgr-examiner'] as Role[],
  'pgr-case:read:own':                   ['student'] as Role[],
  'pgr-case:write':                      ['pgr-administrator', 'registry-administrator'] as Role[],
  'pgr-case:decide':                     ['pgr-director', 'registry-administrator'] as Role[],
  'award:confer:research':               ['pgr-director', 'registry-administrator'] as Role[],
  // Award recommendation and conferment (BPR-D14): the board recommends,
  // a delegated authority who is not the recommender confers.
  'award:recommend':                     ['exam-board-chair', 'registry-administrator'] as Role[],
  // G5 (BL-279): not tenant-administrator, an IT role with no academic authority.
  'award:confer':                        ['registry-administrator', 'conferment-authority'] as Role[],
  // Reassessment plans follow a ratified progression decision.
  'reassessment:read':                   ['registry-administrator', 'exam-board-chair', 'exam-board-member', 'module-tutor', 'personal-tutor'] as Role[],
  'reassessment:write':                  ['registry-administrator'] as Role[],
  // Award documents (BPR-D15): the registry issues and revokes; verifiers
  // (e.g. a degree-verification service) check a code.
  'document:read':                       ['registry-administrator'] as Role[],
  'document:read:own':                   ['student'] as Role[],
  'document:issue':                      ['registry-administrator'] as Role[],
  'document:revoke':                     ['registry-administrator'] as Role[],
  // Revoking an issued document takes two people (Phase 3 D-20): a different registry administrator decides.
  'document:revoke:approve':             ['registry-administrator'] as Role[],
  'document-signing-key:manage':         ['tenant-administrator'] as Role[],
  'document:verify':                     ['registry-administrator', 'integration-service'] as Role[],
  // Graduation (BPR-D15): the graduation team runs cycles; students respond.
  'graduation:read':                     ['registry-administrator'] as Role[],
  'graduation:manage':                   ['registry-administrator'] as Role[],
  'graduation:respond:own':              ['student'] as Role[],
  // Applications and offers (BPR-D01/D02). Channels and connectors send
  // applications; admissions staff route and recommend; academic selectors
  // assess; a delegated authority who did not recommend decides.
  'application:read':                    ['registry-administrator', 'programme-approver', 'integration-service'] as Role[],
  'application:receive':                 ['integration-service', 'registry-administrator'] as Role[],
  'application:write':                   ['registry-administrator'] as Role[],
  'application:assess':                  ['programme-approver', 'registry-administrator'] as Role[],
  'offer:decide':                        ['programme-approver', 'registry-administrator'] as Role[],
} as const;

export type Permission = keyof typeof PERMISSION_ROLES;

export function hasPermission(roles: Role[], permission: Permission): boolean {
  const required = PERMISSION_ROLES[permission] as readonly Role[];
  return roles.some((r) => required.includes(r));
}
