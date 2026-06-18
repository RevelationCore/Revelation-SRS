import { and, eq } from 'drizzle-orm';

import type { VleDb, VleTx } from '../../db/client.js';
import { courseMap } from '../../db/schema/course-map.js';

/** Returns the VLE course ID for a given SRS moduleId, or null if not mapped. */
export async function getCourseMapping(
  db:       VleDb | VleTx,
  tenantId: string,
  moduleId: string,
): Promise<{ vleCourseId: string } | null> {
  const rows = await db
    .select({ vleCourseId: courseMap.vleCourseId })
    .from(courseMap)
    .where(and(eq(courseMap.tenantId, tenantId), eq(courseMap.moduleId, moduleId)))
    .limit(1);
  return rows[0] ?? null;
}

/** Upserts the connector-side course map record. */
export async function upsertCourseMapping(
  db:         VleDb | VleTx,
  tenantId:   string,
  moduleId:   string,
  vleCourseId: string,
  opts?: { title?: string | null; code?: string | null },
): Promise<void> {
  await db
    .insert(courseMap)
    .values({
      tenantId,
      moduleId,
      vleCourseId,
      title:    opts?.title ?? null,
      code:     opts?.code ?? null,
    })
    .onConflictDoUpdate({
      target: [courseMap.tenantId, courseMap.moduleId],
      set: {
        vleCourseId,
        title:    opts?.title ?? null,
        code:     opts?.code ?? null,
        syncedAt: new Date(),
      },
    });
}
