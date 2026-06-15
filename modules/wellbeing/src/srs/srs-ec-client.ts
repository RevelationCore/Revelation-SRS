/**
 * SRS EC handoff client — wraps the F066 POST endpoint.
 *
 * POST /api/v1/students/:personId/exceptional-circumstances
 * Body: { enrolmentId, moduleOfferingId?, outcomeCode, determinationDate, notes? }
 * Headers: { X-Idempotency-Key }
 * Returns: 201 { exceptionalCircumstancesId }
 *
 * Only upheld and partially_upheld determinations produce a handoff call.
 * The idempotencyKey is committed to the outbox table before the first HTTP
 * attempt so retry loops cannot create duplicate SRS EC records.
 */

export interface SubmitEcInput {
  idempotencyKey:    string;
  personId:          string;
  enrolmentId:       string;
  moduleOfferingId?: string;
  outcomeCode:       string;
  determinationDate: string;  // ISO date (YYYY-MM-DD)
  notes?:            string;
}

export interface SubmitEcResult {
  exceptionalCircumstancesId: string;
}

export interface SrsEcClient {
  submitEc(input: SubmitEcInput): Promise<SubmitEcResult>;
}

// ── HTTP implementation ───────────────────────────────────────────────────────

export class SrsEcHttpClient implements SrsEcClient {
  constructor(
    private readonly srsApiUrl: string,
    private readonly authToken: string,
  ) {}

  async submitEc(input: SubmitEcInput): Promise<SubmitEcResult> {
    const url  = `${this.srsApiUrl}/api/v1/students/${input.personId}/exceptional-circumstances`;
    const body: Record<string, unknown> = {
      enrolmentId:       input.enrolmentId,
      outcomeCode:       input.outcomeCode,
      determinationDate: input.determinationDate,
    };
    if (input.moduleOfferingId !== undefined) body['moduleOfferingId'] = input.moduleOfferingId;
    if (input.notes            !== undefined) body['notes']            = input.notes;

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
      throw new Error(`SRS F066 EC handoff failed: ${res.status} ${res.statusText} — ${text}`);
    }

    const data = await res.json() as { exceptionalCircumstancesId: string };
    return { exceptionalCircumstancesId: data.exceptionalCircumstancesId };
  }
}

// ── Stub for development and tests ────────────────────────────────────────────

export class SrsEcStubClient implements SrsEcClient {
  readonly submissions: SubmitEcInput[] = [];

  async submitEc(input: SubmitEcInput): Promise<SubmitEcResult> {
    this.submissions.push(input);
    return { exceptionalCircumstancesId: `stub-ec-${input.idempotencyKey}` };
  }
}
