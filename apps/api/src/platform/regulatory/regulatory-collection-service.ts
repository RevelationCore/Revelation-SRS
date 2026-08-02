import { randomUUID } from 'node:crypto';

import { and, desc, eq } from 'drizzle-orm';
import {
  regulatoryCollections,
  collectionSnapshots,
  regulatoryRecords,
  regulatoryFieldLineages,
  regulatoryValidationIssues,
  regulatorySignoffs,
  regulatorySubmissions,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

/**
 * Regulatory collection & lineage (BPR-D16). Generic, regulator-neutral
 * model — HESA/OfS keep their bespoke tables and services; this is the
 * model SFC (Scotland), Medr (Wales) and DfE-NI collections use directly,
 * and that HESA/OfS can optionally bridge into via regulatoryCollectionId.
 */

export interface CreateCollectionInput {
  regulatorCode:       string;
  collectionTypeCode:  string;
  academicYear:        string;
}

export interface RecordSnapshotInput {
  sourceTransactionTime: Date;
}

export interface AddRecordInput {
  enrolmentId?:   string;
  recordPayload:  Record<string, unknown>;
}

export interface AddValidationIssueInput {
  regulatoryRecordId?: string;
  severityCode:        string;
  fieldCode?:          string;
  message:             string;
}

export interface RegulatoryCollectionDto {
  regulatoryCollectionId: string;
  regulatorCode:          string;
  collectionTypeCode:     string;
  academicYear:           string;
  statusCode:             string;
  createdAt:              Date;
  createdBy:              string;
}

export class RegulatoryCollectionService {
  constructor(private readonly db: Db) {}

  async createCollection(tenantId: string, input: CreateCollectionInput, createdBy: string): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(regulatoryCollections).values({
        id,
        tenantId:           tenantId as Uuid,
        regulatorCode:      input.regulatorCode,
        collectionTypeCode: input.collectionTypeCode,
        academicYear:       input.academicYear,
        statusCode:         'draft',
        createdAt:          clockNow(),
        createdBy,
      });
    });
    return id;
  }

  async createSnapshot(tenantId: string, regulatoryCollectionId: string, input: RecordSnapshotInput, generatedBy: string): Promise<string> {
    await this.#ensureCollectionExists(tenantId, regulatoryCollectionId);

    const priorSnapshots = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(collectionSnapshots).where(and(
        eq(collectionSnapshots.regulatoryCollectionId, regulatoryCollectionId as Uuid),
        eq(collectionSnapshots.tenantId,                tenantId               as Uuid),
      )).orderBy(desc(collectionSnapshots.snapshotVersion)).limit(1),
    );
    const nextVersion = (priorSnapshots[0]?.snapshotVersion ?? 0) + 1;

    const snapshotId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(collectionSnapshots).values({
        id:                     snapshotId,
        tenantId:               tenantId as Uuid,
        regulatoryCollectionId: regulatoryCollectionId as Uuid,
        snapshotVersion:        nextVersion,
        sourceTransactionTime:  input.sourceTransactionTime,
        generatedAt:            clockNow(),
        generatedBy,
      });
    });
    return snapshotId;
  }

  async addRecord(tenantId: string, collectionSnapshotId: string, input: AddRecordInput): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(regulatoryRecords).values({
        id,
        tenantId:              tenantId as Uuid,
        collectionSnapshotId:  collectionSnapshotId as Uuid,
        enrolmentId:           input.enrolmentId ? (input.enrolmentId as Uuid) : null,
        recordPayload:         input.recordPayload,
        createdAt:             clockNow(),
      });
    });
    return id;
  }

  async recordFieldLineage(
    tenantId: string,
    regulatoryRecordId: string,
    fieldCode: string,
    sourceEntityType: string,
    sourceEntityId: string,
    sourceVersionId?: string,
    transformCode?: string,
  ): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(regulatoryFieldLineages).values({
        id,
        tenantId:            tenantId as Uuid,
        regulatoryRecordId:  regulatoryRecordId as Uuid,
        fieldCode,
        sourceEntityType,
        sourceEntityId:      sourceEntityId as Uuid,
        sourceVersionId:     sourceVersionId ? (sourceVersionId as Uuid) : null,
        transformCode:       transformCode ?? null,
      });
    });
    return id;
  }

  async addValidationIssue(tenantId: string, regulatoryCollectionId: string, input: AddValidationIssueInput): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(regulatoryValidationIssues).values({
        id,
        tenantId:               tenantId as Uuid,
        regulatoryCollectionId: regulatoryCollectionId as Uuid,
        regulatoryRecordId:     input.regulatoryRecordId ? (input.regulatoryRecordId as Uuid) : null,
        severityCode:           input.severityCode,
        fieldCode:              input.fieldCode ?? null,
        message:                input.message,
        createdAt:              clockNow(),
      });
    });
    return id;
  }

  async signOff(tenantId: string, regulatoryCollectionId: string, signedOffBy: string, commentary?: string): Promise<string> {
    const collection = await this.#ensureCollectionExists(tenantId, regulatoryCollectionId);

    const blockingIssues = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select({ id: regulatoryValidationIssues.id }).from(regulatoryValidationIssues).where(and(
        eq(regulatoryValidationIssues.regulatoryCollectionId, regulatoryCollectionId as Uuid),
        eq(regulatoryValidationIssues.tenantId,                tenantId               as Uuid),
        eq(regulatoryValidationIssues.severityCode,            'blocking'),
      )),
    );
    if (blockingIssues.length > 0) {
      throw new ValidationError(`Collection '${regulatoryCollectionId}' has ${blockingIssues.length} blocking validation issue(s)`);
    }

    const signoffId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(regulatorySignoffs).values({
        id:                     signoffId,
        tenantId:               tenantId as Uuid,
        regulatoryCollectionId: regulatoryCollectionId as Uuid,
        signedOffBy,
        signedOffAt:            clockNow(),
        commentary:             commentary ?? null,
      });

      await tx.update(regulatoryCollections)
        .set({ statusCode: 'signed-off' })
        .where(and(
          eq(regulatoryCollections.id,       regulatoryCollectionId as Uuid),
          eq(regulatoryCollections.tenantId, tenantId               as Uuid),
        ));
    });
    void collection;
    return signoffId;
  }

  async submit(tenantId: string, regulatoryCollectionId: string, collectionSnapshotId: string, submittedBy: string, submissionReference?: string): Promise<string> {
    await this.#ensureCollectionExists(tenantId, regulatoryCollectionId);

    const submissionId = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(regulatorySubmissions).values({
        id:                     submissionId,
        tenantId:               tenantId as Uuid,
        regulatoryCollectionId: regulatoryCollectionId as Uuid,
        collectionSnapshotId:   collectionSnapshotId as Uuid,
        distributionItemId:     null,
        submittedAt:            clockNow(),
        submittedBy,
        submissionReference:    submissionReference ?? null,
      });

      await tx.update(regulatoryCollections)
        .set({ statusCode: 'submitted' })
        .where(and(
          eq(regulatoryCollections.id,       regulatoryCollectionId as Uuid),
          eq(regulatoryCollections.tenantId, tenantId               as Uuid),
        ));
    });
    return submissionId;
  }

  /** Lists regulatory collections, optionally filtered by regulator and/or academic year. */
  async listCollections(tenantId: string, opts: { regulatorCode?: string; academicYear?: string } = {}): Promise<RegulatoryCollectionDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(regulatoryCollections).where(and(
        eq(regulatoryCollections.tenantId, tenantId as Uuid),
        ...(opts.regulatorCode ? [eq(regulatoryCollections.regulatorCode, opts.regulatorCode)] : []),
        ...(opts.academicYear  ? [eq(regulatoryCollections.academicYear,  opts.academicYear)]  : []),
      )).orderBy(desc(regulatoryCollections.createdAt)),
    );
    return rows.map((row) => ({
      regulatoryCollectionId: row.id,
      regulatorCode:          row.regulatorCode,
      collectionTypeCode:     row.collectionTypeCode,
      academicYear:           row.academicYear,
      statusCode:             row.statusCode,
      createdAt:              row.createdAt,
      createdBy:              row.createdBy,
    }));
  }

  async #ensureCollectionExists(tenantId: string, regulatoryCollectionId: string): Promise<typeof regulatoryCollections.$inferSelect> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select().from(regulatoryCollections).where(and(
        eq(regulatoryCollections.id,       regulatoryCollectionId as Uuid),
        eq(regulatoryCollections.tenantId, tenantId               as Uuid),
      )).limit(1),
    );
    const collection = rows[0];
    if (!collection) throw new NotFoundError('RegulatoryCollection', regulatoryCollectionId);
    return collection;
  }
}
