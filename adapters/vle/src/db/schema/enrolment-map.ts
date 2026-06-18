import { text, timestamp, uuid } from 'drizzle-orm/pg-core';

import { v } from './event-ledger.js';

export const enrolmentMap = v.table('vle_enrolment_map', {
  id:                   uuid('id').primaryKey().defaultRandom(),
  tenantId:             uuid('tenant_id').notNull(),
  moduleRegistrationId: uuid('module_registration_id').notNull(),
  moduleId:             uuid('module_id').notNull(),
  enrolmentId:          uuid('enrolment_id').notNull(),
  personId:             uuid('person_id').notNull(),
  vleEnrolmentId:       text('vle_enrolment_id'),
  statusCode:           text('status_code').notNull().default('active'), // active | suspended | withdrawn | completed
  syncedAt:             timestamp('synced_at', { withTimezone: true }).notNull().defaultNow(),
});
