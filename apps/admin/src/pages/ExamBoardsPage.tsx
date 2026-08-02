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
import {
  PageHeader, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Button, Input, Select, Dialog, DialogClose, LabelledField,
} from '@revelation-srs/ui';

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
      <PageHeader title="Exam boards" actions={<Button onClick={() => setShowCreate(true)}>New board</Button>} />

      <form onSubmit={handleFilter} className="mb-4 flex items-center gap-3">
        <Input
          value={yearFilter}
          onChange={(e) => setYearFilter(e.target.value)}
          placeholder="Academic year (e.g. 2025/26)"
          className="min-w-52 w-auto"
        />
        <Button type="submit">Filter</Button>
        {yearFilter && (
          <Button type="button" variant="secondary" onClick={() => { setYearFilter(''); void load(); }}>
            Clear
          </Button>
        )}
      </form>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : boards.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">No exam boards found.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Type</TableHeaderCell>
                <TableHeaderCell>Year</TableHeaderCell>
                <TableHeaderCell>Meeting date</TableHeaderCell>
                <TableHeaderCell>Ratified</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {boards.map(b => (
                <TableRow key={b.examBoardId}>
                  <TableCell className="font-medium text-neutral-900 capitalize">{b.boardTypeCode}</TableCell>
                  <TableCell>{b.academicYear}</TableCell>
                  <TableCell>
                    {b.meetingDate
                      ? new Date(b.meetingDate).toLocaleDateString('en-GB')
                      : <span className="text-neutral-600">—</span>}
                  </TableCell>
                  <TableCell>
                    {b.ratifiedAt
                      ? <Badge value="ratified" />
                      : <Badge value="pending" />}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to={`/exam-boards/${b.examBoardId}`}
                      className="text-sm text-primary-600 hover:text-primary-800"
                    >
                      Open →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}

      <Dialog open={showCreate} onOpenChange={(open) => { if (!open) setShowCreate(false); }} title="New exam board">
        <CreateBoardForm
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
          boardTypes={boardTypes}
        />
      </Dialog>
    </div>
  );
}

function CreateBoardForm({
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
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <LabelledField label="Board type" htmlFor="new-board-type" required>
        <Select id="new-board-type" name="boardTypeCode">
          {boardTypes.map(({ code, displayLabel }) => <option key={code} value={code}>{displayLabel}</option>)}
        </Select>
      </LabelledField>
      <LabelledField label="Academic year (e.g. 2025/26)" htmlFor="new-board-year" required>
        <Input id="new-board-year" name="academicYear" />
      </LabelledField>
      <LabelledField label="Academic period ID" htmlFor="new-board-period" hint="Optional">
        <Input id="new-board-period" name="academicPeriodId" />
      </LabelledField>
      <LabelledField label="Meeting date" htmlFor="new-board-date" hint="Optional">
        <Input id="new-board-date" name="meetingDate" type="date" />
      </LabelledField>

      {error && <p className="text-sm text-danger-600">{error}</p>}

      <div className="flex justify-end gap-3 pt-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </DialogClose>
        <Button type="submit" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create'}
        </Button>
      </div>
    </form>
  );
}
