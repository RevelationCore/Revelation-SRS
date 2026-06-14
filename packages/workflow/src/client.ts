import { Client, Connection, type WorkflowHandle } from '@temporalio/client';

import {
  completeTaskSignal,
  genericHumanTaskWorkflow,
  workflowStateQuery,
  type CompleteTaskSignalInput,
  type GenericHumanTaskWorkflowInput,
  type GenericHumanTaskWorkflowState,
} from './workflows/index.js';

export interface WorkflowClientOptions {
  temporalAddress: string;
  namespace: string;
  taskQueue: string;
}

export async function createWorkflowClient(options: WorkflowClientOptions): Promise<Client> {
  const connection = await Connection.connect({ address: options.temporalAddress });
  return new Client({ connection, namespace: options.namespace });
}

export async function startGenericHumanTaskWorkflow(
  client: Client,
  options: { taskQueue: string; workflowId: string; input: GenericHumanTaskWorkflowInput },
): Promise<WorkflowHandle<typeof genericHumanTaskWorkflow>> {
  return client.workflow.start(genericHumanTaskWorkflow, {
    taskQueue: options.taskQueue,
    workflowId: options.workflowId,
    args: [options.input],
  });
}

export async function signalTaskCompleted(
  handle: WorkflowHandle<typeof genericHumanTaskWorkflow>,
  input: CompleteTaskSignalInput,
): Promise<void> {
  await handle.signal(completeTaskSignal, input);
}

export async function queryGenericWorkflowState(
  handle: WorkflowHandle<typeof genericHumanTaskWorkflow>,
): Promise<GenericHumanTaskWorkflowState> {
  return handle.query(workflowStateQuery);
}
