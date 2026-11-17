import { createHash, randomBytes, randomUUID } from 'node:crypto';

import {
  awards,
  documentIssues,
  documentSigningKeys,
  documentRevocations,
  documentVerifications,
  personIdentities,
  persons,
  studentDocuments,
  tenants,
  type Award,
  type Db,
  type DocumentIssue,
  type StudentDocument,
  withTenantContext,
} from '@revelation-srs/db';
import { createPostgresDocumentAdapter } from '@revelation-srs/documents';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';

import type { BusinessCaseService } from '../cases/business-case-service.js';
import { clockNow } from '../clock.js';
import type { ValueSetService } from '../value-sets/service.js';

import { type DocumentRenderer, PdfmakeRenderer } from './document-renderer.js';
import { type DocumentSigner, LocalKeySigner, verifyDetached } from './document-signer.js';

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
  personId: string;
  /** Rendering and signature (D-20); null for an issue made before rendering existed. */
  rendered: { documentId: string; templateCode: string; templateVersion: string; pdfSha256: string; signingKeyId: string | null } | null;
}

export interface SignatureCheck { status: 'valid' | 'invalid' | 'key-withdrawn' | 'unsigned'; keyId: string | null }

export interface RevocationRequestDto {
  caseId: string; documentIssueId: string; statusCode: string; reasonCode: string; reasonText: string;
  requestedBy: string; requestedAt: Date; decision: { outcome: string; decidedBy: string; decidedAt: Date; note: string | null } | null;
}

export const DOCUMENT_REVOCATION_PROCESS_ID = 'BP-06-004';

