import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';
import { nonWorkingDays, tenants, type Db, type NonWorkingDay, withTenantContext } from '@revelation-srs/db';
import { ValidationError } from '@revelation-srs/domain';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export const CALENDAR_DIVISIONS = ['england-and-wales', 'scotland', 'northern-ireland'] as const;
export type CalendarDivision = typeof CALENDAR_DIVISIONS[number];

const DAY_MS = 86_400_000;
const isoDay = (d: Date) => d.toISOString().slice(0, 10);

/** The tenant's division for bank holidays (calendar.division, default England and Wales). */
async function divisionFor(db: Db, tenantId: string): Promise<CalendarDivision> {
  const [row] = await db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
  const d = ((row?.configuration?.['calendar'] ?? {}) as Record<string, unknown>)['division'];
  return CALENDAR_DIVISIONS.includes(d as CalendarDivision) ? d as CalendarDivision : 'england-and-wales';
}

/**
 * What a deadline counts as non-working (institution-confirmations pre-review
 * F-1, BL-178). A statutory deadline (UKVI reporting, FOI) excludes only
 * weekends and bank holidays: neither the law nor UKVI counts an institution's
 * closure as non-working. An institutional one (a Clearing review, UCAS
 * reconciliation) also skips the institution's closure days.
 */
export type DeadlineKind = 'statutory' | 'institutional';

/**
 * Adds working days to a date (Phase 5 D-42): Monday to Friday, less the
 * tenant's bank holidays for its division and, for an institutional deadline
 * only, its own closure days. The kind is required, so no caller can forget it.
 */
export async function addWorkingDaysFor(db: Db, tenantId: string, from: Date, days: number, kind: DeadlineKind): Promise<Date> {
  const division = await divisionFor(db, tenantId);
  // Enough calendar days to cover the span with any plausible run of holidays.
  const until = new Date(from.getTime() + (days * 2 + 21) * DAY_MS);
  const rows = await withTenantContext(db, tenantId, (tx) => tx.select({ date: nonWorkingDays.date }).from(nonWorkingDays).where(and(
    eq(nonWorkingDays.tenantId, tenantId as Uuid), inArray(nonWorkingDays.divisionCode, kind === 'statutory' ? [division] : [division, 'tenant']),
    gte(nonWorkingDays.date, isoDay(from)), lte(nonWorkingDays.date, isoDay(until)),
  )));
  const closed = new Set(rows.map((r) => r.date));
  const d = new Date(from);
  let left = days;
  while (left > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const day = d.getUTCDay();
    if (day !== 0 && day !== 6 && !closed.has(isoDay(d))) left -= 1;
  }
  return d;
}

/** The GOV.UK bank holidays JSON (https://www.gov.uk/bank-holidays.json). */
export type GovUkBankHolidays = Partial<Record<CalendarDivision, { division?: string; events: Array<{ title: string; date: string; notes?: string; bunting?: boolean }> }>>;

/** Loads bank holidays from the GOV.UK format; existing days are left as they are. */
export async function importBankHolidays(db: Db, tenantId: string, data: GovUkBankHolidays, actorId: string): Promise<{ imported: number }> {
  const rows: Array<typeof nonWorkingDays.$inferInsert> = [];
  for (const division of CALENDAR_DIVISIONS) {
    for (const e of data[division]?.events ?? []) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date) || !e.title) throw new ValidationError(`Invalid bank holiday in ${division}: ${JSON.stringify(e)}`);
      rows.push({ tenantId: tenantId, date: e.date, divisionCode: division, description: e.title, source: 'gov-uk-json', createdBy: actorId });
    }
  }
  if (rows.length === 0) throw new ValidationError('No bank holidays found; expected the GOV.UK bank-holidays.json format');
  const inserted = await withTenantContext(db, tenantId, (tx) => tx.insert(nonWorkingDays).values(rows).onConflictDoNothing().returning({ id: nonWorkingDays.id }));
  return { imported: inserted.length };
}

/** An institution closure day, which applies whatever the division. */
export async function addClosureDay(db: Db, tenantId: string, input: { date: string; description: string }, actorId: string): Promise<NonWorkingDay> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) throw new ValidationError('A closure day needs a date (YYYY-MM-DD)');
  const [row] = await withTenantContext(db, tenantId, (tx) => tx.insert(nonWorkingDays).values({
    tenantId: tenantId as Uuid, date: input.date, divisionCode: 'tenant', description: input.description, source: 'manual', createdBy: actorId,
  }).onConflictDoNothing().returning());
  if (!row) throw new ValidationError(`${input.date} is already a closure day`);
  return row;
}

export async function listNonWorkingDays(db: Db, tenantId: string, filter: { from?: string; to?: string; divisionCode?: string } = {}): Promise<NonWorkingDay[]> {
  return withTenantContext(db, tenantId, (tx) => tx.select().from(nonWorkingDays).where(and(
    eq(nonWorkingDays.tenantId, tenantId as Uuid),
    ...(filter.from ? [gte(nonWorkingDays.date, filter.from)] : []),
    ...(filter.to ? [lte(nonWorkingDays.date, filter.to)] : []),
    ...(filter.divisionCode ? [eq(nonWorkingDays.divisionCode, filter.divisionCode)] : []),
  )).orderBy(asc(nonWorkingDays.date)));
}
