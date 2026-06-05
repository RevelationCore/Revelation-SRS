import { type FormEvent, useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { type CreateStudentInput, type StudentSummary, createStudent, listStudents } from '../api/students.js';
import { Spinner } from '../components/Spinner.js';
import { ApiError } from '../api/client.js';

const PAGE_SIZE = 20;

export function StudentsPage() {
  const [students, setStudents]   = useState<StudentSummary[]>([]);
  const [loading, setLoading]     = useState(true);
  const [offset, setOffset]       = useState(0);
  const [error, setError]         = useState('');
  const [showCreate, setShowCreate] = useState(false);

  async function load(off: number) {
    setLoading(true);
    setError('');
    try {
      const data = await listStudents(PAGE_SIZE, off);
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

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-xl font-semibold text-gray-900">Students</h1>
        <button
          onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700"
        >
          New student
        </button>
      </div>

      {error && <p className="mb-4 text-sm text-red-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Student #</th>
                <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Name</th>
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {students.length === 0 && (
                <tr>
                  <td colSpan={3} className="px-4 py-8 text-center text-sm text-gray-400">
                    No students found.
                  </td>
                </tr>
              )}
              {students.map((s) => (
                <tr key={s.personId} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-sm font-mono text-gray-700">{s.studentNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-900">
                    {s.legalFirstName} {s.legalFamilyName}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      to={`/students/${s.personId}`}
                      className="text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      View →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="px-4 py-3 bg-gray-50 border-t border-gray-200 flex items-center gap-3 text-sm text-gray-600">
            <button
              onClick={() => void load(Math.max(0, offset - PAGE_SIZE))}
              disabled={offset === 0}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-white"
            >
              Previous
            </button>
            {students.length > 0 && (
              <span>Showing {offset + 1}–{offset + students.length}</span>
            )}
            <button
              onClick={() => void load(offset + PAGE_SIZE)}
              disabled={students.length < PAGE_SIZE}
              className="px-3 py-1 rounded border border-gray-300 disabled:opacity-40 hover:bg-white"
            >
              Next
            </button>
          </div>
        </div>
      )}

      {showCreate && (
        <CreateStudentModal
          onClose={() => setShowCreate(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  );
}

function CreateStudentModal({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError]           = useState('');
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose]);

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
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50" onClick={onClose}>
      <div ref={dialogRef} className="bg-white rounded-lg border border-gray-200 p-6 w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <h2 className="text-base font-semibold text-gray-900 mb-4">New student</h2>
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4">
          <Field name="legalFirstName"  label="Legal first name *" />
          <Field name="legalFamilyName" label="Legal family name *" />
          <Field name="preferredName"   label="Preferred name" />
          <Field name="emailPersonal"   label="Personal email" type="email" />

          {error && <p className="text-sm text-red-600">{error}</p>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900">
              Cancel
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded hover:bg-indigo-700 disabled:opacity-50"
            >
              {submitting ? 'Creating…' : 'Create'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function Field({ name, label, type = 'text' }: { name: string; label: string; type?: string }) {
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
