import { date, text, uuid } from 'drizzle-orm/pg-core';
import { pgTable } from 'drizzle-orm/pg-core';

import { bitemporalColumns } from '../temporal.js';

import { moduleOfferings } from './calendar.js';
import { tenants } from './tenant.js';

/**
 * Bitemporal module registration — a student's enrolment on a specific
 * module offering within an academic period.
 *
 * enrolment_id is the logical UUID of the enrolment (stable across versions).
 * Status transitions (registered → withdrawn → completed) are recorded by
 * closing the current row and inserting a new bitemporal version.
 */
export const moduleRegistrations = pgTable('module_registration', {
  ...bitemporalColumns,
  tenantId:        uuid('tenant_id').notNull().references(() => tenants.id),
  enrolmentId:     uuid('enrolment_id').notNull(),  // logical FK → enrolments.id
  moduleOfferingId: uuid('module_offering_id').notNull().references(() => moduleOfferings.id),
  statusCode:      text('status_code').notNull().default('registered'),
  registrationDate: date('registration_date').notNull(),
});

export type ModuleRegistration    = typeof moduleRegistrations.$inferSelect;
export type NewModuleRegistration = typeof moduleRegistrations.$inferInsert;
