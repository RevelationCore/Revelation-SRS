import { useCallback, useEffect, useState } from 'react';
import {
  type UcasApplication,
  generateUcasConfirmations,
  listUcasApplications,
} from '../api/regulatory.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Button, Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

export function UcasPage() {
  const [applications, setApplications] = useState<UcasApplication[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState('');
  const [generating,   setGenerating]   = useState(false);
  const [successMsg,   setSuccessMsg]   = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setApplications(await listUcasApplications());
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load applications');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleGenerateConfirmations() {
    setGenerating(true);
    setError('');
    setSuccessMsg('');
    try {
      await generateUcasConfirmations();
      setSuccessMsg('Confirmations generated and queued for transmission.');
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to generate confirmations');
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="UCAS applications"
        actions={
          <Button onClick={() => void handleGenerateConfirmations()} disabled={generating}>
            {generating ? 'Generating…' : 'Generate confirmations'}
          </Button>
        }
      />

      {error      && <p className="mb-4 text-sm text-danger-600">{error}</p>}
      {successMsg && <p className="mb-4 text-sm text-success-600">{successMsg}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : applications.length === 0 ? (
        <p className="py-8 text-center text-sm text-neutral-600">No UCAS applications on record.</p>
      ) : (
        <Card>
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>UCAS personal ID</TableHeaderCell>
                <TableHeaderCell>Cycle</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Received</TableHeaderCell>
                <TableHeaderCell>Linked enrolment</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {applications.map(a => (
                <TableRow key={a.applicationId}>
                  <TableCell className="font-mono text-xs text-neutral-700">{a.ucasPersonalId}</TableCell>
                  <TableCell>{a.cycle}</TableCell>
                  <TableCell><Badge value={a.statusCode} /></TableCell>
                  <TableCell className="text-xs">
                    {new Date(a.receivedAt).toLocaleDateString('en-GB')}
                  </TableCell>
                  <TableCell className="font-mono text-xs text-neutral-500">
                    {a.linkedEnrolmentId ?? <span className="text-neutral-600">—</span>}
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
