/**
 * Story manifest for the remaining UAT stories not covered by the first UAT session.
 *
 * Each entry describes one UAT story, including:
 *   - storyId      UAT story identifier
 *   - title        Human-readable title
 *   - scenario     Demo scenario slug to load before this story runs
 *   - persona      Key into the PERSONAS map (see personas.ts)
 *   - app          'admin' | 'portal'
 *   - startUrl     First URL to visit (relative to the app base)
 *   - checks       Array of assertions to run after navigation
 *   - knownGaps    Documented limitations / placeholder steps (not treated as failures)
 *
 * Stories are grouped by scenario so resets are not repeated unnecessarily.
 */

import type { PersonaKey } from './personas.js';

export interface Check {
  type:  'heading' | 'text' | 'table-rows' | 'no-console-error' | 'no-http-error' | 'axe';
  value?: string;
  minRows?: number;
}

export interface StoryEntry {
  storyId:    string;
  title:      string;
  scenario:   string;
  persona:    PersonaKey;
  app:        'admin' | 'portal';
  startUrl:   string;
  extraUrls?: string[];
  checks:     Check[];
  knownGaps?: string[];
}

// ── S2 — enrolment-induction (ops stories) ───────────────────────────────────

const S2_OPS: StoryEntry[] = [
  {
    storyId: 'OP-01',
    title:   'View feature flags',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/flags',
    checks: [
      { type: 'heading', value: 'Feature Flags' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
  {
    storyId: 'OP-02',
    title:   'View value sets',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/value-sets',
    checks: [
      { type: 'heading', value: 'Value Sets' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'OP-03',
    title:   'View workflow definitions',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/workflows',
    checks: [
      { type: 'heading', value: 'Workflow Definitions' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'OP-04',
    title:   'View academic rules',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/rules',
    checks: [
      { type: 'heading', value: 'Academic Rules' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'OP-05',
    title:   'View tenant configuration',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/config',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'OP-06',
    title:   'View globalisation settings',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/globalisation',
    checks: [
      { type: 'heading', value: 'Globalisation' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'OP-07',
    title:   'View integrations registry',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/tenant-admin/integrations',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Integrations page may be gated to system-administrator only'],
  },
  {
    storyId: 'OP-08',
    title:   'View environment runtime',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/operations/environment',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'OP-09',
    title:   'View integration operations',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/operations/integrations',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
];

// ── S4 — assessment-marks (registry, wellbeing, dpo stories) ─────────────────

const S4_AR: StoryEntry[] = [
  {
    storyId: 'AR-01',
    title:   'Search for a student by name',
    scenario: 'assessment-marks',
    persona:  'registry',
    app:      'admin',
    startUrl: '/students',
    checks: [
      { type: 'heading', value: 'Students' },
      { type: 'table-rows', minRows: 1 },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
  {
    storyId: 'AR-03',
    title:   'View student module registrations',
    scenario: 'assessment-marks',
    persona:  'registry',
    app:      'admin',
    startUrl: '/students',
    extraUrls: ['/registrations'],
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Test navigates to first student detail page; student-specific URL requires runtime lookup'],
  },
  {
    storyId: 'AR-05',
    title:   'View task inbox',
    scenario: 'assessment-marks',
    persona:  'registry',
    app:      'admin',
    startUrl: '/tasks',
    checks: [
      { type: 'heading', value: 'Task Inbox' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
    knownGaps: ['Seeded tasks may be empty in assessment-marks scenario'],
  },
];

const S4_WB: StoryEntry[] = [
  {
    storyId: 'WB-01',
    title:   'View student disability declarations',
    scenario: 'assessment-marks',
    persona:  'wellbeing',
    app:      'admin',
    startUrl: '/students',
    checks: [
      { type: 'heading', value: 'Students' },
      { type: 'table-rows', minRows: 1 },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
  {
    storyId: 'WB-02',
    title:   'View student reasonable adjustments',
    scenario: 'assessment-marks',
    persona:  'wellbeing',
    app:      'admin',
    startUrl: '/students',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Wellbeing tab requires navigating to a student detail page; student URL requires runtime lookup'],
  },
  {
    storyId: 'WB-03',
    title:   'View student exceptional circumstances',
    scenario: 'assessment-marks',
    persona:  'wellbeing',
    app:      'admin',
    startUrl: '/students',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['EC tab is within student detail wellbeing tab; student URL requires runtime lookup'],
  },
];

const S4_TI: StoryEntry[] = [
  {
    storyId: 'TI-01',
    title:   'Complete a task from the task inbox',
    scenario: 'assessment-marks',
    persona:  'registry',
    app:      'admin',
    startUrl: '/tasks',
    checks: [
      { type: 'heading', value: 'Task Inbox' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Task completion requires seeded workflow tasks in assessment-marks scenario'],
  },
];

const S4_DPO: StoryEntry[] = [
  {
    storyId: 'RE-07',
    title:   'View FOI/SAR request register',
    scenario: 'assessment-marks',
    persona:  'dpo',
    app:      'admin',
    startUrl: '/reporting/foi',
    checks: [
      { type: 'heading', value: 'Freedom of Information' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
    knownGaps: ['FOI requests list uses <ul> not <table>; no seeded FOI data in assessment-marks scenario'],
  },
  {
    storyId: 'AU-01',
    title:   'View audit log',
    scenario: 'assessment-marks',
    persona:  'dpo',
    app:      'admin',
    startUrl: '/tenant-admin/audit',
    checks: [
      { type: 'heading', value: 'Audit' },
      { type: 'text', value: 'entity-level audit' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
    knownGaps: ['DPO sees placeholder explaining audit is via student History tab; integration exchange log not shown to DPO'],
  },
];

// ── S5 — exam-board (chair stories) ──────────────────────────────────────────

const S5_EB: StoryEntry[] = [
  {
    storyId: 'EB-01',
    title:   'View exam board list',
    scenario: 'exam-board',
    persona:  'chair',
    app:      'admin',
    startUrl: '/exam-boards',
    checks: [
      { type: 'heading', value: 'Exam Boards' },
      { type: 'table-rows', minRows: 1 },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
  {
    storyId: 'EB-02',
    title:   'View exam board detail and candidate profiles',
    scenario: 'exam-board',
    persona:  'chair',
    app:      'admin',
    startUrl: '/exam-boards',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Board detail URL requires runtime board ID lookup from the list page'],
  },
  {
    storyId: 'EB-03',
    title:   'View data pack for an exam board',
    scenario: 'exam-board',
    persona:  'chair',
    app:      'admin',
    startUrl: '/exam-boards',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Data pack section within board detail page; board URL requires runtime lookup'],
  },
  {
    storyId: 'EB-04',
    title:   'Record progression decisions',
    scenario: 'exam-board',
    persona:  'chair',
    app:      'admin',
    startUrl: '/exam-boards',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
    knownGaps: ['Progression form within board detail page; requires runtime board ID'],
  },
];

// ── S6 — institution-year (regulatory, reporting stories) ─────────────────────

const S6_RE: StoryEntry[] = [
  {
    storyId: 'RE-06',
    title:   'Review UKVI compliance and CAS records',
    scenario: 'institution-year',
    persona:  'dpo',
    app:      'admin',
    startUrl: '/regulatory/ukvi',
    checks: [
      { type: 'heading', value: 'UKVI' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
];

const S6_RP: StoryEntry[] = [
  {
    storyId: 'RP-01',
    title:   'View enrolment report',
    scenario: 'institution-year',
    persona:  'registry',
    app:      'admin',
    startUrl: '/reporting/enrolments',
    checks: [
      { type: 'heading', value: 'Enrolment' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
  {
    storyId: 'RP-02',
    title:   'View regulatory status report',
    scenario: 'institution-year',
    persona:  'ops',
    app:      'admin',
    startUrl: '/reporting/regulatory-status',
    checks: [
      { type: 'heading', value: 'Regulatory' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
];

// ── Cross-cutting (any scenario) ──────────────────────────────────────────────

const X_CROSS: StoryEntry[] = [
  {
    storyId: 'X-01',
    title:   'Demo banner is visible',
    scenario: 'enrolment-induction',
    persona:  'ops',
    app:      'admin',
    startUrl: '/dashboard',
    checks: [
      { type: 'text', value: 'Demo' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'X-02',
    title:   'Navigation sidebar renders all expected links',
    scenario: 'enrolment-induction',
    persona:  'registry',
    app:      'admin',
    startUrl: '/dashboard',
    checks: [
      { type: 'text', value: 'Students' },
      { type: 'text', value: 'Exam Boards' },
      { type: 'no-http-error' },
      { type: 'no-console-error' },
    ],
  },
  {
    storyId: 'X-03',
    title:   'Dashboard accessibility pass',
    scenario: 'enrolment-induction',
    persona:  'registry',
    app:      'admin',
    startUrl: '/dashboard',
    checks: [
      { type: 'no-http-error' },
      { type: 'no-console-error' },
      { type: 'axe' },
    ],
  },
];

// ── Full manifest, ordered by scenario (minimises resets) ─────────────────────

export const MANIFEST: StoryEntry[] = [
  ...S2_OPS,
  ...S4_AR,
  ...S4_WB,
  ...S4_TI,
  ...S4_DPO,
  ...S5_EB,
  ...S6_RE,
  ...S6_RP,
  ...X_CROSS,
];
