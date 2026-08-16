import { type FormEvent, useEffect, useState } from 'react';
import {
  type EnvironmentRuntime,
  type DeploymentEnvironment,
  type EnvironmentPromotion,
  getEnvironmentRuntime,
  listEnvironments,
  listEnvironmentPromotions,
  createEnvironmentPromotion,
} from '../api/operations.js';
import { ApiError } from '../api/client.js';
import { Badge } from '../components/Badge.js';
import { Spinner } from '../components/Spinner.js';
import {
  PageHeader, Card, CardHeader, CardBody, Button, Select, LabelledField, Textarea,
  Table, TableHead, TableHeaderCell, TableBody, TableRow, TableCell,
  Tabs, TabsList, TabsTrigger, TabsContent,
} from '@revelation-srs/ui';

type Tab = 'runtime' | 'environments' | 'promotions';

export function EnvironmentRuntimePage() {
  const [tab, setTab] = useState<Tab>('runtime');

  return (
    <div>
      <PageHeader title="Environment runtime" />

      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          {(['runtime', 'environments', 'promotions'] as Tab[]).map(t => (
            <TabsTrigger key={t} value={t} className="capitalize">{t}</TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="runtime"><RuntimeTab /></TabsContent>
        <TabsContent value="environments"><EnvironmentsTab /></TabsContent>
        <TabsContent value="promotions"><PromotionsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function RuntimeTab() {
  const [data,    setData]    = useState<EnvironmentRuntime | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setData(await getEnvironmentRuntime());
      } catch (e) {
        setError(e instanceof ApiError ? e.message : 'Failed to load runtime');
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-sm text-danger-600">{error}</p>;
  if (!data)   return null;

  return (
    <div className="space-y-6">
      {/* Overview */}
      <Card>
        <CardHeader title="Current environment" />
        <CardBody>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 text-sm">
          <KV label="Environment" value={data.environment.displayName} />
          <KV label="Type" value={data.environment.environmentTypeCode} />
          <KV label="Release version" value={data.releaseVersion} mono />
          <KV label="Migration version" value={data.migrationVersion} mono />
          {data.imageDigest && (
            <KV label="Image digest" value={data.imageDigest.slice(0, 24) + '…'} mono />
          )}
          <KV
            label="Production-like"
            value={data.environment.productionLike ? 'Yes' : 'No'}
          />
          <KV
            label="Live integrations"
            value={data.environment.liveIntegrationsAllowed ? 'Allowed' : 'Disabled'}
          />
        </div>
        </CardBody>
      </Card>

      {/* Workflow definitions */}
      <Card className="overflow-hidden">
        <CardHeader title={`Workflow definitions (${data.workflowDefinitions.length})`} />
        {data.workflowDefinitions.length === 0 ? (
          <p className="px-5 py-4 text-sm text-neutral-600">No workflow definitions registered.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Definition code</TableHeaderCell>
                <TableHeaderCell>Current version</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {data.workflowDefinitions.map(w => (
                <TableRow key={w.definitionCode}>
                  <TableCell className="font-mono text-neutral-900">{w.definitionCode}</TableCell>
                  <TableCell>
                    {w.currentVersionNumber != null ? `v${w.currentVersionNumber}` : <span className="text-warning-600">none</span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      {/* Feature flags */}
      <Card className="overflow-hidden">
        <CardHeader title={`Feature flags (${data.featureFlags.length})`} />
        {data.featureFlags.length === 0 ? (
          <p className="px-5 py-4 text-sm text-neutral-600">No feature flags registered.</p>
        ) : (
          <Table>
            <TableHead>
              <tr>
                <TableHeaderCell>Flag key</TableHeaderCell>
                <TableHeaderCell>Status</TableHeaderCell>
                <TableHeaderCell>Default variant</TableHeaderCell>
              </tr>
            </TableHead>
            <TableBody>
              {data.featureFlags.map(f => (
                <TableRow key={f.flagKey}>
                  <TableCell className="font-mono text-neutral-900">{f.flagKey}</TableCell>
                  <TableCell><Badge value={f.statusCode} /></TableCell>
                  <TableCell className="font-mono">{f.defaultVariantKey}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function EnvironmentsTab() {
  const [envs,    setEnvs]    = useState<DeploymentEnvironment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState('');

  useEffect(() => {
    void listEnvironments()
      .then(setEnvs)
      .catch(e => setError(e instanceof ApiError ? e.message : 'Failed'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="flex justify-center py-16"><Spinner /></div>;
  if (error)   return <p className="text-sm text-danger-600">{error}</p>;

  return (
    <Card className="overflow-hidden">
      {envs.length === 0 ? (
        <p className="px-5 py-4 text-sm text-neutral-600">No environments registered.</p>
      ) : (
        <Table>
          <TableHead>
            <tr>
              <TableHeaderCell>Code</TableHeaderCell>
              <TableHeaderCell>Name</TableHeaderCell>
              <TableHeaderCell>Type</TableHeaderCell>
              <TableHeaderCell>Prod-like</TableHeaderCell>
              <TableHeaderCell>Live integrations</TableHeaderCell>
              <TableHeaderCell>Active</TableHeaderCell>
            </tr>
          </TableHead>
          <TableBody>
            {envs.map(env => (
              <TableRow key={env.deploymentEnvironmentId}>
                <TableCell className="font-mono text-neutral-900">{env.environmentCode}</TableCell>
                <TableCell className="font-medium text-neutral-900">{env.displayName}</TableCell>
                <TableCell>{env.environmentTypeCode}</TableCell>
                <TableCell><Badge value={env.productionLike ? 'yes' : 'no'} /></TableCell>
                <TableCell><Badge value={env.liveIntegrationsAllowed ? 'allowed' : 'disabled'} /></TableCell>
                <TableCell><Badge value={env.active ? 'active' : 'inactive'} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  );
}

function PromotionsTab() {
  const [promotions, setPromotions] = useState<EnvironmentPromotion[]>([]);
  const [envs,       setEnvs]       = useState<DeploymentEnvironment[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState('');
  const [showForm,   setShowForm]   = useState(false);

  async function load() {
    setLoading(true);
    try {
      const [p, e] = await Promise.all([listEnvironmentPromotions(), listEnvironments()]);
      setPromotions(p); setEnvs(e);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setShowForm(true)}>Create promotion</Button>
      </div>

      {showForm && (
        <CreatePromotionForm
          envs={envs}
          onCreated={() => { setShowForm(false); void load(); }}
          onCancel={() => setShowForm(false)}
        />
      )}

      {error && <p className="text-sm text-danger-600">{error}</p>}

      {loading ? (
        <div className="flex justify-center py-16"><Spinner /></div>
      ) : (
        <Card className="overflow-hidden">
          {promotions.length === 0 ? (
            <p className="px-5 py-4 text-sm text-neutral-600">No promotions recorded.</p>
          ) : (
            <Table>
              <TableHead>
                <tr>
                  <TableHeaderCell>Source → Target</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Promoted by</TableHeaderCell>
                  <TableHeaderCell>Promoted at</TableHeaderCell>
                  <TableHeaderCell>Completed</TableHeaderCell>
                </tr>
              </TableHead>
              <TableBody>
                {promotions.map(p => {
                  const src = envs.find(e => e.deploymentEnvironmentId === p.sourceEnvId);
                  const tgt = envs.find(e => e.deploymentEnvironmentId === p.targetEnvId);
                  return (
                    <TableRow key={p.promotionId}>
                      <TableCell>
                        {src?.displayName ?? p.sourceEnvId} → {tgt?.displayName ?? p.targetEnvId}
                      </TableCell>
                      <TableCell><Badge value={p.statusCode} /></TableCell>
                      <TableCell>{p.promotedBy}</TableCell>
                      <TableCell>
                        {new Date(p.promotedAt).toLocaleString('en-GB')}
                      </TableCell>
                      <TableCell>
                        {p.completedAt ? new Date(p.completedAt).toLocaleString('en-GB') : '—'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      )}
    </div>
  );
}

function CreatePromotionForm({
  envs, onCreated, onCancel,
}: {
  envs:      DeploymentEnvironment[];
  onCreated: () => void;
  onCancel:  () => void;
}) {
  const [srcId, setSrcId] = useState('');
  const [tgtId, setTgtId] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState('');

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setSaving(true); setError('');
    try {
      await createEnvironmentPromotion({ sourceEnvId: srcId, targetEnvId: tgtId, notes: notes || undefined });
      onCreated();
    } catch (e) {
      setError(e instanceof ApiError ? (e.detail ?? e.message) : 'Failed');
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader title="New environment promotion" />
      <CardBody>
      <form onSubmit={(e) => void handleSubmit(e)}>
        {error && <p className="mb-3 text-sm text-danger-600">{error}</p>}
        <div className="grid gap-3 sm:grid-cols-2">
          <LabelledField label="Source environment" htmlFor="env-src" required>
            <Select id="env-src" value={srcId} onChange={e => setSrcId(e.target.value)} required>
              <option value="">Select…</option>
              {envs.map(e => <option key={e.deploymentEnvironmentId} value={e.deploymentEnvironmentId}>{e.displayName}</option>)}
            </Select>
          </LabelledField>
          <LabelledField label="Target environment" htmlFor="env-tgt" required>
            <Select id="env-tgt" value={tgtId} onChange={e => setTgtId(e.target.value)} required>
              <option value="">Select…</option>
              {envs.filter(e => e.deploymentEnvironmentId !== srcId).map(e => (
                <option key={e.deploymentEnvironmentId} value={e.deploymentEnvironmentId}>{e.displayName}</option>
              ))}
            </Select>
          </LabelledField>
          <div className="sm:col-span-2">
            <LabelledField label="Notes" htmlFor="env-notes" hint="Optional">
              <Textarea id="env-notes" value={notes} onChange={e => setNotes(e.target.value)} rows={2} placeholder="Optional notes" />
            </LabelledField>
          </div>
        </div>
        <div className="mt-4 flex gap-3">
          <Button type="submit" disabled={saving}>{saving ? 'Creating…' : 'Create'}</Button>
          <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>
        </div>
      </form>
      </CardBody>
    </Card>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div>
      <p className="text-xs text-neutral-600 font-medium uppercase tracking-wide">{label}</p>
      <p className={`mt-0.5 text-neutral-900 ${mono ? 'font-mono text-xs' : 'text-sm'}`}>{value}</p>
    </div>
  );
}
