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
] as const;

export type Role = (typeof ROLES)[number];

/**
 * Permission → roles that hold it.
 * Application middleware checks these at route level.
 */
export const PERMISSION_ROLES = {
  'student:read:own':          ['student'] as Role[],
  'student:read:all':          ['registry-administrator', 'exam-board-chair', 'wellbeing-advisor', 'dpo', 'external-examiner'] as Role[],
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
  'adjustment:read:all':       ['registry-administrator', 'wellbeing-advisor', 'integration-service'] as Role[],
  'adjustment:write':          ['registry-administrator', 'wellbeing-advisor'] as Role[],
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
  'adjustment-case:read:all':  ['wellbeing-advisor', 'wellbeing-specialist-assessor', 'wellbeing-panel-chair', 'registry-administrator'] as Role[],
  'adjustment-case:write:own': ['student'] as Role[],
  'adjustment-case:manage':    ['wellbeing-advisor', 'registry-administrator'] as Role[],
  'adjustment-case:assess':    ['wellbeing-specialist-assessor', 'wellbeing-advisor'] as Role[],
  'special-category:read':     ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-panel-chair', 'wellbeing-auditor', 'dpo', 'registry-administrator'] as Role[],
  'mh-session-note:read':      ['wellbeing-mental-health-advisor', 'wellbeing-auditor', 'dpo'] as Role[],
  'panel-decision:write':      ['wellbeing-panel-chair', 'registry-administrator'] as Role[],
  'wellbeing-sar:export':      ['wellbeing-auditor', 'dpo'] as Role[],
  'wellbeing-retention:write': ['wellbeing-auditor', 'registry-administrator'] as Role[],
  'config:read':               ['registry-administrator', 'tenant-administrator', 'system-administrator'] as Role[],
  'config:write':              ['tenant-administrator'] as Role[],
  'integration:read':          ['registry-administrator', 'tenant-administrator', 'system-administrator', 'integration-service'] as Role[],
  'integration:manage':        ['tenant-administrator', 'integration-service'] as Role[],
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
  'calendar:read':                      ['student', 'module-tutor', 'registry-administrator', 'integration-service'] as Role[],
  'calendar:write':                     ['registry-administrator', 'tenant-administrator'] as Role[],
  'disability:read:own':                ['student'] as Role[],
  'disability:read':                    ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'wellbeing-panel-chair', 'wellbeing-auditor', 'dpo', 'registry-administrator'] as Role[],
  'disability:write':                   ['wellbeing-advisor', 'wellbeing-mental-health-advisor', 'registry-administrator'] as Role[],
  'exam-board:write':                   ['registry-administrator'] as Role[],
  'circumstances:read:own':             ['student'] as Role[],
  'circumstances:read':                 ['registry-administrator', 'wellbeing-advisor'] as Role[],
  'circumstances:write':                ['registry-administrator'] as Role[],
  /** Decide a proposed EC outcome (D-41); never the proposer or the person who recorded the claim. */
  'circumstances:decide':               ['registry-administrator', 'exam-board-chair'] as Role[],
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
  'audit-log:read':                     ['dpo', 'system-administrator', 'registry-administrator', 'wellbeing-auditor'] as Role[],
  'retention:enforce':                  ['dpo', 'system-administrator'] as Role[],
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
  'award:confer':                        ['registry-administrator', 'tenant-administrator'] as Role[],
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
