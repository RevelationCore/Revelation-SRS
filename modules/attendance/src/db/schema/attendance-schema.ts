import { pgSchema } from 'drizzle-orm/pg-core';

/** All attendance-module tables live in the "attendance" PostgreSQL schema. */
export const a = pgSchema('attendance');
