import type { Logger } from 'pino';

import type { VleDb } from '../db/client.js';
import type { SrsAcknowledgementClient } from '../srs-client/acknowledgement-client.js';
import type { SrsMarkClient }            from '../srs-client/mark-client.js';
import type { VleClient }                from '../vle-client/client.js';

import {
  completeReconciliationRun,
  findAppliedAdjustments,
  findUnsubmittedMarks,
  findUnsyncedEnrolments,
  insertReconciliationRun,
  updateAdjustmentAcknowledged,
  updateEnrolmentVleId,
  updateMarkReceiptId,
  type ReconciliationRunType,
} from './reconciliation-repository.js';

export interface ReconciliationResult {
  runId:         string;
  runType:       ReconciliationRunType;
  driftCount:    number;
  repairedCount: number;
}

export class ReconciliationService {
  constructor(
    private readonly db:             VleDb,
    private readonly tenantId:       string,
    private readonly vleClient:      VleClient | undefined,
    private readonly srsAckClient:   SrsAcknowledgementClient | undefined,
    private readonly srsMarkClient:  SrsMarkClient | undefined,
    private readonly log:            Logger,
  ) {}

  async reconcileRoster(): Promise<ReconciliationResult> {
    const runId = await insertReconciliationRun(this.db, this.tenantId, 'roster');
    const rows  = await findUnsyncedEnrolments(this.db, this.tenantId);
    const driftCount = rows.length;
    let repairedCount = 0;

    if (this.vleClient && rows.length > 0) {
      for (const row of rows) {
        try {
          const statusCode = row.statusCode as 'active' | 'suspended' | 'withdrawn' | 'completed';
          const { vleEnrolmentId } = await this.vleClient.upsertEnrolment({
            moduleId:             row.moduleId,
            moduleRegistrationId: row.moduleRegistrationId,
            personId:             row.personId,
            enrolmentId:          row.enrolmentId,
            statusCode,
          });
          await updateEnrolmentVleId(this.db, this.tenantId, row.moduleRegistrationId, vleEnrolmentId);
          repairedCount++;
        } catch (err) {
          this.log.warn({ moduleRegistrationId: row.moduleRegistrationId, err }, 'reconcileRoster: repair failed');
        }
      }
    }

    await completeReconciliationRun(this.db, runId, { driftCount, repairedCount });
    return { runId, runType: 'roster', driftCount, repairedCount };
  }

  async reconcileAdjustments(): Promise<ReconciliationResult> {
    const runId = await insertReconciliationRun(this.db, this.tenantId, 'adjustments');
    const rows  = await findAppliedAdjustments(this.db, this.tenantId);
    const driftCount = rows.length;
    let repairedCount = 0;

    if (this.srsAckClient && rows.length > 0) {
      for (const row of rows) {
        try {
          await this.srsAckClient.acknowledgeDistribution(row.adjustmentId, row.distributionId);
          await updateAdjustmentAcknowledged(this.db, this.tenantId, row.distributionId, new Date());
          repairedCount++;
        } catch (err) {
          this.log.warn({ distributionId: row.distributionId, err }, 'reconcileAdjustments: repair failed');
        }
      }
    }

    await completeReconciliationRun(this.db, runId, { driftCount, repairedCount });
    return { runId, runType: 'adjustments', driftCount, repairedCount };
  }

  async reconcileMarks(): Promise<ReconciliationResult> {
    const runId = await insertReconciliationRun(this.db, this.tenantId, 'marks');
    const rows  = await findUnsubmittedMarks(this.db, this.tenantId);
    const driftCount = rows.length;
    let repairedCount = 0;

    if (this.srsMarkClient && rows.length > 0) {
      for (const row of rows) {
        try {
          const { markId } = await this.srsMarkClient.submitMark(row.moduleRegistrationId, {
            assessmentComponentId: row.assessmentComponentId,
            rawMark:               Number(row.rawMark),
            sourceReference:       row.sourceReference,
            sourceSystem:          'vle',
          });
          await updateMarkReceiptId(this.db, this.tenantId, row.id, markId);
          repairedCount++;
        } catch (err) {
          this.log.warn({ receiptId: row.id, err }, 'reconcileMarks: repair failed');
        }
      }
    }

    await completeReconciliationRun(this.db, runId, { driftCount, repairedCount });
    return { runId, runType: 'marks', driftCount, repairedCount };
  }
}
