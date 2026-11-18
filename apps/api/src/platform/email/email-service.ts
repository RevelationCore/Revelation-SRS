import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull, sql } from 'drizzle-orm';
import { type Db, type EmailMessage, emailMessages, enrolments, personIdentities, withTenantContext } from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

/**
 * Email in and out of the SRS.
 *
 * Every message is recorded in email_message, whatever carries it. Outbound
 * mail is handed to a transport (only the fake mail server ships); inbound
 * mail arrives through receive(), called by the provider's hook. Messages are
 * threaded by Message-ID and matched to a student by email address.
 */

export interface OutboundEmail {
  messageId: string;
  from:      string;
  to:        string;
  subject:   string;
  bodyText:  string;
  inReplyTo?: string;
}

export interface EmailTransport {
  readonly code: string;
  /** Throws if the message could not be handed over. */
  send(tenantId: string, message: OutboundEmail): Promise<void>;
}

export interface SendEmailInput {
  to:        string;
  subject:   string;
  bodyText:  string;
  /** The student the message is about; found from the address when omitted. */
  personId?: string;
  /** Reply to this message: same thread, same student, In-Reply-To set. */
  inReplyToId?: string;
  communicationDispatchId?: string;
  /** Defaults to the institution's address. */
  from?: string;
}

export interface InboundEmail {
  messageId: string;
  from:      string;
  to:        string;
  subject:   string;
  bodyText:  string;
  /** The Message-ID this replies to, when the sender's client set it. */
  inReplyTo?: string;
  /** The provider that delivered it. */
  transportCode: string;
}

export interface ListEmailOptions {
  direction?: 'inbound' | 'outbound';
  personId?:  string;
  unreadOnly?: boolean;
  limit?:     number;
}

