import { callCoreAsService, type ServiceTokenSource } from '@revelation-srs/service-client';

export interface SrsMarkSubmitInput {
  assessmentComponentId: string;
  rawMark:               number;
  attemptNumber?:        number;
  sourceSystem?:         string;
  sourceReference?:      string;
  submittedAt?:          string;
}

export interface SrsMarkClient {
  submitMark(
    moduleRegistrationId: string,
    input:                SrsMarkSubmitInput,
  ): Promise<{ markId: string }>;
}

export class SrsMarkError extends Error {
  constructor(
    message:               string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'SrsMarkError';
  }
}

export class HttpSrsMarkClient implements SrsMarkClient {
  constructor(
    private readonly srsBaseUrl: string,
    private readonly tokens:     ServiceTokenSource,
    private readonly tenantId:   string,
  ) {}

  async submitMark(
    moduleRegistrationId: string,
    input:                SrsMarkSubmitInput,
  ): Promise<{ markId: string }> {
    const url = `${this.srsBaseUrl}/api/v1/module-registrations/${encodeURIComponent(moduleRegistrationId)}/marks`;
    // ADR-032: the connector may record only VLE marks, each with its submission reference.
    const res = await callCoreAsService(this.tokens, this.tenantId, url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceSystem: 'vle', ...input }),
    });

    if (res.status === 409) {
      // SRS already has a mark with this sourceReference — treat as idempotent success.
      const body = await res.json() as { markId?: string };
      if (body.markId) return { markId: body.markId };
      throw new SrsMarkError('SRS returned 409 without markId', 409);
    }

    if (!res.ok) {
      throw new SrsMarkError(
        `SRS mark submission failed (${res.status}): ${res.statusText}`,
        res.status,
      );
    }

    const body = await res.json() as { markId: string };
    return { markId: body.markId };
  }
}
