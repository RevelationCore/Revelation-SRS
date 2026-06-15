import type { WellbeingDb, WellbeingTx } from '../db/client.js';
import { auditLog } from '../db/schema/audit-log.js';

export interface AuditEntry {
  tenantId:     string;
  actorId:      string;
  actionCode:   'read' | 'write' | 'export';
  resourceType:
    | 'disability-case'
    | 'dsa-entitlement'
    | 'evidence'
    | 'adjustment-case'
    | 'ec-claim'
    | 'mental-health-case'
    | 'mh-session-note'
    | 'intervention-plan';
  resourceId:   string;
  personId:     string;
  context?:     Record<string, unknown>;
}

export async function appendAudit(
  db:    WellbeingTx | WellbeingDb,
  entry: AuditEntry,
): Promise<void> {
  await db.insert(auditLog).values({
    tenantId:     entry.tenantId,
    actorId:      entry.actorId,
    actionCode:   entry.actionCode,
    resourceType: entry.resourceType,
    resourceId:   entry.resourceId,
    personId:     entry.personId,
    context:      entry.context ?? {},
  });
}
