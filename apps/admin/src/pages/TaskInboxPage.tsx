import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type WorkflowTask, listWorkflowTasks, completeWorkflowTask, getWorkflowCommand,
} from '../api/tasks.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, Button, Select, CodeLabel, useCodes,
} from '@revelation-srs/ui';

// 'open' is a client-side view of every status that still needs a decision.
const ACTIONABLE_STATUSES = new Set(['pending', 'assigned', 'in-progress', 'escalated']);

/** How long to keep checking a saved decision before telling the user it will finish later. */
const PENDING_POLL_MS = 2_000;
const PENDING_POLL_ATTEMPTS = 8;

export function TaskInboxPage() {
  const taskStatuses = useCodes('workflow_task', 'status_code');
  const [tasks,      setTasks]      = useState<WorkflowTask[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [notice,     setNotice]     = useState('');
  const [statusFilter, setStatusFilter] = useState('open');
  const [completing, setCompleting] = useState<string | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [noteByTask, setNoteByTask] = useState<Record<string, string>>({});

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await listWorkflowTasks(status && status !== 'open' ? { statusCode: status } : undefined);
      setTasks(status === 'open' ? data.filter((t) => ACTIONABLE_STATUSES.has(t.statusCode)) : data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  async function handleComplete(taskId: string, decisionCode?: string) {
    setCompleting(taskId);
    setNotice('');
    try {
      const receipt = await completeWorkflowTask(taskId, { decisionCode, note: noteByTask[taskId]?.trim() || undefined });
      setConfirmId(null);
      if (receipt?.status === 'pending') {
        // Saved, but the workflow service has not applied it yet. Retrying
        // would not make a second decision, but there is no need to.
        setNotice('Decision received. Applying it now…');
        void waitForDecision(receipt.commandId);
      }
      void load(statusFilter);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to complete task');
    } finally {
      setCompleting(null);
    }
  }

  async function waitForDecision(commandId: string) {
    for (let attempt = 0; attempt < PENDING_POLL_ATTEMPTS; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, PENDING_POLL_MS));
      try {
        const current = await getWorkflowCommand(commandId);
        if (current.status === 'applied') {
          setNotice('Decision applied.');
          void load(statusFilter);
          return;
        }
        if (current.status === 'failed' || current.status === 'superseded') {
          setNotice('');
          setError(current.errorDetail ?? 'The decision was recorded but could not be applied.');
          void load(statusFilter);
          return;
        }
      } catch {
        // Keep the saved-decision message; the decision is not lost.
      }
    }
    setNotice('Decision saved. It will be applied automatically when the workflow service is available — you do not need to decide again.');
  }

  function handlePlainComplete(taskId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    void handleComplete(taskId);
  }

  return (
    <div>
      <PageHeader
        title="Task inbox"
        actions={
          <div className="flex items-center gap-3">
            <label htmlFor="task-status-filter" className="text-sm text-neutral-500">Status:</label>
            <Select
              id="task-status-filter"
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-auto"
            >
              <option value="open">Open</option>
              <option value="">All</option>
              {taskStatuses.options.map((m) => <option key={m.code} value={m.code}>{m.displayLabel}</option>)}
            </Select>
            <Button variant="secondary" onClick={() => void load(statusFilter)}>Refresh</Button>
          </div>
        }
      />

      {error && <p role="alert" className="mb-4 text-sm text-danger-600">{error}</p>}
      <p role="status" aria-live="polite" className={notice ? 'mb-4 text-sm text-primary-700' : 'sr-only'}>{notice}</p>

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-neutral-600 py-8 text-center">No tasks found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Step</TableHeaderCell>
                <TableHeaderCell>Role</TableHeaderCell>
                <TableHeaderCell>Due</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {tasks.map(task => (
                <TableRow key={task.workflowTaskId}>
                  <TableCell className="font-medium text-neutral-900"><CodeLabel entity="workflow_task" field="task_type_code" code={task.taskTypeCode} /></TableCell>
                  <TableCell className="font-mono text-xs">{task.stepKey}</TableCell>
                  <TableCell><CodeLabel entity="workflow_task" field="assignee_role_code" code={task.assigneeRoleCode} /></TableCell>
                  <TableCell className="text-neutral-500">
                    {task.dueAt ? new Date(task.dueAt).toLocaleDateString('en-GB') : '—'}
                  </TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${taskStatusColour(task.statusCode)}`}>
                      {taskStatuses.label(task.statusCode)}
                    </span>
                    {task.attentionReasonCode && ACTIONABLE_STATUSES.has(task.statusCode) && (
                      <span
                        className="ml-2 rounded-full px-2.5 py-0.5 text-xs font-medium bg-danger-100 text-danger-700"
                        title="The deadline passed and no escalation role is configured"
                      >
                        Needs attention
                      </span>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to={`/workflow/${task.workflowInstanceId}`}
                      className="text-xs text-primary-600 hover:text-primary-800 mr-3"
                    >
                      View workflow
                    </Link>
                    {ACTIONABLE_STATUSES.has(task.statusCode) ? (
                      confirmId === task.workflowTaskId ? (
                        task.outcomeOptions?.length ? (
                          <div className="inline-flex flex-col items-end gap-2">
                            <input
                              type="text"
                              placeholder="Note (optional)"
                              className="rounded border border-neutral-300 px-2 py-1 text-xs w-56"
                              value={noteByTask[task.workflowTaskId] ?? ''}
                              onChange={(e) => setNoteByTask(v => ({ ...v, [task.workflowTaskId]: e.target.value }))}
                            />
                            <div className="flex gap-2">
                              {task.outcomeOptions.map(option => (
                                <Button
                                  key={option.code}
                                  type="button"
                                  size="sm"
                                  disabled={completing === task.workflowTaskId}
                                  className="bg-success-600 hover:bg-success-700"
                                  onClick={() => void handleComplete(task.workflowTaskId, option.code)}
                                >
                                  {completing === task.workflowTaskId ? 'Saving…' : option.label}
                                </Button>
                              ))}
                              <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                                Cancel
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <form
                            onSubmit={(e) => handlePlainComplete(task.workflowTaskId, e)}
                            className="inline-flex items-center gap-2"
                          >
                            <span className="text-xs text-neutral-600">Complete task?</span>
                            <Button
                              type="submit"
                              size="sm"
                              disabled={completing === task.workflowTaskId}
                              className="bg-success-600 hover:bg-success-700"
                            >
                              {completing === task.workflowTaskId ? 'Saving…' : 'Confirm'}
                            </Button>
                            <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                              Cancel
                            </Button>
                          </form>
                        )
                      ) : (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          className="border-success-300 text-success-700 hover:bg-success-50"
                          onClick={() => setConfirmId(task.workflowTaskId)}
                        >
                          {task.outcomeOptions?.length ? 'Decide' : 'Complete'}
                        </Button>
                      )
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}

function taskStatusColour(code: string): string {
  const map: Record<string, string> = {
    pending:     'bg-warning-100 text-warning-700',
    assigned:    'bg-warning-100 text-warning-700',
    'in-progress': 'bg-primary-100 text-primary-700',
    escalated:   'bg-danger-100 text-danger-700',
    completed:   'bg-success-100 text-success-700',
    cancelled:   'bg-neutral-100 text-neutral-600',
    failed:      'bg-danger-100 text-danger-700',
  };
  return map[code] ?? 'bg-neutral-100 text-neutral-700';
}
