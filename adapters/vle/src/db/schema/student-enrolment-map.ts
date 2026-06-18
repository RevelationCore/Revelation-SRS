import { timestamp, uuid } from 'drizzle-orm/pg-core';

import { v } from './event-ledger.js';

/**
 * Enrolment → person lookup.
 * Seeded from srs.student.enrolled events so module-registered handlers
 * can resolve personId from enrolmentId.
 */
export const studentEnrolmentMap = v.table('vle_student_enrolment_map', {
  id:          uuid('id').primaryKey().defaultRandom(),
  tenantId:    uuid('tenant_id').notNull(),
  enrolmentId: uuid('enrolment_id').notNull(),
  personId:    uuid('person_id').notNull(),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