const ADDRESS = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export function isEmailAddress(value: string): boolean {
  return ADDRESS.test(value.trim());
}

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export class EmailService {
  constructor(
    private readonly db: Db,
    private readonly transport: EmailTransport,
    readonly fromAddress: string,
  ) {}

  get transportCode(): string {
    return this.transport.code;
  }

  /** Send a message and record it; a transport failure is recorded as failed, not thrown. */
  async send(tenantId: string, input: SendEmailInput, actorId: string): Promise<EmailMessage> {
    const to = input.to.trim();
    if (!isEmailAddress(to)) throw new ValidationError(`'${input.to}' is not an email address`, [{ field: 'to', message: 'Must be an email address' }]);
    if (!input.subject.trim()) throw new ValidationError('A subject is required', [{ field: 'subject', message: 'Required' }]);
    if (!input.bodyText.trim()) throw new ValidationError('A message is required', [{ field: 'bodyText', message: 'Required' }]);

    const parent = input.inReplyToId ? await this.get(tenantId, input.inReplyToId) : null;
    const id = randomUUID();
    const messageId = `<${id}@srs.revelation>`;
    const from = input.from ?? this.fromAddress;
    const personId = input.personId ?? parent?.personId ?? await this.findPersonByAddress(tenantId, to);

    let failureReason: string | null = null;
    try {
      await this.transport.send(tenantId, {
        messageId, from, to, subject: input.subject.trim(), bodyText: input.bodyText,
        ...(parent?.transportMessageId ? { inReplyTo: parent.transportMessageId } : {}),
      });
    } catch (err) {
      failureReason = err instanceof Error ? err.message : String(err);
    }

    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(emailMessages).values({
      id:                      id,
      tenantId:                tenantId as Uuid,
      directionCode:           'outbound',
      fromAddress:             from,
      toAddress:               to,
      subject:                 input.subject.trim(),
      bodyText:                input.bodyText,
      personId:                (personId ?? null) as Uuid | null,
      threadId:                (parent?.threadId ?? id) as Uuid,
      inReplyToId:             (parent?.id ?? null) as Uuid | null,
      communicationDispatchId: (input.communicationDispatchId ?? null) as Uuid | null,
      statusCode:              failureReason ? 'failed' : 'sent',
      failureReason,
      transportCode:           this.transport.code,
      transportMessageId:      messageId,
      sentBy:                  actorId,
      createdAt:               clockNow(),
    }).returning());
    return row!;
  }

  /**
   * Record a message delivered to the institution. A repeat of a Message-ID
   * already recorded returns the existing message (providers retry hooks).
   */
  async receive(tenantId: string, input: InboundEmail): Promise<{ message: EmailMessage; duplicate: boolean }> {
    const from = input.from.trim();
    if (!isEmailAddress(from)) throw new ValidationError(`'${input.from}' is not an email address`, [{ field: 'from', message: 'Must be an email address' }]);
    if (!input.messageId.trim()) throw new ValidationError('A Message-ID is required', [{ field: 'messageId', message: 'Required' }]);

    const existing = await this.#byTransportId(tenantId, input.messageId);
    if (existing) return { message: existing, duplicate: true };

    const parent = input.inReplyTo ? await this.#byTransportId(tenantId, input.inReplyTo) : null;
    const id = randomUUID();
    const personId = parent?.personId ?? await this.findPersonByAddress(tenantId, from);

    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.insert(emailMessages).values({
      id:                 id,
      tenantId:           tenantId as Uuid,
      directionCode:      'inbound',
      fromAddress:        from,
      toAddress:          input.to.trim(),
      subject:            input.subject.trim() || '(no subject)',
      bodyText:           input.bodyText,
      personId:           (personId ?? null) as Uuid | null,
      threadId:           (parent?.threadId ?? id) as Uuid,
      inReplyToId:        (parent?.id ?? null) as Uuid | null,
      statusCode:         'received',
      transportCode:      input.transportCode,
      transportMessageId: input.messageId,
      createdAt:          clockNow(),
    }).returning());
    return { message: row!, duplicate: false };
  }

  async list(tenantId: string, options: ListEmailOptions = {}): Promise<EmailMessage[]> {
    const t = tenantId as Uuid;
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(emailMessages)
      .where(and(
        eq(emailMessages.tenantId, t),
        ...(options.direction ? [eq(emailMessages.directionCode, options.direction)] : []),
        ...(options.personId ? [eq(emailMessages.personId, options.personId as Uuid)] : []),
        ...(options.unreadOnly ? [eq(emailMessages.directionCode, 'inbound'), isNull(emailMessages.readAt)] : []),
      ))
      .orderBy(desc(emailMessages.createdAt))
      .limit(options.limit ?? 100));
  }

  async get(tenantId: string, id: string): Promise<EmailMessage> {
    const t = tenantId as Uuid;
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(emailMessages)
      .where(and(eq(emailMessages.tenantId, t), eq(emailMessages.id, id as Uuid))).limit(1));
    if (!row) throw new NotFoundError('EmailMessage', id);
    return row;
  }

  /** Every message in a thread, oldest first. */
  async thread(tenantId: string, threadId: string): Promise<EmailMessage[]> {
    const t = tenantId as Uuid;
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(emailMessages)
      .where(and(eq(emailMessages.tenantId, t), eq(emailMessages.threadId, threadId as Uuid)))
      .orderBy(emailMessages.createdAt));
  }

  /** Mark an inbound message read; the first reader is kept. */
  async markRead(tenantId: string, id: string, actorId: string): Promise<EmailMessage> {
    const message = await this.get(tenantId, id);
    if (message.directionCode !== 'inbound' || message.readAt) return message;
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(emailMessages)
      .set({ readAt: clockNow(), readBy: actorId })
      .where(and(eq(emailMessages.tenantId, tenantId as Uuid), eq(emailMessages.id, id as Uuid), isNull(emailMessages.readAt)))
      .returning());
    return row ?? message;
  }

  async unreadCount(tenantId: string): Promise<number> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ n: sql<number>`count(*)::int` }).from(emailMessages)
      .where(and(eq(emailMessages.tenantId, tenantId as Uuid), eq(emailMessages.directionCode, 'inbound'), isNull(emailMessages.readAt))));
    return row?.n ?? 0;
  }

  /** The student with this institutional or personal address, if exactly one has it. */
  async findPersonByAddress(tenantId: string, address: string): Promise<string | undefined> {
    const a = address.trim().toLowerCase();
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.selectDistinct({ personId: personIdentities.personId }).from(personIdentities)
      .where(and(
        eq(personIdentities.tenantId, tenantId as Uuid),
        isNull(personIdentities.recordedUntil),
        isNull(personIdentities.validTo),
        sql`(lower(${personIdentities.emailInstitutional}) = ${a} OR lower(${personIdentities.emailPersonal}) = ${a})`,
      ))
      .limit(2));
    return rows.length === 1 ? rows[0]!.personId : undefined;
  }

  /** Where to email a person: their institutional address, else their personal one. */
  async addressForPerson(tenantId: string, personId: string): Promise<string | undefined> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({
      institutional: personIdentities.emailInstitutional, personal: personIdentities.emailPersonal,
    }).from(personIdentities)
      .where(and(
        eq(personIdentities.tenantId, tenantId as Uuid),
        eq(personIdentities.personId, personId as Uuid),
        isNull(personIdentities.recordedUntil),
        isNull(personIdentities.validTo),
      ))
      .limit(1));
    return row?.institutional ?? row?.personal ?? undefined;
  }

  /** The person an enrolment belongs to. */
  async personForEnrolment(tenantId: string, enrolmentId: string): Promise<string | undefined> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select({ personId: enrolments.personId }).from(enrolments)
      .where(and(eq(enrolments.tenantId, tenantId as Uuid), eq(enrolments.id, enrolmentId as Uuid), isNull(enrolments.recordedUntil)))
      .limit(1));
    return row?.personId;
  }

  async #byTransportId(tenantId: string, transportMessageId: string): Promise<EmailMessage | null> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(emailMessages)
      .where(and(eq(emailMessages.tenantId, tenantId as Uuid), eq(emailMessages.transportMessageId, transportMessageId.trim())))
      .limit(1));
    return row ?? null;
  }
}
