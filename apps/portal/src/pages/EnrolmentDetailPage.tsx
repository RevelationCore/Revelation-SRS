import { useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import {
  getEnrolment,
  getEnrolmentHistory,
  getEnrolmentTransitions,
  getEnrolmentFeeLiabilities,
  getFieldValueSet,
  type ValueSetDto,
} from '../api/me.js';
import { Spinner, Problem, formatDate, PageHeader, Card, CardHeader, CardBody, Badge, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell } from '@revelation-srs/ui';

function codeLabel(vs: ValueSetDto | null | undefined, code: string | null | undefined): string | null | undefined {
  if (!code) return code;
  if (!vs)   return code;
  return vs.members.find(m => m.code === code)?.displayLabel ?? code;
}

export function EnrolmentDetailPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();
  const { enrolmentId } = useParams<{ enrolmentId: string }>();

  const fetchEnrolment   = useCallback(
    () => (personId && enrolmentId) ? getEnrolment(personId, enrolmentId) : Promise.reject(new Error('')),
    [personId, enrolmentId],
  );
  const fetchHistory     = useCallback(
    () => (personId && enrolmentId) ? getEnrolmentHistory(personId, enrolmentId) : Promise.reject(new Error('')),
    [personId, enrolmentId],
  );
  const fetchTransitions = useCallback(
    () => (personId && enrolmentId) ? getEnrolmentTransitions(personId, enrolmentId) : Promise.reject(new Error('')),
    [personId, enrolmentId],
  );
  const fetchFees        = useCallback(
    () => (personId && enrolmentId) ? getEnrolmentFeeLiabilities(personId, enrolmentId) : Promise.reject(new Error('')),
    [personId, enrolmentId],
  );
  const fetchModeVS    = useCallback(() => getFieldValueSet('enrolment', 'mode_of_study_code').catch(() => undefined), []);
  const fetchFeeVS     = useCallback(() => getFieldValueSet('enrolment', 'fee_band_code').catch(() => undefined), []);
  const fetchFundingVS = useCallback(() => getFieldValueSet('enrolment', 'funding_source_code').catch(() => undefined), []);

  const ready = Boolean(personId && enrolmentId);
  const { data: enrolment,   loading: eLoading, error: eError } = useApiData(ready ? fetchEnrolment   : null);
  const { data: history                                       } = useApiData(ready ? fetchHistory     : null);
  const { data: transitions                                   } = useApiData(ready ? fetchTransitions : null);
  const { data: fees                                           } = useApiData(ready ? fetchFees        : null);
  const { data: modeVS    } = useApiData(fetchModeVS);
  const { data: feeVS     } = useApiData(fetchFeeVS);
  const { data: fundingVS } = useApiData(fetchFundingVS);

  if (eLoading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }
  if (eError || !enrolment) {
    return <Problem title={t('status.error')} detail={eError ?? 'Enrolment not found'} />;
  }

  return (
    <div>
      <PageHeader
        title={enrolment.programmeName ?? enrolment.programmeCode ?? 'Enrolment'}
        description={`Academic year ${enrolment.academicYearOfEntry}`}
        actions={<Badge value={enrolment.statusCode} label={t(`portal.enrolment.status.${enrolment.statusCode}`, { defaultValue: enrolment.statusCode })} />}
      />

      <div className="space-y-6">
        <Card>
          <CardHeader title="Enrolment details" />
          <CardBody>
            <dl className="grid gap-4 sm:grid-cols-3 text-sm">
              <DetailItem label="Mode of study" value={codeLabel(modeVS, enrolment.modeOfStudyCode)} />
              <DetailItem label="Fee status" value={codeLabel(feeVS, enrolment.feeBandCode)} />
              <DetailItem label="Funding source" value={codeLabel(fundingVS, enrolment.fundingSourceCode)} />
              <DetailItem label="Attendance" value={enrolment.attendanceTypeCode} />
              <DetailItem label="Start date" value={formatDate(enrolment.startDate)} />
              <DetailItem label="Expected end date" value={formatDate(enrolment.expectedEndDate)} />
              <DetailItem label="Actual end date" value={formatDate(enrolment.actualEndDate)} />
            </dl>
          </CardBody>
        </Card>

        {transitions && transitions.length > 0 && (
          <Card>
            <CardHeader title="Status history" />
            <CardBody>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>From</TableHeaderCell>
                    <TableHeaderCell>To</TableHeaderCell>
                    <TableHeaderCell>Effective</TableHeaderCell>
                    <TableHeaderCell>Reason</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {transitions.map(tr => (
                    <TableRow key={tr.transitionId}>
                      <TableCell><Badge value={tr.fromStatusCode} /></TableCell>
                      <TableCell><Badge value={tr.toStatusCode} /></TableCell>
                      <TableCell>{formatDate(tr.effectiveAt)}</TableCell>
                      <TableCell className="text-neutral-500">{tr.reasonText ?? tr.reasonCode ?? '—'}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        )}

        {fees && fees.length > 0 && (
          <Card>
            <CardHeader title="Fee liability" />
            <CardBody>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Academic year</TableHeaderCell>
                    <TableHeaderCell>Fee band</TableHeaderCell>
                    <TableHeaderCell>Funding source</TableHeaderCell>
                    <TableHeaderCell>Status</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {fees.map(f => (
                    <TableRow key={f.feeLiabilityId}>
                      <TableCell>{f.academicYear}</TableCell>
                      <TableCell>{codeLabel(feeVS, f.feeBandCode) ?? '—'}</TableCell>
                      <TableCell>{codeLabel(fundingVS, f.fundingSourceCode) ?? '—'}</TableCell>
                      <TableCell><Badge value={f.statusCode} /></TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        )}

        {history && history.length > 1 && (
          <Card>
            <CardHeader title="Record history" />
            <CardBody>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Status</TableHeaderCell>
                    <TableHeaderCell>Valid from</TableHeaderCell>
                    <TableHeaderCell>Valid to</TableHeaderCell>
                    <TableHeaderCell>Recorded</TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {history.map((h, i) => (
                    <TableRow key={i}>
                      <TableCell><Badge value={h.statusCode} /></TableCell>
                      <TableCell>{formatDate(h.validFrom)}</TableCell>
                      <TableCell>{h.validTo ? formatDate(h.validTo) : 'Current'}</TableCell>
                      <TableCell>{formatDate(h.recordedAt)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}

function DetailItem({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <div>
      <dt className="text-xs font-medium text-neutral-500">{label}</dt>
      <dd className="mt-0.5 text-neutral-900">{value ?? '—'}</dd>
    </div>
  );
}
