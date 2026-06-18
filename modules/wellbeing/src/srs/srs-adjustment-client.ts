/**
 * SRS adjustment handoff client — wraps the F063 POST endpoint.
 *
 * POST /api/v1/students/:personId/adjustments
 * Body: { enrolmentId, adjustmentTypeCode, scopeCode, validFrom, validTo?, notes? }
 * Headers: { X-Idempotency-Key }
 * Returns: 201 { adjustmentId }
 *
 * The idempotencyKey is stored in the outbox BEFORE the first HTTP attempt.
 * SRS deduplicates on X-Idempotency-Key; even if the network call is
 * repeated during retry, SRS will return the same adjustmentId.
 */

export interface SubmitAdjustmentInput {
  idempotencyKey:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  validFrom:          string;
  validTo?:           string;
  notes?:             string;
}

export interface SubmitAdjustmentResult {
  adjustmentId: string;
}

export interface SrsAdjustmentClient {
  submitAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult>;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class SrsAdjustmentHttpClient implements SrsAdjustmentClient {
  constructor(
    private readonly srsApiUrl: string,
    private readonly authToken: string,
  ) {}

  async submitAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult> {
    const url  = `${this.srsApiUrl}/api/v1/students/${input.personId}/adjustments`;
    const body = {
      enrolmentId:        input.enrolmentId,
      adjustmentTypeCode: input.adjustmentTypeCode,
      scopeCode:          input.scopeCode,
      validFrom:          input.validFrom,
      ...(input.validTo !== undefined ? { validTo: input.validTo } : {}),
      ...(input.notes   !== undefined ? { notes:   input.notes }   : {}),
    };

    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'authorization':     `Bearer ${this.authToken}`,
        'x-idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`SRS F063 handoff failed: ${res.status} ${res.statusText} — ${text}`);
    }

    const data = await res.json() as { adjustmentId: string };
    return { adjustmentId: data.adjustmentId };
  }
}

// ── Stub for development and tests ────────────────────────────────────────────

export class SrsAdjustmentStubClient implements SrsAdjustmentClient {
  readonly submissions: SubmitAdjustmentInput[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async submitAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult> {
    this.submissions.push(input);
    return { adjustmentId: `stub-adj-${input.idempotencyKey}` };
  }
}
