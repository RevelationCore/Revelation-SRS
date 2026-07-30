/**
 * SRS engagement-outcome handoff client.
 *
 * POST /api/v1/students/:personId/engagement-outcomes
 * Body: { enrolmentId, moduleRegistrationId?, outcomeCode, severityCode?, effectiveFrom, sourceAlertId? }
 * Headers: { X-Idempotency-Key }
 * Returns: 201 { engagementOutcomeId }
 *
 * Mirrors the F-WELL-SIS-01 adjustment-handoff pattern: the attendance module owns the
 * engagement case (evidence, policy evaluation, alerting, intervention
 * casework); core SRS is the system of record for the recorded operational
 * outcome and is solely responsible for publishing
 * srs.engagement.outcome-recorded to downstream consumers.
 */

export interface SubmitEngagementOutcomeInput {
  idempotencyKey:        string;
  personId:              string;
  enrolmentId:           string;
  moduleRegistrationId?: string;
  outcomeCode:           string;
  severityCode?:         string;
  effectiveFrom:         string;
  sourceAlertId?:        string;
  /**
   * Populated only when outcomeCode is 'referred-sponsor-compliance' — core
   * has no local join to this module's alert/case tables, so the evidence
   * needed for the UKVI sponsor-compliance evidence snapshot travels with
   * the handoff itself (apps/api/src/platform/regulatory/ukvi-service.ts
   * :createEngagementEvidenceSnapshot reads it back from core's own record).
   */
  policyVersionId?:      string;
  evidenceWindowFrom?:   string;
  evidenceWindowTo?:     string;
  evidenceSnapshot?:     Record<string, unknown>;
  evidenceHash?:         string;
  reevaluationRequired?: boolean;
}

export interface SubmitEngagementOutcomeResult {
  engagementOutcomeId: string;
}

export interface SrsEngagementOutcomeClient {
  submitOutcome(input: SubmitEngagementOutcomeInput): Promise<SubmitEngagementOutcomeResult>;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class SrsEngagementOutcomeHttpClient implements SrsEngagementOutcomeClient {
  constructor(
    private readonly srsApiUrl: string,
    private readonly authToken: string,
  ) {}

  async submitOutcome(input: SubmitEngagementOutcomeInput): Promise<SubmitEngagementOutcomeResult> {
    const url  = `${this.srsApiUrl}/api/v1/students/${input.personId}/engagement-outcomes`;
    const body = {
      enrolmentId: input.enrolmentId,
      ...(input.moduleRegistrationId !== undefined ? { moduleRegistrationId: input.moduleRegistrationId } : {}),
      outcomeCode: input.outcomeCode,
      ...(input.severityCode !== undefined ? { severityCode: input.severityCode } : {}),
      effectiveFrom: input.effectiveFrom,
      ...(input.sourceAlertId !== undefined ? { sourceAlertId: input.sourceAlertId } : {}),
      ...(input.policyVersionId !== undefined ? { policyVersionId: input.policyVersionId } : {}),
      ...(input.evidenceWindowFrom !== undefined ? { evidenceWindowFrom: input.evidenceWindowFrom } : {}),
      ...(input.evidenceWindowTo !== undefined ? { evidenceWindowTo: input.evidenceWindowTo } : {}),
      ...(input.evidenceSnapshot !== undefined ? { evidenceSnapshot: input.evidenceSnapshot } : {}),
      ...(input.evidenceHash !== undefined ? { evidenceHash: input.evidenceHash } : {}),
      ...(input.reevaluationRequired !== undefined ? { reevaluationRequired: input.reevaluationRequired } : {}),
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
      throw new Error(`SRS engagement-outcome handoff failed: ${res.status} ${res.statusText} — ${text}`);
    }

    const data = await res.json() as { engagementOutcomeId: string };
    return { engagementOutcomeId: data.engagementOutcomeId };
  }
}

// ── Stub for development and tests ────────────────────────────────────────────

export class SrsEngagementOutcomeStubClient implements SrsEngagementOutcomeClient {
  readonly submissions: SubmitEngagementOutcomeInput[] = [];

  // eslint-disable-next-line @typescript-eslint/require-await
  async submitOutcome(input: SubmitEngagementOutcomeInput): Promise<SubmitEngagementOutcomeResult> {
    this.submissions.push(input);
    return { engagementOutcomeId: `stub-outcome-${input.idempotencyKey}` };
  }
}
