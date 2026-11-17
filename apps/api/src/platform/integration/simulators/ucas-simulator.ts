import type { UcasDecisionFile } from '../../regulatory/ucas-decision-outbox.js';

/**
 * An in-repo UCAS simulator (Phase 3 D-14), used by tests, demo data and the
 * golden suite when a tenant's UCAS transport is 'simulator'. It accepts a
 * decision file and replies as UCAS would, with each applicant's resulting
 * application status, through the same inbound path a real link uses. It is
 * never selectable for an endpoint classed external-production.
 */
const STATUS_FOR: Record<string, string> = {
  'offer-conditional': 'offer-made', 'offer-unconditional': 'offer-made', reject: 'withdrawn', withdraw: 'withdrawn',
  confirmed: 'confirmed', 'confirmed-alternative': 'confirmed', unsuccessful: 'withdrawn',
};

export function createUcasSimulator(reportStatus: (tenantId: string, sourceReference: string, cycle: string, statusCode: string) => Promise<void>) {
  return async (tenantId: string, file: UcasDecisionFile): Promise<void> => {
    for (const d of file.decisions) {
      const status = STATUS_FOR[d.outcome];
      if (status) await reportStatus(tenantId, d.sourceReference, d.cycle, status);
    }
  };
}
