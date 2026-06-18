export interface SrsAcknowledgementClient {
  acknowledgeDistribution(adjustmentId: string, distributionId: string): Promise<void>;
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
    const url = `${this.srsBaseUrl}/api/v1/adjustments/${encodeURIComponent(adjustmentId)}/distributions/${encodeURIComponent(distributionId)}/acknowledge`;
    const res = await fetch(url, {
      method:  'POST',
      headers: {
        'Authorization': `Bearer ${this.bearerToken}`,
        'Content-Type':  'application/json',
      },
      body: JSON.stringify({ targetSystem: 'vle' }),
    });

    // 404/409 = already acknowledged or distribution not found — treat as idempotent success.
    if (!res.ok && res.status !== 404 && res.status !== 409) {
      throw new SrsAcknowledgementError(
        `SRS acknowledge failed (${res.status}): ${res.statusText}`,
        res.status,
      );
    }
  }
}
