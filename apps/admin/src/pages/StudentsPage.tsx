import { type FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { type CreateStudentInput, type StudentSummary, createStudent, listStudents } from '../api/students.js';
import { Spinner } from '../components/Spinner.js';
import { ApiError } from '../api/client.js';
import {
  Dialog, DialogClose, PageHeader, Card, Table, TableHead, TableHeaderCell,
  TableBody, TableRow, TableCell, TableEmptyRow, Button, Input, Select,
} from '@revelation-srs/ui';
import { useValueSet } from '../hooks/useValueSet.js';
import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

const PAGE_SIZE = 20;

export function StudentsPage() {
  const { roles } = useAuth();
  const canCreateStudent = userHasAnyPermission(roles, ['student:write']);
  const [students, setStudents]   = useState<StudentSummary[]>([]);
  const [loading, setLoading]     = useState(true);
  const [offset, setOffset]       = useState(0);
  const [error, setError]         = useState('');
  const [showCreate, setShowCreate] = useState(false);
  const [search, setSearch]       = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { members: personStatuses } = useValueSet('person', 'person_status_code');

  async function load(off: number, q?: string, status?: string) {
    setLoading(true);
    setError('');
    try {
      const data = await listStudents(PAGE_SIZE, off, q, status);
      setStudents(data);
      setOffset(off);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load students');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(0); }, []);

  function handleCreated() {
    setShowCreate(false);
    void load(offset);
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    void load(0, search || undefined, statusFilter || undefined);
  }

  return (
    <div>
      <PageHeader
        title="Students"
        actions={canCreateStudent && (
          <Button onClick={() => setShowCreate(true)}>New student</Button>
        )}
      />

      {/* Search / filter bar */}
      <form onSubmit={handleSearch} className="mb-4 flex items-center gap-3 flex-wrap">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name or student number…"
          className="flex-1 min-w-48"
        />
        <Select
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-auto"
        >
          <option value="">All statuses</option>
          {personStatuses.map(({ code, displayLabel }) => (
            <option key={code} value={code}>{displayLabel}</option>
          ))}
        </Select>
        <Button type="submit">Search</Button>
        {(search || statusFilter) && (
          <Button
            type="button"
            variant="secondary"
            onClick={() => { setSearch(''); setStatusFilter(''); void load(0); }}
          >
            Clear
          </Button>
        )}
      </form>

      {error && <p className="mb-4 text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Student #</TableHeaderCell>
                <TableHeaderCell>Name</TableHeaderCell>
                <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {students.length === 0 && (
                <TableEmptyRow colSpan={3}>No students found.</TableEmptyRow>
              )}
              {students.map((s) => (
                <TableRow key={s.personId}>
                  <TableCell className="font-mono text-neutral-700">{s.studentNumber}</TableCell>
                  <TableCell className="text-neutral-900">
                    {s.legalFirstName} {s.legalFamilyName}
                  </TableCell>
                  <TableCell className="text-right">
                    <Link
                      to={`/students/${s.personId}`}
                      className="text-sm text-primary-600 hover:text-primary-800"
                    >
                      View →
                    </Link>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          <div className="px-4 py-3 bg-neutral-50 border-t border-neutral-200 flex items-center gap-3 text-sm text-neutral-600">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE), search || undefined, statusFilter || undefined)}
              disabled={offset === 0}
            >
              Previous
            </Button>
            {students.length > 0 && (
              <span>Showing {offset + 1}–{offset + students.length}</span>
            )}
            <Button
              variant="secondary"
              size="sm"
              onClick={() => void load(offset + PAGE_SIZE, search || undefined, statusFilter || undefined)}
              disabled={students.length < PAGE_SIZE}
            >
              Next
            </Button>
          </div>
        </Card>
      )}

      <Dialog
        open={canCreateStudent && showCreate}
        onOpenChange={(open) => { if (!open) setShowCreate(false); }}
        title="New student"
      >
        <CreateStudentForm
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      </Dialog>
    </div>
  );
}

function CreateStudentForm({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const input: CreateStudentInput = {
      legalFirstName:  String(fd.get('legalFirstName') ?? '').trim(),
      legalFamilyName: String(fd.get('legalFamilyName') ?? '').trim(),
    };
    const pref  = String(fd.get('preferredName') ?? '').trim();
    const email = String(fd.get('emailPersonal') ?? '').trim();
    if (pref)  input.preferredName  = pref;
    if (email) input.emailPersonal  = email;

    if (!input.legalFirstName || !input.legalFamilyName) {
      setError('First and family name are required.');
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      await createStudent(input);
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to create student');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
      <Field name="legalFirstName"  label="Legal first name *" />
      <Field name="legalFamilyName" label="Legal family name *" />
      <Field name="preferredName"   label="Preferred name" />
      <Field name="emailPersonal"   label="Personal email" type="email" />

      {error && <p className="text-sm text-danger-600" role="alert">{error}</p>}

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

function Field({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
  return (
    <div>
      <label className="block text-sm font-medium text-neutral-700 mb-1">{label}</label>
      <input
        name={name}
        type={type}
        className="w-full rounded border border-neutral-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary-500"
      />
    </div>
  );
}
