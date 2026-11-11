import { Client, Connection, WorkflowUpdateRPCTimeoutOrCancelledError } from '@temporalio/client';
import {
  signalReviewCommand,
  startReviewWorkflow,
  type ReviewCommandOutcome,
  type ReviewCommandRef,
  type ReviewWorkflowInput,
} from '@revelation-srs/workflow';
import { REVIEW_COMMAND_UPDATE } from '@revelation-srs/workflow';

import type { TemporalGateway } from './review-execution-service.js';

/**
 * TemporalGateway backed by the Temporal TypeScript SDK. Connects lazily, so
 * the API starts (and keeps serving records) when Temporal is down.
 */
export class SdkTemporalGateway implements TemporalGateway {
  #client: Client | null = null;
  #connecting: Promise<Client> | null = null;

  constructor(
    private readonly options: { address: string; namespace: string; taskQueue: string },
    client?: Client,
  ) {
    this.#client = client ?? null;
  }

  async startReview(workflowId: string, input: ReviewWorkflowInput): Promise<{ runId: string }> {
    return startReviewWorkflow(await this.#getClient(), { taskQueue: this.options.taskQueue, workflowId, input });
  }

  async submitCommand(workflowId: string, ref: ReviewCommandRef, waitMs: number): Promise<ReviewCommandOutcome> {
    const client = await this.#getClient();
    const handle = client.workflow.getHandle(workflowId);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), waitMs);
    try {
      return await client.withAbortSignal(controller.signal, () =>
        handle.executeUpdate<ReviewCommandOutcome, [ReviewCommandRef]>(REVIEW_COMMAND_UPDATE, { args: [ref] }));
    } catch (error) {
      if (error instanceof WorkflowUpdateRPCTimeoutOrCancelledError) {
        throw new Error(`No outcome within ${waitMs}ms`);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async signalCommand(workflowId: string, ref: ReviewCommandRef): Promise<void> {
    await signalReviewCommand(await this.#getClient(), workflowId, ref);
  }

  async close(): Promise<void> {
    await this.#client?.connection.close();
    this.#client = null;
  }

  async #getClient(): Promise<Client> {
    if (this.#client) return this.#client;
    this.#connecting ??= Connection.connect({ address: this.options.address, connectTimeout: '5 seconds' })
      .then((connection) => {
        this.#client = new Client({ connection, namespace: this.options.namespace });
        return this.#client;
      })
      .finally(() => { this.#connecting = null; });
    return this.#connecting;
  }
}
