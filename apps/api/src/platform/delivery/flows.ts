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
  /** Whether anything in the SRS creates items for this flow yet. */
  producer:     'implemented' | 'none';
  /** What creates items, or what is missing. */
  producerNote: string;
}

export const DELIVERY_FLOWS: readonly DeliveryFlow[] = [
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
    name: 'Enrolment volumes and occupancy forecasts to estates', defaultMode: 'manual', stateSync: false,
    producer: 'none', producerNote: 'No SRS trigger yet (an aggregate extract, likely a file).',
  },
  {
    flowCode: 'F-SIS-OIV-01', targetSystem: 'oiv', targetLabel: 'identity verification service',
    name: 'Identity verification requests', defaultMode: 'manual', stateSync: false,
    producer: 'none', producerNote: 'No SRS trigger yet.',
  },
  {
    flowCode: 'F-SIS-SETS-01', targetSystem: 'sets', targetLabel: 'survey system',
    name: 'Module rosters for evaluation surveys', defaultMode: 'manual', stateSync: false,
    producer: 'none', producerNote: 'No SRS trigger yet (a roster extract, likely a file).',
  },
  {
    flowCode: 'F-SIS-PAY-01', targetSystem: 'pay', targetLabel: 'payroll system',
    name: 'Bursary eligibility and GTA payment authorisations', defaultMode: 'manual', stateSync: false,
    producer: 'none', producerNote: 'No SRS trigger yet.',
  },
  {
    flowCode: 'F-SIS-RP-01', targetSystem: 'rp', targetLabel: 'research portal',
    name: 'Researcher eligibility and supervisor assignments', defaultMode: 'manual', stateSync: true,
    producer: 'none', producerNote: 'No SRS trigger yet.',
  },
  {
    flowCode: 'F-SIS-CMS-01', targetSystem: 'cms', targetLabel: 'content management system',
    name: 'Cohort and programme data for content personalisation', defaultMode: 'manual', stateSync: true,
    producer: 'none', producerNote: 'No SRS trigger yet.',
  },
  {
    flowCode: 'F-SIS-ITSM-01', targetSystem: 'itsm', targetLabel: 'IT service management',
    name: 'Student identity and account data for incident context', defaultMode: 'manual', stateSync: true,
    producer: 'none', producerNote: 'No SRS trigger yet.',
  },
  {
    flowCode: 'F-SIS-CM-01', targetSystem: 'cm', targetLabel: 'curriculum management system',
    name: 'Enrolment, completion and performance metrics to curriculum management', defaultMode: 'manual', stateSync: false,
    producer: 'none', producerNote: 'No SRS trigger yet.',
  },
];

export function findFlow(flowCode: string): DeliveryFlow | undefined {
  return DELIVERY_FLOWS.find((f) => f.flowCode === flowCode);
}

/** NATS subject token for a flow: srs.delivery.requested.f-sis-lib-01 */
export function flowSubjectToken(flowCode: string): string {
  return flowCode.toLowerCase();
}
