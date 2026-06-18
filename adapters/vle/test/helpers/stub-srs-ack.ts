import Fastify, { type FastifyInstance } from 'fastify';

export interface SrsAckCall {
  adjustmentId:   string;
  distributionId: string;
  targetSystem:   string;
}

/**
 * Minimal in-process stub for the SRS adjustment acknowledgement endpoint.
 * Records all acknowledge calls so tests can assert what the connector sent.
 */
export class StubSrsAckServer {
  private readonly calls: SrsAckCall[] = [];
  private readonly app:   FastifyInstance;

  constructor() {
    this.app = Fastify({ logger: false });

    this.app.post<{
      Params: { adjustmentId: string; distributionId: string };
      Body:   { targetSystem: string };
    }>(
      '/api/v1/adjustments/:adjustmentId/distributions/:distributionId/acknowledge',
      async (request, reply) => {
        this.calls.push({
          adjustmentId:   request.params.adjustmentId,
          distributionId: request.params.distributionId,
          targetSystem:   request.body.targetSystem,
        });
        return reply.code(204).send();
      },
    );
  }

  async start(): Promise<string> {
    await this.app.listen({ port: 0, host: '127.0.0.1' });
    const { port } = this.app.server.address() as { port: number };
    return `http://127.0.0.1:${port}`;
  }

  async stop(): Promise<void> {
    await this.app.close();
  }

  getAckCalls(): SrsAckCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls.length = 0;
  }
}
