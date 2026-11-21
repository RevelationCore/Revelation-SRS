/**
 * SRS adjustment handoff client — wraps the F-WELL-SIS-01 POST endpoint.
 *
 * POST /api/v1/students/:personId/adjustments
 * Body: { enrolmentId, adjustmentTypeCode, scopeCode, validFrom, validTo?, amount?, notes?, sourceCaseId? }
 * Headers: { X-Idempotency-Key }
 * Returns: 201 { adjustmentId }
 *
 * The idempotencyKey is stored in the outbox BEFORE the first HTTP attempt.
 * SRS deduplicates on X-Idempotency-Key; even if the network call is
 * repeated during retry, SRS will return the same adjustmentId.
 */

import { callCoreAsService, type ServiceTokenSource } from './service-token-provider.js';

export interface SubmitAdjustmentInput {
  /** The tenant the hand-off is for: picks that tenant's client (ADR-029). */
  tenantId:           string;
  idempotencyKey:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  validFrom:          string;
  validTo?:           string;
  notes?:             string;
  /** Structured amount, e.g. { value: 25, unitCode: 'percent-of-duration' }. */
  amount?:            { value: number; unitCode: string };
  /** This wellbeing module case's logical id — carried through so the
   * core-SRS `reasonable_adjustment` record it produces is traceable back
   * to the case that approved it (see packages/db's `source_case_id`
   * column). Opaque cross-service reference, not a foreign key. */
  sourceCaseId?:      string;
}

export interface SubmitAdjustmentResult {
  adjustmentId: string;
}

/**
 * The SRS refused the request (4xx other than 401/403/429): retrying the same
 * body cannot succeed. Distinct from transport errors and 5xx, which may.
 */
export class SrsHandoffRejectedError extends Error {
  constructor(
    public readonly status: number,
    public readonly detail: string,
  ) {
    super(`SRS F-WELL-SIS-01 handoff rejected: ${status} — ${detail}`);
    this.name = 'SrsHandoffRejectedError';
  }
}

export interface SrsAdjustmentClient {
  submitAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult>;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class SrsAdjustmentHttpClient implements SrsAdjustmentClient {
  constructor(
    private readonly srsApiUrl: string,
    private readonly tokens: ServiceTokenSource,
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
      ...(input.amount  !== undefined ? { amount:  input.amount }  : {}),
      ...(input.sourceCaseId !== undefined ? { sourceCaseId: input.sourceCaseId } : {}),
    };

    const res = await callCoreAsService(this.tokens, input.tenantId, url, {
      method:  'POST',
      headers: {
        'content-type':      'application/json',
        'x-idempotency-key': input.idempotencyKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status >= 400 && res.status < 500 && ![401, 403, 408, 429].includes(res.status)) {
        throw new SrsHandoffRejectedError(res.status, srsErrorDetail(text));
      }
      throw new Error(`SRS F-WELL-SIS-01 handoff failed: ${res.status} ${res.statusText} — ${text}`);
    }

    const data = await res.json() as { adjustmentId: string };
    return { adjustmentId: data.adjustmentId };
  }
}

/** The SRS returns RFC 7807 problem details; prefer `detail`, fall back to the raw body. */
function srsErrorDetail(body: string): string {
  try {
    const parsed = JSON.parse(body) as { detail?: unknown; title?: unknown };
    if (typeof parsed.detail === 'string') return parsed.detail;
    if (typeof parsed.title === 'string') return parsed.title;
  } catch {
    // not JSON
  }
  return body.slice(0, 500);
}

// ── Stub for development and tests ────────────────────────────────────────────

export class SrsAdjustmentStubClient implements SrsAdjustmentClient {
  readonly submissions: SubmitAdjustmentInput[] = [];
  /** SRS adjustment types the stub accepts, as the real SRS value set would. */
  acceptedTypeCodes: readonly string[] = ['extra-time', 'separate-room', 'deadline-extension', 'reader', 'scribe', 'rest-breaks'];
  /** SRS adjustment scopes the stub accepts (adjustment-scope-code). */
  acceptedScopeCodes: readonly string[] = ['all', 'exam', 'coursework', 'attendance'];

  // eslint-disable-next-line @typescript-eslint/require-await
  async submitAdjustment(input: SubmitAdjustmentInput): Promise<SubmitAdjustmentResult> {
    if (!this.acceptedTypeCodes.includes(input.adjustmentTypeCode)) {
      throw new SrsHandoffRejectedError(422, `Invalid value '${input.adjustmentTypeCode}' for reasonable_adjustment.adjustment_type_code`);
    }
    if (!this.acceptedScopeCodes.includes(input.scopeCode)) {
      throw new SrsHandoffRejectedError(422, `Invalid value '${input.scopeCode}' for reasonable_adjustment.scope_code`);
    }
    this.submissions.push(input);
    return { adjustmentId: `stub-adj-${input.idempotencyKey}` };
  }
}
