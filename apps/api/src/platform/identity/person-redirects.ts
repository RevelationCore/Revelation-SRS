import { identityRedirects, type Db, withTenantContext } from '@revelation-srs/db';
import { and, eq, isNull } from 'drizzle-orm';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * ADR-031 item 6: the person an old (merged-away) id now resolves to. Reads
 * identity_redirect where ended_at is null, through the index on current
 * redirects. There is no cache, so an unmerge takes effect on the next
 * request. Merges never chain, so one lookup is enough.
 */
export class PersonRedirectResolver {
  constructor(private readonly db: Db) {}

  async current(tenantId: string, personId: string): Promise<string | null> {
    if (!UUID.test(personId)) return null;
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ to: identityRedirects.newPersonId }).from(identityRedirects)
      .where(and(eq(identityRedirects.tenantId, tenantId as Uuid), eq(identityRedirects.oldPersonId, personId as Uuid), isNull(identityRedirects.endedAt)))
      .limit(1));
    return row?.to ?? null;
  }
}
