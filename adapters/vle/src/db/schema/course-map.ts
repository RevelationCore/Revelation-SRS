import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { v } from './event-ledger.js';

export const courseMap = v.table('vle_course_map', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  moduleId:    uuid('module_id').notNull(),
  vleCourseId: text('vle_course_id').notNull(),
  title:       text('title'),
  code:        text('code'),
  syncedAt:    timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});
