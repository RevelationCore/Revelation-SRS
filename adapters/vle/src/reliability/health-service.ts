import { and, count, desc, eq, gte, max } from 'drizzle-orm';

import type { VleDb } from '../db/client.js';
import { eventLedger }       from '../db/schema/event-ledger.js';
import { reconciliationRun } from '../db/schema/reconciliation.js';

export interface ConnectorHealthReport {
  tenantId:        string;
  totalProcessed:  number;
  totalFailed:     number;
  recentFailed:    number;
  lastProcessedAt: Date | null;
  lastReconciliation: {
    runType:      string;
    completedAt:  Date | null;
    driftCount:   number;
    repairedCount: number;
  } | null;
}

export class HealthService {
  constructor(private readonly db: VleDb) {}

  async getReport(tenantId: string): Promise<ConnectorHealthReport> {
    const [processedRows, failedRows, recentFailedRows, lastAtRows, lastRunRows] = await Promise.all([
      // total processed
      this.db
        .select({ cnt: count() })
        .from(eventLedger)
        .where(and(eq(eventLedger.tenantId, tenantId), eq(eventLedger.statusCode, 'processed'))),

      // total failed
      this.db
        .select({ cnt: count() })
        .from(eventLedger)
        .where(and(eq(eventLedger.tenantId, tenantId), eq(eventLedger.statusCode, 'failed'))),

      // failed in last 24h
      this.db
        .select({ cnt: count() })
        .from(eventLedger)
        .where(
          and(
            eq(eventLedger.tenantId,   tenantId),
            eq(eventLedger.statusCode, 'failed'),
            gte(eventLedger.processedAt, new Date(Date.now() - 24 * 60 * 60 * 1000)),
          ),
        ),

      // most recent processed timestamp
      this.db
        .select({ lastAt: max(eventLedger.processedAt) })
        .from(eventLedger)
        .where(and(eq(eventLedger.tenantId, tenantId), eq(eventLedger.statusCode, 'processed'))),

      // most recent reconciliation run
      this.db
        .select({
          runType:      reconciliationRun.runType,
          completedAt:  reconciliationRun.completedAt,
          driftCount:   reconciliationRun.driftCount,
          repairedCount: reconciliationRun.repairedCount,
        })
        .from(reconciliationRun)
        .where(eq(reconciliationRun.tenantId, tenantId))
        .orderBy(desc(reconciliationRun.startedAt))
        .limit(1),
    ]);

    return {
      tenantId,
      totalProcessed:  processedRows[0]?.cnt ?? 0,
      totalFailed:     failedRows[0]?.cnt ?? 0,
      recentFailed:    recentFailedRows[0]?.cnt ?? 0,
      lastProcessedAt: lastAtRows[0]?.lastAt ?? null,
      lastReconciliation: lastRunRows[0] ?? null,
    };
  }
}
