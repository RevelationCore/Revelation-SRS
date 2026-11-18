import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import {
  PageHeader, Button, Card, Spinner, Problem, Badge, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell, formatDate, CodeLabel,
} from '@revelation-srs/ui';

import { downloadMyDocument, listMyDocuments } from '../api/me.js';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';

/**
 * The award documents issued to me (BP-06-004; D-4). Each has a verification
 * code an employer can use with the university. Downloads come later.
 */
export function DocumentsPage() {
  const { t } = useTranslation();
  const { personId } = useAuth();
  const fetch = useCallback(() => (personId ? listMyDocuments(personId) : Promise.reject(new Error(''))), [personId]);
  const { data, loading, error } = useApiData(personId ? fetch : null);

  return (
    <div>
      <PageHeader title={t('portal.nav.documents')} description="Documents issued for your award. Download your signed documents. Anyone you give a document to can check it online with its verification code, without an account." />
      <div className="mt-6">
        {loading ? <div className="flex justify-center py-16"><Spinner /></div>
          : error ? <Problem title="We could not load your documents" detail={error} />
            : !data || data.length === 0 ? <p className="text-sm text-neutral-600">No documents have been issued to you yet.</p>
              : (
                <Card>
                  <Table>
                    <TableHead><tr><TableHeaderCell>Document</TableHeaderCell><TableHeaderCell>Issued</TableHeaderCell><TableHeaderCell>Verification code</TableHeaderCell><TableHeaderCell>Status</TableHeaderCell><TableHeaderCell><span className="sr-only">Download</span></TableHeaderCell></tr></TableHead>
                    <TableBody>
                      {data.map((d) => (
                        <TableRow key={d.documentIssueId}>
                          <TableCell><CodeLabel entity="document_issue" field="document_type_code" code={d.documentTypeCode} />{d.issueNumber > 1 ? ` (issue ${d.issueNumber})` : ''}</TableCell>
                          <TableCell>{formatDate(d.issuedAt)}</TableCell>
                          <TableCell className="font-mono text-xs">{d.statusCode === 'issued' ? d.verificationCode : '—'}</TableCell>
                          <TableCell><Badge value={d.statusCode === 'issued' ? 'approved' : 'rejected'} label={d.statusCode === 'issued' ? 'Valid' : d.statusCode === 'superseded' ? 'Replaced' : 'Revoked'} /></TableCell>
                          <TableCell className="text-right">
                            {d.rendered && d.statusCode === 'issued' && (
                              <Button size="sm" variant="ghost" onClick={() => void downloadMyDocument(d.documentIssueId, `${d.documentTypeCode}-${d.issueNumber}.pdf`)}>
                                Download PDF<span className="sr-only"> of <CodeLabel entity="document_issue" field="document_type_code" code={d.documentTypeCode} /></span>
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
      </div>
    </div>
  );
}
