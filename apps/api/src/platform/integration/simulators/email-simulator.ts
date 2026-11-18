import { and, desc, eq, or, sql } from 'drizzle-orm';
import { type Db, emailSimulatorMessages, withTenantContext } from '@revelation-srs/db';

import type { EmailTransport, OutboundEmail } from '../../email/email-service.js';

/**
 * The fake mail server: an in-repo stand-in for an SMTP relay and an
 * inbound-mail provider, used in development, demos and tests.
 *
 * Outbound: whatever the SRS sends is "delivered" into the recipient's
 * mailbox here (direction to-external), never onto the internet. A
 * recipient at a .invalid domain is refused, so a delivery failure can be
 * seen on purpose.
 *
 * Inbound: the admin Email simulator page sends mail as an external person;
 * it is stored here (to-institution) and handed to the SRS exactly as a
 * provider's inbound hook would.
 */
export class FakeEmailTransport implements EmailTransport {
  readonly code = 'fake';

  constructor(private readonly db: Db) {}

  async send(tenantId: string, message: OutboundEmail): Promise<void> {
    if (/\.invalid$/i.test(message.to.split('@')[1] ?? '')) {
      throw new Error(`The fake mail server refused ${message.to}: the domain does not accept mail`);
    }
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(emailSimulatorMessages).values({
      tenantId:           tenantId as `${string}-${string}-${string}-${string}-${string}`,
      directionCode:      'to-external',
      messageId:          message.messageId,
      fromAddress:        message.from,
      toAddress:          message.to,
      subject:            message.subject,
      bodyText:           message.bodyText,
      inReplyToMessageId: message.inReplyTo ?? null,
      createdBy:          'fake-mail-server',
    }));
  }
}

export interface SimulatorMailbox {
  address:      string;
  received:     number;
  sent:         number;
  lastActivity: Date;
}

/** External addresses the fake server has seen, busiest first. */
export async function listSimulatorMailboxes(db: Db, tenantId: string): Promise<SimulatorMailbox[]> {
  const rows = await withTenantContext(db, tenantId, (tx) => tx.execute(sql`
    SELECT address, sum(received)::int AS received, sum(sent)::int AS sent, max(at) AS last_activity
    FROM (
      SELECT lower(to_address)   AS address, 1 AS received, 0 AS sent, created_at AS at
      FROM   email_simulator_message WHERE tenant_id = ${tenantId}::uuid AND direction_code = 'to-external'
      UNION ALL
      SELECT lower(from_address) AS address, 0 AS received, 1 AS sent, created_at AS at
      FROM   email_simulator_message WHERE tenant_id = ${tenantId}::uuid AND direction_code = 'to-institution'
    ) m
    GROUP BY address
    ORDER BY max(at) DESC
    LIMIT 200
  `)) as unknown as Array<{ address: string; received: number; sent: number; last_activity: string | Date }>;
  return rows.map((r) => ({ address: r.address, received: r.received, sent: r.sent, lastActivity: new Date(r.last_activity) }));
}

/** One external mailbox: what it received from, and sent to, the institution, newest first. */
export async function listSimulatorMessages(db: Db, tenantId: string, address: string) {
  const t = tenantId as `${string}-${string}-${string}-${string}-${string}`;
  const a = address.trim().toLowerCase();
  return withTenantContext(db, tenantId, (tx) => tx.select().from(emailSimulatorMessages)
    .where(and(
      eq(emailSimulatorMessages.tenantId, t),
      or(
        and(eq(emailSimulatorMessages.directionCode, 'to-external'), sql`lower(${emailSimulatorMessages.toAddress}) = ${a}`),
        and(eq(emailSimulatorMessages.directionCode, 'to-institution'), sql`lower(${emailSimulatorMessages.fromAddress}) = ${a}`),
      ),
    ))
    .orderBy(desc(emailSimulatorMessages.createdAt))
    .limit(200));
}

/** Record mail an external person sends in, before it is handed to the SRS. */
export async function recordSimulatorSendIn(db: Db, tenantId: string, input: {
  messageId: string; from: string; to: string; subject: string; bodyText: string; inReplyTo?: string; createdBy: string;
}): Promise<void> {
  await withTenantContext(db, tenantId, (tx) => tx.insert(emailSimulatorMessages).values({
    tenantId:           tenantId as `${string}-${string}-${string}-${string}-${string}`,
    directionCode:      'to-institution',
    messageId:          input.messageId,
    fromAddress:        input.from,
    toAddress:          input.to,
    subject:            input.subject,
    bodyText:           input.bodyText,
    inReplyToMessageId: input.inReplyTo ?? null,
    createdBy:          input.createdBy,
  }));
}
