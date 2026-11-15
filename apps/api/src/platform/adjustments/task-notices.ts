import { tenants, type Db } from '@revelation-srs/db';

import type { CommunicationService } from '../communications/communication-service.js';
import type { DeliveryService } from '../delivery/delivery-service.js';
import { clockNow } from '../clock.js';

import type { AdjustmentService } from './adjustment-service.js';
import type { AdjustmentTargetConfigService } from './target-config.js';

const TARGET_LABELS: Record<string, string> = { vle: 'VLE', attendance: 'attendance', exams: 'exams' };
const NOTICE_INTERVAL_MS = 24 * 3_600_000;
export const OVERDUE_TEMPLATE_KEY = 'adjustment-tasks.overdue';
export const DELIVERY_OVERDUE_TEMPLATE_KEY = 'delivery-tasks.overdue';
const QUEUE_PATH = '/operations/integration-tasks';

export interface NoticeResult {
  tenantId:     string;
  /** An adjustment target (vle, attendance, exams) or a delivery flow code. */
  targetSystem: string;
  overdueCount: number;
  statusCode:   string;
}

/**
 * Overdue digests for the manual adjustment task queue. The queue flags an
 * overdue task, but only for someone who opens it; a manual target that
 * names a team mailbox (notifyEmail) is sent at most one digest a day while
 * tasks are overdue. The digest carries counts and a link, never student
 * details: it goes to a shared mailbox, and the queue is where the detail is
 * access-controlled. Sent through the communications dispatch log, so the
 * tenant's email channel flag and delivery service apply.
 */
export class AdjustmentTaskNoticeService {
  constructor(
    private readonly db: Db,
    private readonly adjustments: AdjustmentService,
    private readonly targets: AdjustmentTargetConfigService,
    private readonly communications: CommunicationService,
    private readonly adminAppUrl: string | undefined,
    private readonly deliveries?: DeliveryService,
  ) {}

  async sendOverdueNotices(tenantId: string, now: Date = clockNow()): Promise<NoticeResult[]> {
    const results: NoticeResult[] = [];
    for (const config of await this.targets.list(tenantId)) {
      if (config.fulfilmentModeCode !== 'manual' || !config.notifyEmail || config.isDefault) continue;
      if (config.lastOverdueNoticeAt && now.getTime() - config.lastOverdueNoticeAt.getTime() < NOTICE_INTERVAL_MS) continue;

      const tasks = await this.adjustments.listTasks(tenantId, { targetSystem: config.targetSystem, now });
      const overdue = tasks.filter((t) => t.overdue);
      if (overdue.length === 0) continue;

      const oldest = overdue.reduce((a, b) => (a.dueSince < b.dueSince ? a : b));
      const dispatch = await this.communications.dispatch(tenantId, {
        templateKey: OVERDUE_TEMPLATE_KEY,
        channelCode: 'email',
        subjectEntityType: 'adjustment_target_config',
        subjectEntityId: tenantId,
        recipientRef: config.notifyEmail,
        payload: {
          targetSystem: config.targetSystem,
          targetLabel: TARGET_LABELS[config.targetSystem] ?? config.targetSystem,
          overdueCount: overdue.length,
          openCount: tasks.length,
          alertAfterHours: config.alertAfterHours,
          oldestDueSince: oldest.dueSince.toISOString(),
          queueUrl: `${this.adminAppUrl ?? ''}${QUEUE_PATH}?tab=adjustments&target=${config.targetSystem}`,
        },
      }, 'system:adjustment-task-notices');

      // Recorded even when the email channel is off (suppressed), so the
      // dispatch log gains one entry a day, not one per reconcile run.
      await this.targets.markOverdueNoticeSent(tenantId, config.targetSystem, now);
      results.push({ tenantId, targetSystem: config.targetSystem, overdueCount: overdue.length, statusCode: dispatch.statusCode });
    }
    if (this.deliveries) results.push(...await this.#deliveryNotices(tenantId, now));
    return results;
  }

  /** The same digest for other outbound flows worked by hand (library, ...). */
  async #deliveryNotices(tenantId: string, now: Date): Promise<NoticeResult[]> {
    const results: NoticeResult[] = [];
    for (const flow of await this.deliveries!.listFlows(tenantId)) {
      if (flow.fulfilmentModeCode !== 'manual' || !flow.notifyEmail) continue;
      if (flow.lastOverdueNoticeAt && now.getTime() - flow.lastOverdueNoticeAt.getTime() < NOTICE_INTERVAL_MS) continue;
      const tasks = await this.deliveries!.listTasks(tenantId, { flowCode: flow.flowCode, now });
      const overdue = tasks.filter((t) => t.overdue);
      if (overdue.length === 0) continue;
      const oldest = overdue.reduce((a, b) => (a.createdAt < b.createdAt ? a : b));
      const dispatch = await this.communications.dispatch(tenantId, {
        templateKey: DELIVERY_OVERDUE_TEMPLATE_KEY,
        channelCode: 'email',
        subjectEntityType: 'delivery_flow_config',
        subjectEntityId: tenantId,
        recipientRef: flow.notifyEmail,
        payload: {
          flowCode: flow.flowCode,
          flowName: flow.name,
          targetLabel: flow.targetLabel,
          overdueCount: overdue.length,
          openCount: tasks.length,
          alertAfterHours: flow.alertAfterHours,
          oldestDueSince: oldest.createdAt.toISOString(),
          queueUrl: `${this.adminAppUrl ?? ''}${QUEUE_PATH}?tab=systems&flow=${flow.flowCode}`,
        },
      }, 'system:delivery-task-notices');
      await this.deliveries!.markOverdueNoticeSent(tenantId, flow.flowCode, now);
      results.push({ tenantId, targetSystem: flow.flowCode, overdueCount: overdue.length, statusCode: dispatch.statusCode });
    }
    return results;
  }

  async sendAll(now: Date = clockNow()): Promise<NoticeResult[]> {
    const all: NoticeResult[] = [];
    for (const { id } of await this.db.select({ id: tenants.id }).from(tenants)) {
      all.push(...await this.sendOverdueNotices(id, now));
    }
    return all;
  }
}