export interface VerificationResult {
  outcomeCode: 'valid' | 'revoked' | 'superseded' | 'not-found';
  /** Only for a valid or superseded issue: what the document states. */
  document: { documentTypeCode: string; holderName: string; qualificationCode: string; classificationCode: string; awardDate: string; issuedAt: Date } | null;
  /** The signature on the issue, checked against the institution's published key (D-21). */
  signature?: SignatureCheck;
  issuer?: string;
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
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
    private readonly businessCases?: BusinessCaseService,
    private readonly signer: DocumentSigner = new LocalKeySigner(),
    private readonly renderer: DocumentRenderer = new PdfmakeRenderer(),
    private readonly publicBaseUrl = 'http://localhost:3000',
  ) {}

  async issue(tenantId: string, awardId: string, input: IssueDocumentInput, actorId: string): Promise<DocumentIssueDto> {
    await this.#code(tenantId, 'student_document', 'document_type_code', input.documentTypeCode);
    await this.#code(tenantId, 'document_issue', 'channel_code', input.channelCode);
    const issueTypeCode = input.issueTypeCode ?? 'original';
    await this.#code(tenantId, 'document_issue', 'issue_type_code', issueTypeCode);

    const award = await this.#award(tenantId, awardId);
    const snapshot = await this.#snapshot(tenantId, award, input.documentTypeCode);
    const contentHash = createHash('sha256').update(canonicalJson(snapshot)).digest('hex');

    // Render and sign from the frozen snapshot first, so the issue is stored with its PDF and signature (D-20).
    const issueId = randomUUID();
    const code = verificationCode();
    const issuedAt = clockNow();
    const priorCount = await withTenantContext(this.db, tenantId, async (tx) => {
      const [doc] = await tx.select({ id: studentDocuments.id }).from(studentDocuments).where(and(
        eq(studentDocuments.tenantId, tenantId as Uuid), eq(studentDocuments.awardId, award.id), eq(studentDocuments.documentTypeCode, input.documentTypeCode),
      )).limit(1);
      if (!doc) return 0;
      const prior = await tx.select({ n: documentIssues.issueNumber }).from(documentIssues).where(eq(documentIssues.studentDocumentId, doc.id));
      return prior.reduce((max, p) => Math.max(max, p.n), 0);
    });
    const tenantCode = await this.#tenantCode(tenantId);
    const rendered = await this.renderer.render({
      documentTypeCode: input.documentTypeCode, snapshot, issueNumber: priorCount + 1, issueTypeCode, verificationCode: code, issuedAt,
      institutionName: tenantCode.name, verificationUrl: `${this.publicBaseUrl}/public/v1/verify/${tenantCode.code}/${code}`,
    });
    const pdfSha256 = createHash('sha256').update(rendered.pdf).digest('hex');
    await this.#registerActiveKey(tenantId, actorId);
    const signature = await this.signer.sign(tenantId, { issueId, contentHash, pdfSha256, verificationCode: code });

    await withTenantContext(this.db, tenantId, async (tx) => {
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
      if (issueNumber !== priorCount + 1) throw new ConflictError('Another issue of this document was made at the same time; try again');
      const stored = await createPostgresDocumentAdapter(tx).store({
        tenantId, ownerService: 'award-documents', ownerRef: issueId, filename: `${input.documentTypeCode}-${issueNumber}.pdf`,
        mimeType: 'application/pdf', content: rendered.pdf, actorId,
      });
      await tx.insert(documentIssues).values({
        id: issueId, tenantId: tenantId as Uuid, studentDocumentId: doc.id, issueNumber, issueTypeCode, contentSnapshot: snapshot,
        contentHash, verificationCode: code, channelCode: input.channelCode, issuedBy: actorId, issuedAt,
        renderedDocumentId: stored.documentId as Uuid, templateCode: rendered.templateCode, templateVersion: rendered.templateVersion,
        pdfSha256, signingKeyId: signature.keyId, signatureJws: signature.jws,
      });
    });
    return this.getIssue(tenantId, issueId);
  }

  /** Revoking needs two people (D-20): a request, then a decision by someone else. */
  async requestRevocation(tenantId: string, issueId: string, input: { reasonCode: string; reasonText: string }, actorId: string): Promise<RevocationRequestDto> {
    if (!this.businessCases) throw new ValidationError('Revocation requests are not configured');
    await this.#code(tenantId, 'document_revocation', 'reason_code', input.reasonCode);
    const issue = await this.#issue(tenantId, issueId);
    if (issue.statusCode === 'revoked') throw new ConflictError('This issue is already revoked');
    if ((await this.listRevocationRequests(tenantId, { documentIssueId: issueId, open: true })).length > 0) throw new ConflictError('A revocation of this issue is already waiting for a decision');
    const caseId = await this.businessCases.openCase(tenantId, {
      subjectType: 'document_issue', subjectId: issueId, processId: DOCUMENT_REVOCATION_PROCESS_ID, statusCode: 'open', ownerId: actorId,
    }, actorId);
    await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: 'proposed', authorityActorId: actorId, reasonCode: input.reasonCode, reasonText: input.reasonText, effectiveAt: clockNow(),
    });
    return (await this.listRevocationRequests(tenantId, { documentIssueId: issueId })).find((r) => r.caseId === caseId)!;
  }

  async decideRevocation(tenantId: string, caseId: string, input: { outcome: 'approved' | 'rejected'; note?: string }, actorId: string): Promise<RevocationRequestDto> {
    if (!this.businessCases) throw new ValidationError('Revocation requests are not configured');
    const request = (await this.listRevocationRequests(tenantId)).find((r) => r.caseId === caseId);
    if (!request) throw new NotFoundError('Revocation request', caseId);
    if (request.statusCode !== 'open') throw new ConflictError('This revocation request has already been decided');
    if (request.requestedBy === actorId) throw new ConflictError('The person who asked for the revocation cannot decide it');
    if (input.outcome === 'approved') {
      await this.revoke(tenantId, request.documentIssueId, { reasonCode: request.reasonCode, reasonText: request.reasonText }, actorId);
    }
    await this.businessCases.recordDecision(caseId, tenantId, {
      decisionTypeCode: input.outcome, authorityActorId: actorId, ...(input.note?.trim() ? { reasonText: input.note.trim() } : {}), effectiveAt: clockNow(),
    });
    await this.businessCases.advanceCaseStatus(caseId, tenantId, input.outcome === 'approved' ? 'decided' : 'closed', actorId);
    return (await this.listRevocationRequests(tenantId)).find((r) => r.caseId === caseId)!;
  }

  async listRevocationRequests(tenantId: string, opts: { documentIssueId?: string; open?: boolean } = {}): Promise<RevocationRequestDto[]> {
    const { businessCases: bc, caseDecisions: cd } = await import('@revelation-srs/db');
    return withTenantContext(this.db, tenantId, async (tx) => {
      const cases = await tx.select().from(bc).where(and(
        eq(bc.tenantId, tenantId as Uuid), eq(bc.processId, DOCUMENT_REVOCATION_PROCESS_ID), isNull(bc.recordedUntil),
        ...(opts.documentIssueId ? [eq(bc.subjectId, opts.documentIssueId as Uuid)] : []),
        ...(opts.open ? [eq(bc.statusCode, 'open')] : []),
      ));
      if (cases.length === 0) return [];
      const records = await tx.select().from(cd).where(inArray(cd.businessCaseId, cases.map((c) => c.id)));
      return cases.flatMap((c) => {
        const proposal = records.find((r) => r.businessCaseId === c.id && r.decisionTypeCode === 'proposed');
        if (!proposal) return [];
        const decision = records.find((r) => r.businessCaseId === c.id && r.decisionTypeCode !== 'proposed');
        return [{
          caseId: c.id, documentIssueId: c.subjectId, statusCode: c.statusCode, reasonCode: proposal.reasonCode ?? '', reasonText: proposal.reasonText ?? '',
          requestedBy: proposal.authorityActorId, requestedAt: proposal.decidedAt,
          decision: decision ? { outcome: decision.decisionTypeCode, decidedBy: decision.authorityActorId, decidedAt: decision.decidedAt, note: decision.reasonText } : null,
        }];
      });
    });
  }

  /** Applies an approved revocation; called only from decideRevocation. */
  private async revoke(tenantId: string, issueId: string, input: { reasonCode: string; reasonText: string }, actorId: string): Promise<DocumentIssueDto> {
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
  async verify(tenantId: string, code: string, requestedBy: string, requesterNote?: string, opts: { ipHash?: string; discloseFacts?: boolean } = {}): Promise<VerificationResult> {
    const normalised = code.trim().toUpperCase().replace(/[\s-]/g, '');
    const [issue] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentIssues).where(and(
      eq(documentIssues.tenantId, tenantId as Uuid), eq(documentIssues.verificationCode, normalised),
    )).limit(1));
    const outcomeCode: VerificationResult['outcomeCode'] = !issue ? 'not-found'
      : issue.statusCode === 'revoked' ? 'revoked'
        : issue.statusCode === 'superseded' ? 'superseded' : 'valid';
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(documentVerifications).values({
      tenantId: tenantId as Uuid, documentIssueId: issue?.id ?? null, verificationCode: normalised,
      requestedBy, requesterNote: requesterNote ?? null, outcomeCode, methodCode: 'code', requesterIpHash: opts.ipHash ?? null,
    }));
    if (!issue || outcomeCode === 'revoked') return { outcomeCode, document: null };
    return this.#result(tenantId, issue, outcomeCode, opts.discloseFacts ?? true);
  }

  /** A third party uploads the PDF they were given: it is checked by its hash and not kept (D-21). */
  async verifyFile(tenantId: string, pdf: Buffer, requestedBy: string, opts: { ipHash?: string; discloseFacts?: boolean } = {}): Promise<VerificationResult> {
    const sha = createHash('sha256').update(pdf).digest('hex');
    const [issue] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentIssues).where(and(
      eq(documentIssues.tenantId, tenantId as Uuid), eq(documentIssues.pdfSha256, sha),
    )).limit(1));
    const outcomeCode: VerificationResult['outcomeCode'] = !issue ? 'not-found' : issue.statusCode === 'revoked' ? 'revoked' : issue.statusCode === 'superseded' ? 'superseded' : 'valid';
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(documentVerifications).values({
      tenantId: tenantId as Uuid, documentIssueId: issue?.id ?? null, verificationCode: issue?.verificationCode ?? '(file)',
      requestedBy, outcomeCode, methodCode: 'file', requesterIpHash: opts.ipHash ?? null,
    }));
    if (!issue || outcomeCode === 'revoked') return { outcomeCode, document: null };
    return this.#result(tenantId, issue, outcomeCode, opts.discloseFacts ?? true);
  }

  /** A staff check by name and date of birth, which needs the holder's recorded consent (D-21; HEDD practice). */
  async staffLookup(tenantId: string, input: { legalFamilyName: string; dateOfBirth: string; consentEvidenceRef: string }, actorId: string): Promise<VerificationResult[]> {
    if (!input.consentEvidenceRef.trim()) throw new ValidationError('Record the holder\'s consent before a lookup by name and date of birth');
    const issues = await withTenantContext(this.db, tenantId, async (tx) => {
      const people = await tx.select({ personId: personIdentities.personId }).from(personIdentities).where(and(
        eq(personIdentities.tenantId, tenantId as Uuid), isNull(personIdentities.recordedUntil), eq(personIdentities.dateOfBirth, input.dateOfBirth),
        sql`lower(${personIdentities.legalFamilyName}) = lower(${input.legalFamilyName.trim()})`,
      ));
      if (people.length === 0) return [];
      return tx.select({ issue: documentIssues }).from(documentIssues)
        .innerJoin(studentDocuments, eq(studentDocuments.id, documentIssues.studentDocumentId))
        .where(and(eq(documentIssues.tenantId, tenantId as Uuid), inArray(studentDocuments.personId, people.map((p) => p.personId)), eq(documentIssues.statusCode, 'issued')));
    });
    const out: VerificationResult[] = [];
    for (const { issue } of issues) {
      await withTenantContext(this.db, tenantId, (tx) => tx.insert(documentVerifications).values({
        tenantId: tenantId as Uuid, documentIssueId: issue.id, verificationCode: issue.verificationCode, requestedBy: actorId,
        outcomeCode: 'valid', methodCode: 'staff-lookup', consentEvidenceRef: input.consentEvidenceRef.trim(),
      }));
      out.push(await this.#result(tenantId, issue, 'valid', true));
    }
    return out;
  }

  /** The institution's public keys (D-20): active and retired, never a private key. */
  async jwks(tenantId: string): Promise<{ keys: Array<Record<string, unknown>> }> {
    const { createPublicKey } = await import('node:crypto');
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentSigningKeys).where(eq(documentSigningKeys.tenantId, tenantId as Uuid)));
    return {
      keys: rows.filter((k) => k.statusCode !== 'compromised').map((k) => ({
        ...createPublicKey(k.publicKeyPem).export({ format: 'jwk' }), kid: k.keyId, alg: k.algorithm, use: 'sig', status: k.statusCode,
      })),
    };
  }

  async listSigningKeys(tenantId: string) {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentSigningKeys).where(eq(documentSigningKeys.tenantId, tenantId as Uuid)).orderBy(desc(documentSigningKeys.registeredAt)));
  }

  /**
   * Retires a key (it stays published, so documents it signed still verify) or
   * marks it compromised (verification then reports the issuer withdrew it,
   * and the affected issues are listed for re-issue).
   */
  async setSigningKeyStatus(tenantId: string, keyId: string, statusCode: 'retired' | 'compromised', actorId: string): Promise<{ keyId: string; statusCode: string; affectedIssueIds: string[] }> {
    void actorId;
    const now = clockNow();
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(documentSigningKeys).set(
      statusCode === 'retired' ? { statusCode, retiredAt: now } : { statusCode, compromisedAt: now },
    ).where(and(eq(documentSigningKeys.tenantId, tenantId as Uuid), eq(documentSigningKeys.keyId, keyId))).returning());
    if (!row) throw new NotFoundError('Signing key', keyId);
    const affected = await withTenantContext(this.db, tenantId, (tx) => tx.select({ id: documentIssues.id }).from(documentIssues).where(and(
      eq(documentIssues.tenantId, tenantId as Uuid), eq(documentIssues.signingKeyId, keyId), eq(documentIssues.statusCode, 'issued'),
    )));
    return { keyId, statusCode: row.statusCode, affectedIssueIds: statusCode === 'compromised' ? affected.map((a) => a.id) : [] };
  }

  /** The stored PDF of an issue. */
  async pdf(tenantId: string, issueId: string, actorId: string): Promise<{ filename: string; content: Buffer }> {
    const issue = await this.#issue(tenantId, issueId);
    if (!issue.renderedDocumentId) throw new NotFoundError('Rendered document', issueId);
    const doc = await withTenantContext(this.db, tenantId, (tx) => createPostgresDocumentAdapter(tx).retrieve(tenantId, issue.renderedDocumentId!, actorId));
    return { filename: doc.filename, content: doc.content };
  }

  /** The person an issue belongs to, for ownership checks. */
  async personForIssue(tenantId: string, issueId: string): Promise<string> {
    return (await this.getIssue(tenantId, issueId)).personId;
  }

  async #result(tenantId: string, issue: DocumentIssue, outcomeCode: VerificationResult['outcomeCode'], discloseFacts: boolean): Promise<VerificationResult> {
    const signature = await this.#checkSignature(tenantId, issue);
    const issuer = (await this.#tenantCode(tenantId)).name;
    if (!discloseFacts) return { outcomeCode, document: null, signature, issuer };
    const s = issue.contentSnapshot as Record<string, string>;
    return {
      outcomeCode, signature, issuer,
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
        personId: doc.personId,
        rendered: i.renderedDocumentId ? {
          documentId: i.renderedDocumentId, templateCode: i.templateCode ?? '', templateVersion: i.templateVersion ?? '', pdfSha256: i.pdfSha256 ?? '', signingKeyId: i.signingKeyId,
        } : null,
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
  async #snapshot(tenantId: string, award: Award, documentTypeCode: string): Promise<Record<string, unknown>> {
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
      // A transcript or HEAR states the module results the HEAR gathered (D-20); generate the HEAR first.
      ...(documentTypeCode === 'transcript' || documentTypeCode === 'hear' ? { moduleResults: this.#moduleResults(award) } : {}),
    };
  }

  #moduleResults(award: Award): unknown[] {
    const hear = award.hearDocument as { moduleResults?: unknown[] } | null;
    if (!hear?.moduleResults) throw new ValidationError('Generate the HEAR for this award first: a transcript states the module results it gathers (BP-06-004 E1)');
    return hear.moduleResults;
  }

  async #issue(tenantId: string, issueId: string): Promise<DocumentIssue> {
    const [issue] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentIssues).where(and(
      eq(documentIssues.id, issueId as Uuid), eq(documentIssues.tenantId, tenantId as Uuid),
    )).limit(1));
    if (!issue) throw new NotFoundError('DocumentIssue', issueId);
    return issue;
  }

  async #checkSignature(tenantId: string, issue: DocumentIssue): Promise<SignatureCheck> {
    if (!issue.signatureJws || !issue.signingKeyId || !issue.pdfSha256) return { status: 'unsigned', keyId: null };
    const [key] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(documentSigningKeys).where(and(
      eq(documentSigningKeys.tenantId, tenantId as Uuid), eq(documentSigningKeys.keyId, issue.signingKeyId!),
    )).limit(1));
    if (!key) return { status: 'invalid', keyId: issue.signingKeyId };
    if (key.statusCode === 'compromised') return { status: 'key-withdrawn', keyId: key.keyId };
    const ok = verifyDetached(issue.signatureJws, { issueId: issue.id, contentHash: issue.contentHash, pdfSha256: issue.pdfSha256, verificationCode: issue.verificationCode }, key.publicKeyPem);
    return { status: ok ? 'valid' : 'invalid', keyId: key.keyId };
  }

  /** The signer's current key is registered so verifiers can find it (idempotent). */
  async #registerActiveKey(tenantId: string, actorId: string): Promise<void> {
    const { keyId, publicKeyPem } = await this.signer.activeKey(tenantId);
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(documentSigningKeys).values({
      tenantId: tenantId as Uuid, keyId, publicKeyPem, providerCode: this.signer.provider, registeredBy: actorId,
    }).onConflictDoNothing());
  }

  async #tenantCode(tenantId: string): Promise<{ code: string; name: string }> {
    const [row] = await this.db.select({ code: tenants.code, name: tenants.name }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    return { code: row?.code ?? tenantId, name: row?.name ?? 'Institution' };
  }

  async #code(tenantId: string, entity: string, field: string, value: string): Promise<void> {
    if ((await this.valueSets.validateFieldValue(entity, field, value, tenantId)) === false) {
      throw new ValidationError(`Invalid value '${value}' for ${entity}.${field}`, [{ field, message: 'Value is not active in the configured value set' }]);
    }
  }
}

/** 12 characters from the 30-character alphabet, without modulo bias (rejection sampling). */
function verificationCode(): string {
  const limit = 256 - (256 % CODE_ALPHABET.length);
  let out = '';
  while (out.length < 12) {
    for (const b of randomBytes(16)) {
      if (b < limit && out.length < 12) out += CODE_ALPHABET[b % CODE_ALPHABET.length];
    }
  }
  return out;
}

function canonicalJson(value: Record<string, unknown>): string {
  return JSON.stringify(Object.keys(value).sort().reduce<Record<string, unknown>>((acc, k) => { acc[k] = value[k]; return acc; }, {}));
}
