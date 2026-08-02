import { useCallback, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext.js';
import { useApiData } from '../hooks/useApiData.js';
import { useFormSubmit } from '../hooks/useFormSubmit.js';
import {
  getAcademicPeriods,
  getEnrolments,
  getModuleOfferings,
  getModuleSelectionProposals,
  getProgramme,
  postModuleSelectionProposal,
  postProposalItem,
  postProposalSubmission,
  deleteProposalItem,
  type ModuleSelectionProposal,
} from '../api/me.js';
import {
  Spinner, Problem, EmptyState, PageHeader, Button, Badge, Select,
  Card, Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
} from '@revelation-srs/ui';

const EDITABLE_STATUSES = ['draft', 'returned'];

export function ModuleSelectionPage() {
  const { t }    = useTranslation();
  const { personId } = useAuth();

  const [refreshKey, setRefreshKey] = useState(0);
  const [selectedPeriodId, setSelectedPeriodId] = useState<string>('');
  const [addingModuleId, setAddingModuleId] = useState<string>('');

  const fetchEnrolments = useCallback(
    () => personId ? getEnrolments(personId) : Promise.reject(new Error('')),
    [personId],
  );
  const { data: enrolments, loading: eLoading, error: eError } = useApiData(personId ? fetchEnrolments : null);
  const currentEnrolment = enrolments?.find(e => e.statusCode === 'enrolled') ?? enrolments?.[0] ?? null;

  const fetchProgramme = useCallback(
    () => currentEnrolment?.programmeId ? getProgramme(currentEnrolment.programmeId) : Promise.reject(new Error('')),
    [currentEnrolment?.programmeId],
  );
  const { data: programme } = useApiData(currentEnrolment?.programmeId ? fetchProgramme : null);

  const fetchPeriods = useCallback(() => getAcademicPeriods(), []);
  const { data: periods, loading: pLoading, error: pError } = useApiData(fetchPeriods);

  const fetchProposals = useCallback(
    () => currentEnrolment ? getModuleSelectionProposals(currentEnrolment.enrolmentId) : Promise.reject(new Error('')),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [currentEnrolment?.enrolmentId, refreshKey],
  );
  const { data: proposals, loading: propLoading, error: propError } = useApiData(
    currentEnrolment ? fetchProposals : null,
  );

  // The most recently started proposal — editable ones take priority for display.
  const activeProposal: ModuleSelectionProposal | null = useMemo(() => {
    if (!proposals || proposals.length === 0) return null;
    const editable = proposals.find(p => EDITABLE_STATUSES.includes(p.statusCode));
    return editable ?? proposals[proposals.length - 1] ?? null;
  }, [proposals]);

  const periodForOfferings = activeProposal?.academicPeriodId ?? selectedPeriodId;
  const fetchOfferings = useCallback(
    () => getModuleOfferings({ academicPeriodId: periodForOfferings || undefined }),
    [periodForOfferings],
  );
  const { data: offerings, loading: oLoading } = useApiData(periodForOfferings ? fetchOfferings : null);

  const { submitting, submitError, submit } = useFormSubmit<unknown>();

  const handleStart = async () => {
    if (!currentEnrolment || !selectedPeriodId) return;
    await submit(() => postModuleSelectionProposal({
      enrolmentId: currentEnrolment.enrolmentId,
      academicPeriodId: selectedPeriodId,
      fheqLevel: programme?.fheqLevel ?? 4,
    }));
    setRefreshKey(k => k + 1);
  };

  const handleAddItem = async () => {
    if (!activeProposal || !addingModuleId) return;
    const offering = offerings?.find(o => o.moduleId === addingModuleId);
    await submit(() => postProposalItem(activeProposal.moduleSelectionProposalId, {
      moduleId: addingModuleId,
      ...(offering ? { moduleOfferingId: offering.moduleOfferingId } : {}),
    }));
    setAddingModuleId('');
    setRefreshKey(k => k + 1);
  };

  const handleRemoveItem = async (proposalItemId: string) => {
    if (!activeProposal) return;
    await submit(() => deleteProposalItem(activeProposal.moduleSelectionProposalId, proposalItemId));
    setRefreshKey(k => k + 1);
  };

  const handleSubmitProposal = async () => {
    if (!activeProposal) return;
    await submit(() => postProposalSubmission(activeProposal.moduleSelectionProposalId));
    setRefreshKey(k => k + 1);
  };

  const loading = eLoading || pLoading || propLoading;
  const error   = eError ?? pError ?? propError;

  const alreadyChosenModuleIds = new Set(activeProposal?.items.map(i => i.moduleId) ?? []);
  const availableToAdd = (offerings ?? []).filter(o => !alreadyChosenModuleIds.has(o.moduleId));

  if (loading) {
    return <div className="flex justify-center py-16"><Spinner size="lg" label={t('status.loading')} /></div>;
  }

  return (
    <div>
      <PageHeader
        title={t('portal.moduleSelection.heading')}
        actions={
          <Link to="/modules">
            <Button variant="ghost" icon={<ArrowLeft className="h-4 w-4" />}>{t('portal.nav.modules')}</Button>
          </Link>
        }
      />

      {error       && <Problem title={t('status.error')} detail={error} />}
      {submitError && <Problem title={t('status.error')} detail={submitError} />}

      {!currentEnrolment && (
        <Problem title={t('portal.moduleSelection.noEnrolmentTitle')} detail={t('portal.moduleSelection.noEnrolmentDetail')} />
      )}

      {currentEnrolment && !activeProposal && (
        <Card>
          <div className="p-4 space-y-3">
            <p className="text-sm text-neutral-700">{t('portal.moduleSelection.startIntro')}</p>
            <div className="flex items-end gap-3">
              <div className="flex-1 max-w-xs">
                <label htmlFor="period-select" className="block text-xs text-neutral-500 mb-1">
                  {t('portal.modules.period')}
                </label>
                <Select id="period-select" value={selectedPeriodId} onChange={(e) => setSelectedPeriodId(e.target.value)}>
                  <option value="">{t('portal.moduleSelection.choosePeriod')}</option>
                  {(periods ?? []).map(p => (
                    <option key={p.academicPeriodId} value={p.academicPeriodId}>
                      {p.academicYear} — {p.periodCode}
                    </option>
                  ))}
                </Select>
              </div>
              <Button
                disabled={!selectedPeriodId || submitting}
                icon={submitting ? <Spinner size="sm" /> : undefined}
                onClick={handleStart}
              >
                {t('portal.moduleSelection.startButton')}
              </Button>
            </div>
          </div>
        </Card>
      )}

      {currentEnrolment && activeProposal && (
        <div className="space-y-6">
          <Card>
            <div className="p-4 flex items-center justify-between">
              <div>
                <p className="text-sm text-neutral-500">{t('portal.moduleSelection.status')}</p>
                <Badge
                  value={activeProposal.statusCode}
                  label={t(`portal.moduleSelection.statusLabel.${activeProposal.statusCode}`, { defaultValue: activeProposal.statusCode })}
                />
              </div>
              {activeProposal.decisionReason && (
                <p className="text-sm text-neutral-600 max-w-md text-right">{activeProposal.decisionReason}</p>
              )}
            </div>
          </Card>

          {activeProposal.items.length === 0 ? (
            <EmptyState title={t('portal.moduleSelection.noItems')} />
          ) : (
            <Card>
              <Table>
                <TableHead>
                  <tr>
                    <TableHeaderCell>Module</TableHeaderCell>
                    <TableHeaderCell>Credits</TableHeaderCell>
                    <TableHeaderCell>Source</TableHeaderCell>
                    <TableHeaderCell>Validation</TableHeaderCell>
                    <TableHeaderCell><span className="sr-only">Actions</span></TableHeaderCell>
                  </tr>
                </TableHead>
                <TableBody>
                  {activeProposal.items.map(item => (
                    <TableRow key={item.proposalItemId}>
                      <TableCell className="text-neutral-800">
                        <span className="font-mono text-xs text-neutral-500 mr-1">{item.moduleCode}</span>
                        <span className="font-medium">{item.moduleTitle}</span>
                      </TableCell>
                      <TableCell>{item.creditValue ?? '—'}</TableCell>
                      <TableCell>
                        {item.sourceCode === 'compulsory-auto'
                          ? t('portal.moduleSelection.sourceCompulsory')
                          : t('portal.moduleSelection.sourceChoice')}
                      </TableCell>
                      <TableCell>
                        {item.validationMessages.length === 0 ? (
                          <span className="text-neutral-400">—</span>
                        ) : (
                          <ul className="space-y-1">
                            {item.validationMessages.map((m, i) => (
                              <li
                                key={i}
                                className={m.severity === 'error' ? 'text-danger-600 text-xs' : 'text-warning-600 text-xs'}
                              >
                                {m.message}
                              </li>
                            ))}
                          </ul>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        {EDITABLE_STATUSES.includes(activeProposal.statusCode) && item.sourceCode !== 'compulsory-auto' && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-danger-600 hover:bg-danger-50"
                            disabled={submitting}
                            onClick={() => handleRemoveItem(item.proposalItemId)}
                          >
                            {t('actions.remove', { defaultValue: 'Remove' })}
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Card>
          )}

          {EDITABLE_STATUSES.includes(activeProposal.statusCode) && (
            <Card>
              <div className="p-4 space-y-3">
                <p className="text-sm font-medium text-neutral-700">{t('portal.moduleSelection.addModule')}</p>
                {oLoading ? (
                  <Spinner size="sm" />
                ) : availableToAdd.length === 0 ? (
                  <p className="text-sm text-neutral-500">{t('portal.modules.noOfferings')}</p>
                ) : (
                  <div className="flex items-end gap-3">
                    <div className="flex-1 max-w-md">
                      <Select value={addingModuleId} onChange={(e) => setAddingModuleId(e.target.value)}>
                        <option value="">{t('portal.moduleSelection.chooseModule')}</option>
                        {availableToAdd.map(o => (
                          <option key={o.moduleOfferingId} value={o.moduleId}>
                            {o.moduleCode} — {o.moduleTitle} ({o.creditValue ?? '?'} credits)
                          </option>
                        ))}
                      </Select>
                    </div>
                    <Button
                      variant="secondary"
                      disabled={!addingModuleId || submitting}
                      icon={submitting ? <Spinner size="sm" /> : undefined}
                      onClick={handleAddItem}
                    >
                      {t('actions.add', { defaultValue: 'Add' })}
                    </Button>
                  </div>
                )}

                <div className="pt-2">
                  <Button
                    disabled={activeProposal.items.length === 0 || submitting}
                    icon={submitting ? <Spinner size="sm" /> : undefined}
                    onClick={handleSubmitProposal}
                  >
                    {t('portal.moduleSelection.submitButton')}
                  </Button>
                </div>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}
