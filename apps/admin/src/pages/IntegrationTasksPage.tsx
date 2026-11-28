import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader, Tabs, TabsList, TabsTrigger, TabsContent } from '@revelation-srs/ui';

import { useAuth } from '../auth/AuthContext.js';
import { userHasAnyPermission } from '../auth/RequirePermission.js';

import { AdjustmentTasksPanel } from './AdjustmentTasksPage.js';
import { DeliveryTasksPanel } from './DeliveryTasksPanel.js';

type Tab = 'adjustments' | 'systems';

/**
 * One queue for work a connected system would otherwise do: approved
 * adjustments for targets worked by hand, and changes for other systems
 * (library, ...). Each tab follows its own permission.
 * ?tab=adjustments|systems — overdue digests link to the right tab.
 */
export function IntegrationTasksPage() {
  const { roles } = useAuth();
  const canAdjustments = userHasAnyPermission(roles, ['adjustment:fulfil']);
  const canSystems = userHasAnyPermission(roles, ['delivery:fulfil']);
  const [searchParams] = useSearchParams();
  const requested = searchParams.get('tab');
  const initial: Tab = requested === 'systems' && canSystems ? 'systems'
    : canAdjustments ? 'adjustments' : 'systems';
  // Derived each render until the user picks a tab: the session (and so the
  // roles) can arrive after the first render (ADR-026).
  const [picked, setPicked] = useState<Tab | null>(null);
  const tab = picked ?? initial;
  const setTab = (t: Tab) => setPicked(t);

  return (
    <div>
      <PageHeader
        title="Integration tasks"
        description="Work a connected system would otherwise do. Make each change in the system, then confirm it here."
      />
      <Tabs value={tab} onValueChange={(v) => setTab(v as Tab)}>
        <TabsList className="mb-6">
          {canAdjustments && <TabsTrigger value="adjustments">Adjustments</TabsTrigger>}
          {canSystems && <TabsTrigger value="systems">Other systems</TabsTrigger>}
        </TabsList>
        {canAdjustments && <TabsContent value="adjustments"><AdjustmentTasksPanel /></TabsContent>}
        {canSystems && <TabsContent value="systems"><DeliveryTasksPanel /></TabsContent>}
      </Tabs>
    </div>
  );
}
