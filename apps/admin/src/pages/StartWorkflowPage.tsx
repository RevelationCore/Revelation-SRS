import { type FormEvent, useCallback, useEffect, useState } from 'react';
import {
  type WorkflowDefinition,
  type WorkflowDefinitionVersion,
  listWorkflowDefinitions,
  listWorkflowDefinitionVersions,
  startWorkflowInstance,
  type StartedWorkflow,
} from '../api/workflowDefs.js';
import { ApiError } from '../api/client.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardBody, Button, Input, Select, Textarea, LabelledField, StatusNotice,
} from '@revelation-srs/ui';

interface PublishedGeneric {
  definition: WorkflowDefinition;
  version:    WorkflowDefinitionVersion;
}

export function StartWorkflowPage() {
  const [options,    setOptions]    = useState<PublishedGeneric[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [loadError,  setLoadError]  = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error,      setError]      = useState('');
  const [success,    setSuccess]    = useState<StartedWorkflow | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadError('');
    try {
      const defs = await listWorkflowDefinitions();
      const custom = defs.filter(d => d.ownerModuleCode === 'custom' && d.statusCode === 'active');
      const withVersions = await Promise.all(custom.map(async (definition) => {
        const versions = await listWorkflowDefinitionVersions(definition.workflowDefinitionId);
        const version = versions.find(v => v.versionNumber === definition.currentVersionNumber && v.statusCode === 'active');
        return version ? { definition, version } : null;
      }));
      setOptions(withVersions.filter((o): o is PublishedGeneric => o !== null));
    } catch (e) {
      setLoadError(e instanceof ApiError ? e.message : 'Failed to load workflows');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(''); setSuccess(null);
    const fd = new FormData(e.currentTarget);
    const workflowDefinitionId = String(fd.get('workflowDefinitionId') ?? '');
    const subjectEntityType    = String(fd.get('subjectEntityType')    ?? '').trim();
    const subjectEntityId      = String(fd.get('subjectEntityId')      ?? '').trim();
    const note                 = String(fd.get('note')                 ?? '').trim();

    const chosen = options.find(o => o.definition.workflowDefinitionId === workflowDefinitionId);
    if (!chosen || !subjectEntityType) {
      setError('Choose a workflow and describe what it applies to.');
      return;
    }
    const taskStep = chosen.version.steps.find(s => s.stepTypeCode === 'human-task');
    if (!taskStep) {
      setError('This workflow version has no reviewable step configured.');
      return;
    }
    const dueAfterHours = taskStep.configuration['dueAfterHours'] as number | null | undefined;
    const dueAt = dueAfterHours
      ? new Date(Date.now() + dueAfterHours * 60 * 60 * 1000).toISOString()
      : undefined;

    setSubmitting(true);
    try {
      const result = await startWorkflowInstance({
        workflowDefinitionVersionId: chosen.version.workflowDefinitionVersionId,
        workflowCode: chosen.definition.definitionCode,
        subjectEntityType,
        ...(subjectEntityId ? { subjectEntityId } : {}),
        task: {
          stepKey: taskStep.stepKey,
          ...(dueAt ? { dueAt } : {}),
          ...(note ? { payload: { note } } : {}),
        },
      });
      setSuccess(result);
      (e.target as HTMLFormElement).reset();
    } catch (err) {
      setError(err instanceof ApiError ? (err.detail ?? err.message) : 'Failed to start workflow');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="Start a workflow"
        description="Start a governed review against any record, using an admin-configured workflow."
      />

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : loadError ? (
        <p className="text-sm text-danger-600">{loadError}</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-neutral-600">
          No published workflows are available to start yet. Create and publish one from{' '}
          <strong>Workflows</strong> first.
        </p>
      ) : (
        <Card>
          <CardBody>
            {success && (
              <StatusNotice>
                Started. Workflow instance <span className="font-mono">{success.workflowInstanceId}</span>
                {success.workflowTaskId && (
                  <> — task <span className="font-mono">{success.workflowTaskId}</span> is now assigned.</>
                )}
                {success.executionStatus === 'starting' && (
                  <> The workflow service has not picked it up yet; it will start automatically. The task can already be seen in the Task Inbox.</>
                )}
              </StatusNotice>
            )}
            <form onSubmit={(e) => void handleSubmit(e)} className="space-y-3 max-w-xl">
              <LabelledField label="Workflow" htmlFor="sw-def" required>
                <Select id="sw-def" name="workflowDefinitionId" defaultValue="">
                  <option value="" disabled>Select a workflow…</option>
                  {options.map(({ definition }) => (
                    <option key={definition.workflowDefinitionId} value={definition.workflowDefinitionId}>
                      {definition.displayName}
                    </option>
                  ))}
                </Select>
              </LabelledField>
              <LabelledField
                label="Subject type"
                htmlFor="sw-subject-type"
                required
                hint="What kind of record this applies to, e.g. student, module-registration, exam-board"
              >
                <Input id="sw-subject-type" name="subjectEntityType" placeholder="student" />
              </LabelledField>
              <LabelledField
                label="Subject ID"
                htmlFor="sw-subject-id"
                hint="Optional — paste from the record's URL or detail page"
              >
                <Input id="sw-subject-id" name="subjectEntityId" />
              </LabelledField>
              <LabelledField label="Note" htmlFor="sw-note" hint="Optional — shown to the assignee">
                <Textarea id="sw-note" name="note" rows={3} />
              </LabelledField>
              {error && <p className="text-sm text-danger-600">{error}</p>}
              <Button type="submit" disabled={submitting}>{submitting ? 'Starting…' : 'Start workflow'}</Button>
            </form>
          </CardBody>
        </Card>
      )}
    </div>
  );
}
