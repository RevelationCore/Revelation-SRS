import type { FulfilmentMode } from '../adjustments/target-config.js';

/**
 * Outbound reference-model flows delivered through the platform delivery
 * ledger (docs/reference/revelation-student-records-enterprise-reference-model-3.0.json).
 *
 * These are the SRS → adjacent-system flows for systems with no other route:
 * every institution can deliver them, by a connected integration, a staff
 * task queue, a file export, or not at all. A flow whose `producer` is
 * 'none' is registered — so the gap is visible in the admin app and the
 * capability record — but nothing in the SRS creates items for it yet.
 *
 * Flows with their own mechanism are not listed here: adjustments
 * (F-SIS-VLE-02, F-SIS-AM-02, F-SIS-EXAMS-01) use adjustment_distribution;
 * regulatory returns, the VLE and portal provisioning, the wellbeing module
 * and exam boards have dedicated integrations.
 */
export interface DeliveryFlow {
  flowCode:     string;
  targetSystem: string;
  targetLabel:  string;
  name:         string;
  defaultMode:  FulfilmentMode;
  /** True: a later item for the same subject supersedes an undelivered earlier one. */
  stateSync:    boolean;
  /**
   * implemented — SRS events create items as things change
   * extract     — run per academic period (an aggregate, one item per offering)
   * none        — nothing in the SRS creates items yet
   */
  producer:     'implemented' | 'extract' | 'none';
  /** What creates items, or what is missing. */
  producerNote: string;
}

export const DELIVERY_FLOWS: readonly DeliveryFlow[] = [
  {
    flowCode: 'F-SIS-FIN-01', targetSystem: 'fin', targetLabel: 'finance system',
    name: 'Enrolment and tuition fee liability to finance', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'A year\'s fee liability changing financial status sends its snapshot: fee status, financial status and payer arrangement (Phase 3 D-18).',
  },
  {
    flowCode: 'F-SIS-IAM-01', targetSystem: 'iam', targetLabel: 'identity and access management',
    name: 'Identity, enrolment status and access level to IAM', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'Conversion, each status change, an approved leaver closure, a bound application, a supervision assignment and an examiner appointment send the person\'s account (contract v2: kind, portal roles, access level limited, full, suspended or ended, and effective date); a student account ends at leaver closure plus a grace period (Phase 3 D-19, Phase 5 D-38).',
  },
  {
    flowCode: 'F-SIS-TTB-01', targetSystem: 'ttb', targetLabel: 'timetabling system',
    name: 'Confirmed module registrations to timetabling', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'A module registration being created, withdrawn or changing status sends add, update or remove for that student and offering; a roster snapshot per offering can be run for reconciliation, and an acknowledgement with a different count is a mismatch (Phase 4 D-26).',
  },
  {
    flowCode: 'F-SIS-LIB-01', targetSystem: 'lib', targetLabel: 'library system',
    name: 'Library access from enrolment status', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'An enrolment being created or changing status grants, suspends or revokes library access.',
  },
  {
    flowCode: 'F-SIS-CRM-01', targetSystem: 'crm', targetLabel: 'CRM',
    name: 'Enrolment status and progression to CRM', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'An enrolment being created, changing status, or receiving a progression decision sends the enrolment\'s current status and latest progression.',
  },
  {
    flowCode: 'F-SIS-ACC-01', targetSystem: 'acc', targetLabel: 'accommodation system',
    name: 'Student profile and enrolment status to accommodation', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'An enrolment being created or changing status sends its status, mode of study, programme and start date.',
  },
  {
    flowCode: 'F-SIS-EST-01', targetSystem: 'est', targetLabel: 'estates system',
    name: 'Enrolment volumes and occupancy forecasts to estates', defaultMode: 'manual', stateSync: true,
    producer: 'extract',
    producerNote: 'Run per academic period: registered students against capacity for each module offering.',
  },
  {
    flowCode: 'F-SIS-OIV-01', targetSystem: 'oiv', targetLabel: 'identity verification service',
    name: 'Identity verification requests', defaultMode: 'manual', stateSync: false,
    producer: 'implemented',
    producerNote: 'Requesting an identity verification check sends the identity data the provider needs; completing the check marks it done.',
  },
  {
    flowCode: 'F-SIS-SETS-01', targetSystem: 'sets', targetLabel: 'survey system',
    name: 'Module rosters for evaluation surveys', defaultMode: 'manual', stateSync: true,
    producer: 'extract',
    producerNote: 'Run per academic period: the roster of registered students for each module offering.',
  },
  {
    flowCode: 'F-SIS-PAY-01', targetSystem: 'pay', targetLabel: 'payroll system',
    name: 'Student support payment instructions', defaultMode: 'manual', stateSync: false,
    producer: 'implemented',
    producerNote: 'Approving a student support instalment sends payroll the instruction (operation id = instalment id); payroll\'s confirmation marks it paid. GTA teaching pay is not sent: HR and payroll own it.',
  },
  {
    flowCode: 'F-SIS-RP-01', targetSystem: 'rp', targetLabel: 'research portal',
    name: 'Researcher eligibility and supervisor assignments', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'Approving supervisors, or closing the team, sends the research student\'s current supervisory team.',
  },
  {
    flowCode: 'F-SIS-CMS-01', targetSystem: 'cms', targetLabel: 'content management system',
    name: 'Cohort and programme data for content personalisation', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'An enrolment being created, changing status or receiving a progression decision sends cohort and programme data.',
  },
  {
    flowCode: 'F-SIS-ITSM-01', targetSystem: 'itsm', targetLabel: 'IT service management',
    name: 'Student identity and account data for incident context', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'A person being created, their identity changing, or an enrolment changing sends their service-desk snapshot.',
  },
  {
    flowCode: 'F-SIS-HR-01', targetSystem: 'hr', targetLabel: 'HR system',
    name: 'Employed student: study status change for review', defaultMode: 'manual', stateSync: true,
    producer: 'implemented',
    producerNote: 'A student with university employment interrupting, being suspended, withdrawing or completing asks HR to review the roles; HR decides.',
  },
  {
    flowCode: 'F-SIS-CM-01', targetSystem: 'cm', targetLabel: 'curriculum management system',
    name: 'Enrolment, completion and performance metrics to curriculum management', defaultMode: 'manual', stateSync: true,
    producer: 'extract',
    producerNote: 'Run per academic period: registration and result counts for each module offering.',
  },
];

export function findFlow(flowCode: string): DeliveryFlow | undefined {
  return DELIVERY_FLOWS.find((f) => f.flowCode === flowCode);
}

/** NATS subject token for a flow: srs.delivery.requested.f-sis-lib-01 */
export function flowSubjectToken(flowCode: string): string {
  return flowCode.toLowerCase();
}
