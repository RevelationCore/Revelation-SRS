import { createHash, randomBytes } from 'node:crypto';

import {
  awards,
  documentIssues,
  documentRevocations,
  documentVerifications,
  personIdentities,
  persons,
  studentDocuments,
  type Award,
  type Db,
  type DocumentIssue,
  type StudentDocument,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';

import type { ValueSetService } from '../value-sets/service.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface IssueDocumentInput {
  documentTypeCode: string;
  channelCode: string;
  issueTypeCode?: 'original' | 'replacement' | 'corrected-name' | 'certified-copy';
}

export interface DocumentIssueDto {
  documentIssueId: string;
  studentDocumentId: string;
  documentTypeCode: string;
  awardId: string;
  issueNumber: number;
  issueTypeCode: string;
  contentSnapshot: Record<string, unknown>;
  contentHash: string;
  verificationCode: string;
  channelCode: string;
  statusCode: string;
  issuedBy: string;
  issuedAt: Date;
  revocation: { reasonCode: string; reasonText: string; revokedBy: string; revokedAt: Date } | null;
}

export interface VerificationResult {
  outcomeCode: 'valid' | 'revoked' | 'superseded' | 'not-found';
  /** Only for a valid or superseded issue: what the document states. */
  document: { documentTypeCode: string; holderName: string; qualificationCode: string; classificationCode: string; awardDate: string; issuedAt: Date } | null;
}

/** Crockford-style alphabet: no 0/O or 1/I/L confusion when read aloud or typed. */
const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Award documents (BPR-D15; BP-06-004). Every issue is a new numbered row
 * with the exact content it states, the hash of that content and a
 * verification code. A replacement supersedes the previous issue; a
 * revocation is append-only. Nothing issued is ever rewritten.
 */
export class AwardDocumentService {
  constructor(private readonly db: Db, private readonly valueSets: ValueSetService) {}

  async issue(tenantId: string, awardId: string, input: IssueDocumentInput, actorId: string): Promise<DocumentIssueDto> {
    await this.#code(tenantId, 'student_document', 'document_type_code', input.documentTypeCode);
    await this.#code(tenantId, 'document_issue', 'channel_code', input.channelCode);
    const issueTypeCode = input.issueTypeCode ?? 'original';
    await this.#code(tenantId, 'document_issue', 'issue_type_code', issueTypeCode);

    const award = await this.#award(tenantId, awardId);
    const snapshot = await this.#snapshot(tenantId, award, input.documentTypeCode);
    const contentHash = createHash('sha256').update(canonicalJson(snapshot)).digest('hex');

    const issueId = await withTenantContext(this.db, tenantId, async (tx) => {
      let [doc] = await tx.select().from(studentDocuments).where(and(
        eq(studentDocuments.tenantId, tenantId as Uuid), eq(studentDocuments.awardId, award.id),
        eq(studentDocuments.documentTypeCode, input.documentTypeCode),
      )).limit(1);
      doc ??= (await tx.insert(studentDocuments).values({
        tenantId: tenantId as Uuid, awardId: award.id, enrolmentId: award.enrolmentId, personId: award.personId,
        documentTypeCode: input.documentTypeCode, createdBy: actorId,
      }).returning())[0]!;

      const prior = await tx.select().from(documentIssues).where(eq(documentIssues.studentDocumentId, doc.id));
      const current = prior.filter((p) => p.statusCode === 'issued' && p.issueTypeCode !== 'certified-copy');
      if (issueTypeCode === 'original' && prior.length > 0) {
        throw new ConflictError('This document has already been issued; issue a replacement, corrected-name issue or certified copy');
      }
      if (issueTypeCode !== 'original' && prior.length === 0) {
        throw new ConflictError(`A ${issueTypeCode} needs an original issue first`);
      }
      if (issueTypeCode === 'replacement' || issueTypeCode === 'corrected-name') {
        if (current.length > 0) {
          await tx.update(documentIssues).set({ statusCode: 'superseded' })
            .where(inArray(documentIssues.id, current.map((c) => c.id)));
        }
      }
      const issueNumber = prior.reduce((max, p) => Math.max(max, p.issueNumber), 0) + 1;
      const [created] = await tx.insert(documentIssues).values({
        tenantId: tenantId as Uuid, studentDocumentId: doc.id, issueNumber, issueTypeCode, contentSnapshot: snapshot,
        contentHash, verificationCode: verificationCode(), channelCode: input.channelCode, issuedBy: actorId,
      }).returning();
      return created!.id;
    });
    return this.getIssue(tenantId, issueId);
  }

