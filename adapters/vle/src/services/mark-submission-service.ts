/**
 * MarkSubmissionService — submits VLE grades to SRS via REST.
 *
 * This is the outbound direction of F016: VLE assessment data flows to SRS,
 * not the other way around.  The service is kept separate from the event
 * consumer because it is triggered by VLE-side events (grades available),
 * not by SRS events.
 *
 * Idempotency: a mark is only submitted once for a given
 * (tenantId, moduleRegistrationId, assessmentComponentId, sourceReference)
 * triple.  If a receipt already exists with a non-null markId, the previous
 * result is returned without a second SRS call.
 */

import type { VleDb } from '../db/client.js';
import type { SrsMarkClient, SrsMarkSubmitInput } from '../srs-client/mark-client.js';
import {
  getMarkReceipt,
  upsertMarkReceipt,
} from '../consumers/f016/mark-receipt-repository.js';

export interface MarkSubmitOptions {
  moduleRegistrationId:  string;
  assessmentComponentId: string;
  sourceReference:       string;
  rawMark:               number;
  attemptNumber?:        number;
  submittedAt?:          string;
}

export class MarkSubmissionService {
  constructor(
    private readonly db:           VleDb,
    private readonly tenantId:     string,
    private readonly srsMarkClient: SrsMarkClient,
  ) {}

  async submitMark(opts: MarkSubmitOptions): Promise<{ markId: string }> {
    const {
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark,
      attemptNumber,
      submittedAt,
    } = opts;

    // Idempotency check — return existing receipt if already submitted.
    const existing = await getMarkReceipt(
      this.db,
      this.tenantId,
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
    );
    if (existing?.markId) {
      return { markId: existing.markId };
    }

    // Submit to SRS.
    const input: SrsMarkSubmitInput = {
      assessmentComponentId,
      rawMark,
      sourceSystem:    'vle',
      sourceReference,
      ...(attemptNumber !== undefined ? { attemptNumber } : {}),
      ...(submittedAt   !== undefined ? { submittedAt   } : {}),
    };
    const { markId } = await this.srsMarkClient.submitMark(moduleRegistrationId, input);

    // Store receipt.
    await upsertMarkReceipt(this.db, this.tenantId, {
      moduleRegistrationId,
      assessmentComponentId,
      sourceReference,
      rawMark,
      markId,
    });

    return { markId };
  }
}
