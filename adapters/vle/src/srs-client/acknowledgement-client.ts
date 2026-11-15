/**
 * The connector's replies to SRS adjustment distribution instructions.
 *
 *   acknowledgeDistribution  POST .../distributions/:id/acknowledge             applied
 *   reportFailure            POST .../distributions/:id/failure                 cannot apply (with reason)
 *   acknowledgeWithdrawal    POST .../distributions/:id/withdrawal/acknowledge  removed
 *
 * All three are idempotent on the SRS side.
 */
export interface SrsAcknowledgementClient {
  acknowledgeDistribution(adjustmentId: string, distributionId: string): Promise<void>;
  reportFailure(adjustmentId: string, distributionId: string, reason: string): Promise<void>;
  acknowledgeWithdrawal(adjustmentId: string, distributionId: string): Promise<void>;
}

export class SrsAcknowledgementError extends Error {
  constructor(
    message:               string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SrsAcknowledgementError';
  }
}

export class HttpSrsAcknowledgementClient implements SrsAcknowledgementClient {
  constructor(
    private readonly srsBaseUrl:  string,
    private readonly bearerToken: string,
  ) {}

  async acknowledgeDistribution(adjustmentId: string, distributionId: string): Promise<void> {
    // 404 = distribution unknown; 409 = it was superseded or its withdrawal
    // was requested (the adjustment ended) — nothing for this call to do, and
    // a withdrawal instruction follows where one is needed.
    await this.#post(adjustmentId, distributionId, 'acknowledge', { targetSystem: 'vle' }, [404, 409]);
  }

  async reportFailure(adjustmentId: string, distributionId: string, reason: string): Promise<void> {
    // 409 = already applied or ended; the failure no longer applies.
    await this.#post(adjustmentId, distributionId, 'failure', { targetSystem: 'vle', reason: reason.slice(0, 2000) }, [404, 409]);
  }

  async acknowledgeWithdrawal(adjustmentId: string, distributionId: string): Promise<void> {
    // 409 here means no withdrawal was requested, which would be a state
    // mismatch worth retrying and investigating — not tolerated.
    await this.#post(adjustmentId, distributionId, 'withdrawal/acknowledge', { targetSystem: 'vle' }, [404]);
  }

  async #post(
    adjustmentId:   string,
    distributionId: string,
    action:         string,
    body:           unknown,
    tolerated:      number[],
  ): Promise<void> {
    const url = `${this.srsBaseUrl}/api/v1/adjustments/${encodeURIComponent(adjustmentId)}/distributions/${encodeURIComponent(distributionId)}/${action}`;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok && !tolerated.includes(res.status)) {
      throw new SrsAcknowledgementError(
        `SRS ${action} failed (${res.status}): ${res.statusText}`,
        res.status,
      );
    }
  }
}
