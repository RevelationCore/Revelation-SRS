import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type WorkflowTask, listWorkflowTasks, completeWorkflowTask } from '../api/tasks.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';

const STATUS_OPTIONS = ['', 'pending', 'in-progress', 'completed', 'cancelled'];

export function TaskInboxPage() {
  const [tasks,      setTasks]      = useState<WorkflowTask[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [statusFilter, setStatusFilter] = useState('pending');
  const [completing, setCompleting] = useState<string | null>(null);
  const [confirmId,  setConfirmId]  = useState<string | null>(null);

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

  async function handleComplete(taskId: string, e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setCompleting(taskId);
    try {
      await completeWorkflowTask(taskId);
      setConfirmId(null);
      void load(statusFilter);
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to complete task');
    } finally {
      setCompleting(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Task inbox</h1>
        <div className="flex items-center gap-3">
          <label className="text-sm text-gray-500">Status:</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="rounded border border-gray-300 px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
          >
            {STATUS_OPTIONS.map(s => (
              <option key={s} value={s}>{s || 'All'}</option>
            ))}
          </select>
          <button
            onClick={() => void load(statusFilter)}
            className="rounded border border-gray-300 px-3 py-1 text-sm text-gray-600 hover:bg-gray-50"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : tasks.length === 0 ? (
        <p className="text-sm text-gray-400 py-8 text-center">No tasks found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Step</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Role</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Due</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Status</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {tasks.map(task => (
                <tr key={task.workflowTaskId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900">{task.taskTypeCode}</td>
                  <td className="px-4 py-3 text-gray-600 font-mono text-xs">{task.stepKey}</td>
                  <td className="px-4 py-3 text-gray-600">{task.assigneeRoleCode ?? '—'}</td>
                  <td className="px-4 py-3 text-gray-500">
                    {task.dueAt ? new Date(task.dueAt).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${taskStatusColour(task.statusCode)}`}>
                      {task.statusCode}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/workflow/${task.workflowInstanceId}`}
                      className="text-xs text-indigo-600 hover:text-indigo-800 mr-3"
                    >
                      View workflow
                    </Link>
                    {task.statusCode === 'pending' || task.statusCode === 'in-progress' ? (
                      confirmId === task.workflowTaskId ? (
                        <form
                          onSubmit={(e) => void handleComplete(task.workflowTaskId, e)}
                          className="inline-flex items-center gap-2"
                        >
                          <span className="text-xs text-gray-600">Complete task?</span>
                          <button
                            type="submit"
                            disabled={completing === task.workflowTaskId}
                            className="rounded bg-green-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-green-700 disabled:opacity-50"
                          >
                            {completing === task.workflowTaskId ? 'Saving…' : 'Confirm'}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmId(null)}
                            className="text-xs text-gray-500 hover:text-gray-800"
                          >
                            Cancel
                          </button>
                        </form>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setConfirmId(task.workflowTaskId)}
                          className="rounded border border-green-300 px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50"
                        >
                          Complete
                        </button>
                      )
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function taskStatusColour(code: string): string {
  const map: Record<string, string> = {
    pending:     'bg-yellow-100 text-yellow-700',
    'in-progress': 'bg-blue-100 text-blue-700',
    completed:   'bg-green-100 text-green-700',
    cancelled:   'bg-gray-100 text-gray-600',
    failed:      'bg-red-100 text-red-700',
  };
  return map[code] ?? 'bg-gray-100 text-gray-700';
}
