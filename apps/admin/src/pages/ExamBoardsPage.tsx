import { type FormEvent, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  type ExamBoard,
  createExamBoard,
  listExamBoards,
} from '../api/examBoards.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import { useValueSet } from '../hooks/useValueSet.js';

export function ExamBoardsPage() {
  const { members: boardTypes } = useValueSet('exam_board', 'board_type_code');
  const [boards,     setBoards]     = useState<ExamBoard[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [yearFilter, setYearFilter] = useState('');
  const [showCreate, setShowCreate] = useState(false);

  const load = useCallback(async (year?: string) => {
    setLoading(true);
    setError('');
    try {
      setBoards(await listExamBoards(year ? { academicYear: year } : undefined));
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load exam boards');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  function handleFilter(e: FormEvent) {
    e.preventDefault();
    void load(yearFilter || undefined);
  }

  function handleCreated() {
    setShowCreate(false);
    void load(yearFilter || undefined);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h1 className="text-xl font-semibold text-gray-900">Exam boards</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700"
        >
          New board
        </button>
      </div>

      <form onSubmit={handleFilter} className="mb-4 flex items-center gap-3">
        <input
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          placeholder="Academic year (e.g. 2025/26)"
          className="min-w-52 rounded border border-gray-300 px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <button
          type="submit"
          className="rounded bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700"
        >
          Filter
        </button>
        {yearFilter && (
          <button
            type="button"
            onClick={() => { setYearFilter(''); void load(); }}
            className="rounded border border-gray-300 px-3 py-1.5 text-sm text-gray-600 hover:bg-gray-50"
          >
            Clear
          </button>
        )}
      </form>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : boards.length === 0 ? (
        <p className="py-8 text-center text-sm text-gray-400">No exam boards found.</p>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200 text-sm">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Type</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Year</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Meeting date</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Ratified</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {boards.map(b => (
                <tr key={b.examBoardId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-900 capitalize">{b.boardTypeCode}</td>
                  <td className="px-4 py-3 text-gray-600">{b.academicYear}</td>
                  <td className="px-4 py-3 text-gray-600">
                    {b.meetingDate
                      ? new Date(b.meetingDate).toLocaleDateString('en-GB')
                      : <span className="text-gray-400">—</span>}
                  </td>
                  <td className="px-4 py-3">
                    {b.ratifiedAt
                      ? <Badge value="ratified" />
                      : <Badge value="pending" />}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/exam-boards/${b.examBoardId}`}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      Open →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showCreate && (
        <CreateBoardModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          boardTypes={boardTypes}
        />
      )}
    </div>
  );
}

function CreateBoardModal({
  onClose,
  onCreated,
  boardTypes,
}: {
  onClose:    () => void;
  onCreated:  () => void;
  boardTypes: { code: string; displayLabel: string }[];
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const boardTypeCode    = String(fd.get('boardTypeCode') ?? '').trim();
    const academicYear     = String(fd.get('academicYear') ?? '').trim();
    const academicPeriodId = String(fd.get('academicPeriodId') ?? '').trim();
    const meetingDate      = String(fd.get('meetingDate') ?? '').trim();

    if (!boardTypeCode || !academicYear) {
      setError('Board type and academic year are required.');
      return;
    }

    setSubmitting(true);
    setError('');
    try {
      await createExamBoard({
        boardTypeCode,
        academicYear,
        ...(academicPeriodId ? { academicPeriodId } : {}),
        ...(meetingDate      ? { meetingDate }      : {}),
      });
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create board');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">New exam board</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Board type *</label>
            <select
              name="boardTypeCode"
              className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
            >
              {boardTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
            </select>
          </div>
          <FormField name="academicYear"     label="Academic year * (e.g. 2025/26)" />
          <FormField name="academicPeriodId" label="Academic period ID (optional)" />
          <FormField name="meetingDate"      label="Meeting date (optional)" type="date" />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="rounded bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function FormField({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        className="w-full rounded border border-gray-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
      />
    </div>
  );
}
