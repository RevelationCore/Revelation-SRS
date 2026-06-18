import { randomUUID } from 'node:crypto';

import Fastify, { type FastifyInstance } from 'fastify';

export interface SrsMarkCall {
  moduleRegistrationId:  string;
  assessmentComponentId: string;
  rawMark:               number;
  sourceSystem:          string | undefined;
  sourceReference:       string | undefined;
  attemptNumber:         number | undefined;
  submittedAt:           string | undefined;
}

/**
 * Minimal in-process stub for the SRS mark submission endpoint.
 * Records all POST calls so tests can assert what the connector sent.
 * Each call returns a fresh markId.
 */
export class StubSrsMarksServer {
  private readonly calls: SrsMarkCall[] = [];
  private readonly app:   FastifyInstance;

  constructor() {
    this.app = Fastify({ logger: false });

    this.app.post<{
      Params: { moduleRegistrationId: string };
      Body: {
        assessmentComponentId: string;
        rawMark:               number;
        sourceSystem?:         string;
        sourceReference?:      string;
        attemptNumber?:        number;
        submittedAt?:          string;
      };
    }>(
      '/api/v1/module-registrations/:moduleRegistrationId/marks',
      async (request, reply) => {
        const { moduleRegistrationId } = request.params;
        const { assessmentComponentId, rawMark, sourceSystem, sourceReference, attemptNumber, submittedAt } = request.body;

        this.calls.push({
          moduleRegistrationId,
          assessmentComponentId,
          rawMark,
          sourceSystem,
          sourceReference,
          attemptNumber,
          submittedAt,
        });

        return reply.code(201).send({ markId: randomUUID() });
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

  getMarkCalls(): SrsMarkCall[] {
    return [...this.calls];
  }

  reset(): void {
    this.calls.length = 0;
  }
}