  async revoke(tenantId: string, issueId: string, input: { reasonCode: string; reasonText: string }, actorId: string): Promise<DocumentIssueDto> {
    await this.#code(tenantId, 'document_revocation', 'reason_code', input.reasonCode);
    const issue = await this.#issue(tenantId, issueId);
    if (issue.statusCode === 'revoked') throw new ConflictError('This issue is already revoked');
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(documentRevocations).values({
        tenantId: tenantId as Uuid, documentIssueId: issue.id, reasonCode: input.reasonCode, reasonText: input.reasonText, revokedBy: actorId,
      });
      await tx.update(documentIssues).set({ statusCode: 'revoked' }).where(eq(documentIssues.id, issue.id));
    });
    return this.getIssue(tenantId, issueId);
  }

  /** Checks a verification code, logs the check, and discloses the minimum needed. */
  async verify(tenantId: string, code: string, requestedBy: string, requesterNote?: string): Promise<VerificationResult> {
    const normalised = code.trim().toUpperCase().replace(/[\s-]/g, '');
    const [issue] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentIssues).where(and(
      eq(documentIssues.tenantId, tenantId as Uuid), eq(documentIssues.verificationCode, normalised),
    )).limit(1));
    const outcomeCode: VerificationResult['outcomeCode'] = !issue ? 'not-found'
      : issue.statusCode === 'revoked' ? 'revoked'
        : issue.statusCode === 'superseded' ? 'superseded' : 'valid';
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(documentVerifications).values({
      tenantId: tenantId as Uuid, documentIssueId: issue?.id ?? null, verificationCode: normalised,
      requestedBy, requesterNote: requesterNote ?? null, outcomeCode,
    }));
    if (!issue || outcomeCode === 'revoked') return { outcomeCode, document: null };
    const s = issue.contentSnapshot as Record<string, string>;
    return {
      outcomeCode,
      document: {
        documentTypeCode: s['documentTypeCode']!, holderName: s['holderName']!, qualificationCode: s['qualificationCode']!,
        classificationCode: s['classificationCode']!, awardDate: s['awardDate']!, issuedAt: issue.issuedAt,
      },
    };
  }

  async getIssue(tenantId: string, issueId: string): Promise<DocumentIssueDto> {
    const issue = await this.#issue(tenantId, issueId);
    return (await this.#dtos(tenantId, [issue]))[0]!;
  }

  async listForAward(tenantId: string, awardId: string): Promise<DocumentIssueDto[]> {
    return this.#listWhere(tenantId, eq(studentDocuments.awardId, awardId as Uuid));
  }

  async listForPerson(tenantId: string, personId: string): Promise<DocumentIssueDto[]> {
    return this.#listWhere(tenantId, eq(studentDocuments.personId, personId as Uuid));
  }

  // ── internals ──────────────────────────────────────────────────────────────

  async #listWhere(tenantId: string, where: ReturnType<typeof eq>): Promise<DocumentIssueDto[]> {
    const issues = await withTenantContext(this.db, tenantId, (tx) => tx.select({ issue: documentIssues }).from(documentIssues)
      .innerJoin(studentDocuments, eq(studentDocuments.id, documentIssues.studentDocumentId))
      .where(and(eq(documentIssues.tenantId, tenantId as Uuid), where))
      .orderBy(desc(documentIssues.issuedAt)));
    return this.#dtos(tenantId, issues.map((r) => r.issue));
  }

  async #dtos(tenantId: string, issues: DocumentIssue[]): Promise<DocumentIssueDto[]> {
    if (issues.length === 0) return [];
    const [docs, revocations] = await withTenantContext(this.db, tenantId, async (tx) => [
      await tx.select().from(studentDocuments).where(inArray(studentDocuments.id, [...new Set(issues.map((i) => i.studentDocumentId))])),
      await tx.select().from(documentRevocations).where(inArray(documentRevocations.documentIssueId, issues.map((i) => i.id))),
    ] as const);
    const docById = new Map<string, StudentDocument>(docs.map((d) => [d.id, d]));
    return issues.map((i) => {
      const doc = docById.get(i.studentDocumentId)!;
      const rev = revocations.find((r) => r.documentIssueId === i.id);
      return {
        documentIssueId: i.id, studentDocumentId: i.studentDocumentId, documentTypeCode: doc.documentTypeCode, awardId: doc.awardId,
        issueNumber: i.issueNumber, issueTypeCode: i.issueTypeCode, contentSnapshot: i.contentSnapshot, contentHash: i.contentHash,
        verificationCode: i.verificationCode, channelCode: i.channelCode, statusCode: i.statusCode, issuedBy: i.issuedBy, issuedAt: i.issuedAt,
        revocation: rev ? { reasonCode: rev.reasonCode, reasonText: rev.reasonText, revokedBy: rev.revokedBy, revokedAt: rev.revokedAt } : null,
      };
    });
  }

  async #award(tenantId: string, awardId: string) {
    const [award] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(awards).where(and(
      eq(awards.id, awardId as Uuid), eq(awards.tenantId, tenantId as Uuid), isNull(awards.recordedUntil),
    )).limit(1));
    if (!award) throw new NotFoundError('Award', awardId);
    return award;
  }

  /** The verified facts the document states. Missing or inconsistent data blocks issue (E1). */
  async #snapshot(tenantId: string, award: Award, documentTypeCode: string): Promise<Record<string, string>> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({
      studentNumber: persons.studentNumber, first: personIdentities.legalFirstName, family: personIdentities.legalFamilyName,
    }).from(persons).innerJoin(personIdentities, and(eq(personIdentities.personId, persons.id), isNull(personIdentities.recordedUntil)))
      .where(and(eq(persons.id, award.personId), eq(persons.tenantId, tenantId as Uuid))).limit(1));
    const person = rows[0];
    const holderName = person ? `${person.first} ${person.family}`.trim() : '';
    if (!person || !holderName) throw new ValidationError('The student\'s verified legal name is missing; correct the record before issuing (BP-06-004 E1)');
    if (!award.qualificationCode || !award.classificationCode || !award.awardDate) {
      throw new ValidationError('The award record is incomplete; correct it before issuing (BP-06-004 E1)');
    }
    return {
      documentTypeCode,
      holderName,
      studentNumber: person.studentNumber,
      qualificationCode: award.qualificationCode,
      classificationCode: award.classificationCode,
      awardDate: award.awardDate,
      awardId: award.id,
    };
  }

  async #issue(tenantId: string, issueId: string): Promise<DocumentIssue> {
    const [issue] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentIssues).where(and(
      eq(documentIssues.id, issueId as Uuid), eq(documentIssues.tenantId, tenantId as Uuid),
    )).limit(1));
    if (!issue) throw new NotFoundError('DocumentIssue', issueId);
    return issue;
  }

  async #code(tenantId: string, entity: string, field: string, value: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field, message: 'Value is not active in the configured value set' }]);
    }
  }
}

function verificationCode(): string {
  const bytes = randomBytes(12);
  return Array.from(bytes, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('');
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = value[k]; return acc; }, {}));
}
