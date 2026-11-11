import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type WorkflowTask, listWorkflowTasks, completeWorkflowTask } from '../api/tasks.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Select,
} from '@revelation-srs/ui';

const STATUS_OPTIONS = ['', 'pending', 'in-progress', 'escalated', 'completed', 'cancelled'];
const ACTIONABLE_STATUSES = new Set(['pending', 'in-progress', 'escalated']);

export function TaskInboxPage() {
  const [tasks,      setTasks]      = useState<WorkflowTask[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [completing, setCompleting] = useState<string | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);
  const [noteByTask, setNoteByTask] = useState<Record<string, string>>({});

  const load = useCallback(async (status: string) => {
    setLoading(true);
    setError('');
    try {
      const data = await listWorkflowTasks(status ? { statusCode: status } : undefined);
      setTasks(data);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load tasks');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(statusFilter); }, [load, statusFilter]);

  async function handleComplete(taskId: string, decisionCode?: string) {
    setCompleting(taskId);
    try {
      await completeWorkflowTask(taskId, { decisionCode, note: noteByTask[taskId]?.trim() || undefined });
      setConfirmId(null);
      void load(statusFilter);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to complete task');
    } finally {
      setCompleting(null);
    }
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
              {STATUS_OPTIONS.map(s => (
                <option key={s} value={s}>{s || 'All'}</option>
              ))}
            </Select>
            <Button variant="secondary" onClick={() => void load(statusFilter)}>Refresh</Button>
          </div>
        }
      />

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

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
                  <TableCell className="font-medium text-neutral-900">{task.taskTypeCode}</TableCell>
                  <TableCell className="font-mono text-xs">{task.stepKey}</TableCell>
                  <TableCell>{task.assigneeRoleCode ?? '—'}</TableCell>
                  <TableCell className="text-neutral-500">
                    {task.dueAt ? new Date(task.dueAt).toLocaleDateString('en-GB') : '—'}
                  </TableCell>
                  <TableCell>
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${taskStatusColour(task.statusCode)}`}>
                      {task.statusCode}
                    </span>
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
    'in-progress': 'bg-primary-100 text-primary-700',
    escalated:   'bg-danger-100 text-danger-700',
    completed:   'bg-success-100 text-success-700',
    cancelled:   'bg-neutral-100 text-neutral-600',
    failed:      'bg-danger-100 text-danger-700',
  };
  return map[code] ?? 'bg-neutral-100 text-neutral-700';
}
