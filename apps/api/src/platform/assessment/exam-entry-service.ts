import { createHash, randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  enrolments,
  examBoardCandidateProfiles,
  examBoardDataPacks,
  examBoards,
  examEntries,
  examTimetableReceipts,
  moduleRegistrations,
  type Db,
  type ExamEntry,
  withTenantContext,
} from '@revelation-srs/db';
import {
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type GovernanceExamEntrySubmittedV1Payload,
  type GovernanceExamScheduleReceivedV1Payload,
} from '@revelation-srs/domain';

import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { RegulatoryExchangeService } from '../regulatory/exchange-service.js';

interface CandidateProfileRow {
  enrolmentId: string;
  personId: string;
  profileData: Record<string, unknown>;
}

interface EntryWithOwnerRow {
  entry: ExamEntry;
  personId: string;
}

export interface ExamEntryDto {
  examEntryId: string;
  moduleRegistrationId: string;
  examBoardId: string;
  candidateNumber: string | null;
  scheduledDate: string | null;
  roomReference: string | null;
  statusCode: string;
  accommodations: Record<string, unknown>;
  validFrom: Date;
  recordedAt: Date;
}

export interface ExamTimetableDto extends ExamEntryDto {
  personId: string;
}

export interface ExamScheduleCandidateInput {
  moduleRegistrationId: string;
  candidateNumber: string;
  scheduledDate: string;
  room: string;
}

export interface ExamScheduleInput {
  candidates: ExamScheduleCandidateInput[];
}

export class ExamEntryService {
  private readonly exchanges: RegulatoryExchangeService;

  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    exchanges?: RegulatoryExchangeService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async generateExamEntries(
    examBoardId: string,
    tenantId: string,
    actorId: string,
  ): Promise<{ entryCount: number; entries: ExamEntryDto[] }> {
    await this.#requireExamBoard(examBoardId, tenantId);
    const dataPack = await this.#requireCurrentDataPack(examBoardId, tenantId);
    const candidates = await this.#loadCandidateProfiles(dataPack.id, tenantId);
    const now = new Date();
    const created: ExamEntryDto[] = [];

    for (const candidate of candidates) {
      const registrations = extractModuleRegistrations(candidate.profileData);
      const accommodations = extractAccommodations(candidate.profileData);

      for (const registration of registrations) {
        const existing = await this.#getCurrentEntryForBoard(registration.moduleRegistrationId, examBoardId, tenantId);
        if (existing) continue;

        const entryId = randomUUID();
        await withTenantContext(this.db, tenantId, async (tx) => {
          await tx.insert(examEntries).values({
            versionId: randomUUID(),
            id: entryId,
            tenantId,
            moduleRegistrationId: registration.moduleRegistrationId,
            examBoardId,
            candidateNumber: null,
            scheduledDate: null,
            roomReference: null,
            statusCode: 'pending',
            accommodations,
            validFrom: now,
            validTo: null,
            recordedAt: now,
            recordedUntil: null,
          });
        });

        created.push({
          examEntryId: entryId,
          moduleRegistrationId: registration.moduleRegistrationId,
          examBoardId,
          candidateNumber: null,
          scheduledDate: null,
          roomReference: null,
          statusCode: 'pending',
          accommodations,
          validFrom: now,
          recordedAt: now,
        });
      }
    }

    await this.exchanges.recordExchange(
      tenantId,
      'exam-scheduling.v1',
      {
        directionCode: 'outbound',
        exchangeTypeCode: 'exam-entry-submission',
        idempotencyKey: `exam-entries:${examBoardId}`,
        payloadHash: hashPayload({ examBoardId, entryIds: created.map((entry) => entry.examEntryId) }),
        payloadSummary: { examBoardId, entryCount: created.length },
      },
      actorId,
    );

    await this.#publishEntriesSubmitted(tenantId, actorId, {
      examBoardId,
      entryCount: created.length,
      submittedAt: now.toISOString(),
    });

    return { entryCount: created.length, entries: created };
  }

  async processScheduleData(
    examBoardId: string,
    tenantId: string,
    payload: ExamScheduleInput,
    actorId: string,
  ): Promise<{ receiptId: string; updatedCount: number }> {
    await this.#requireExamBoard(examBoardId, tenantId);
    const now = new Date();
    let receiptId = '';

    await withTenantContext(this.db, tenantId, async (tx) => {
      const inserted = await tx
        .insert(examTimetableReceipts)
        .values({
          id: randomUUID(),
          tenantId,
          examBoardId,
          receivedAt: now,
          receivedBy: actorId,
          payload: payload as unknown as Record<string, unknown>,
        })
        .returning({ id: examTimetableReceipts.id });
      receiptId = inserted[0]!.id;
    });

    let updatedCount = 0;
    for (const candidate of payload.candidates) {
      const updated = await this.#scheduleEntry(examBoardId, tenantId, candidate);
      if (updated) updatedCount += 1;
    }

    await this.exchanges.recordExchange(
      tenantId,
      'exam-scheduling.v1',
      {
        directionCode: 'inbound',
        exchangeTypeCode: 'exam-schedule',
        idempotencyKey: `exam-schedule:${examBoardId}:${receiptId}`,
        payloadHash: hashPayload(payload),
        payloadSummary: { examBoardId, receiptId, candidateCount: payload.candidates.length },
      },
      actorId,
    );

    await this.#publishScheduleReceived(tenantId, actorId, {
      examBoardId,
      receiptId,
      candidateCount: payload.candidates.length,
      receivedAt: now.toISOString(),
    });

    return { receiptId, updatedCount };
  }

  async listExamEntries(examBoardId: string, tenantId: string): Promise<ExamEntryDto[]> {
    await this.#requireExamBoard(examBoardId, tenantId);
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(examEntries)
        .where(
          and(
            eq(examEntries.examBoardId, examBoardId),
            eq(examEntries.tenantId, tenantId),
            isNull(examEntries.recordedUntil),
          ),
        ),
    );
    return rows.map(toDto);
  }

  async getExamEntry(moduleRegistrationId: string, tenantId: string): Promise<ExamEntryDto> {
    const entry = await this.#getCurrentEntry(moduleRegistrationId, tenantId);
    if (!entry) throw new NotFoundError('Exam entry', moduleRegistrationId);
    return toDto(entry);
  }

  async getExamTimetable(moduleRegistrationId: string, tenantId: string): Promise<ExamTimetableDto> {
    const row = await this.#getCurrentEntryWithOwner(moduleRegistrationId, tenantId);
    if (!row || row.entry.statusCode !== 'scheduled' || !row.entry.scheduledDate) {
      throw new NotFoundError('Exam timetable', moduleRegistrationId);
    }
    return { ...toDto(row.entry), personId: row.personId };
  }

  async #scheduleEntry(
    examBoardId: string,
    tenantId: string,
    candidate: ExamScheduleCandidateInput,
  ): Promise<boolean> {
    const current = await this.#getCurrentEntryForBoard(candidate.moduleRegistrationId, examBoardId, tenantId);
    if (!current) throw new NotFoundError('Exam entry', candidate.moduleRegistrationId);

    const closedRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(examEntries)
        .set({ recordedUntil: sql`NOW()` })
        .where(
          and(
            eq(examEntries.id, current.id),
            eq(examEntries.tenantId, tenantId),
            isNull(examEntries.recordedUntil),
          ),
        )
        .returning(),
    );
    const closed = closedRows[0];
    if (!closed) return false;

    const recordedAt = closed.recordedUntil ?? new Date();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(examEntries).values({
        versionId: randomUUID(),
        id: closed.id,
        tenantId,
        moduleRegistrationId: closed.moduleRegistrationId,
        examBoardId: closed.examBoardId,
        candidateNumber: candidate.candidateNumber,
        scheduledDate: candidate.scheduledDate,
        roomReference: candidate.room,
        statusCode: 'scheduled',
        accommodations: closed.accommodations,
        validFrom: closed.validFrom,
        validTo: closed.validTo,
        recordedAt,
        recordedUntil: null,
      });
    });

    return true;
  }

  async #requireExamBoard(examBoardId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: examBoards.id })
        .from(examBoards)
        .where(and(eq(examBoards.id, examBoardId), eq(examBoards.tenantId, tenantId)))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Exam board', examBoardId);
  }

  async #requireCurrentDataPack(examBoardId: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(examBoardDataPacks)
        .where(
          and(
            eq(examBoardDataPacks.examBoardId, examBoardId),
            eq(examBoardDataPacks.tenantId, tenantId),
            isNull(examBoardDataPacks.supersededById),
          ),
        )
        .limit(1),
    );
    if (!rows[0]) {
      throw new ValidationError('A current exam board data pack is required before exam entries can be generated');
    }
    return rows[0];
  }

  async #loadCandidateProfiles(dataPackId: string, tenantId: string): Promise<CandidateProfileRow[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(examBoardCandidateProfiles)
        .where(and(eq(examBoardCandidateProfiles.dataPackId, dataPackId), eq(examBoardCandidateProfiles.tenantId, tenantId))),
    );
    return rows.map((row) => ({
      enrolmentId: row.enrolmentId,
      personId: row.personId,
      profileData: row.profileData as Record<string, unknown>,
    }));
  }

  async #getCurrentEntryForBoard(
    moduleRegistrationId: string,
    examBoardId: string,
    tenantId: string,
  ): Promise<ExamEntry | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(examEntries)
        .where(
          and(
            eq(examEntries.moduleRegistrationId, moduleRegistrationId),
            eq(examEntries.examBoardId, examBoardId),
            eq(examEntries.tenantId, tenantId),
            isNull(examEntries.recordedUntil),
          ),
        )
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async #getCurrentEntry(moduleRegistrationId: string, tenantId: string): Promise<ExamEntry | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(examEntries)
        .where(
          and(
            eq(examEntries.moduleRegistrationId, moduleRegistrationId),
            eq(examEntries.tenantId, tenantId),
            isNull(examEntries.recordedUntil),
          ),
        )
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async #getCurrentEntryWithOwner(moduleRegistrationId: string, tenantId: string): Promise<EntryWithOwnerRow | null> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ entry: examEntries, personId: enrolments.personId })
        .from(examEntries)
        .innerJoin(
          moduleRegistrations,
          and(
            eq(moduleRegistrations.id, examEntries.moduleRegistrationId),
            eq(moduleRegistrations.tenantId, tenantId),
            isNull(moduleRegistrations.recordedUntil),
          ),
        )
        .innerJoin(
          enrolments,
          and(
            eq(enrolments.id, moduleRegistrations.enrolmentId),
            eq(enrolments.tenantId, tenantId),
            isNull(enrolments.recordedUntil),
          ),
        )
        .where(
          and(
            eq(examEntries.moduleRegistrationId, moduleRegistrationId),
            eq(examEntries.tenantId, tenantId),
            isNull(examEntries.recordedUntil),
          ),
        )
        .limit(1),
    );
    return rows[0] ?? null;
  }

  async #publishEntriesSubmitted(
    tenantId: string,
    actorId: string,
    payload: GovernanceExamEntrySubmittedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.GOVERNANCE_EXAM_ENTRY_SUBMITTED, '1.0.0', tenantId, actorId, 'standard', payload);
  }

  async #publishScheduleReceived(
    tenantId: string,
    actorId: string,
    payload: GovernanceExamScheduleReceivedV1Payload,
  ): Promise<void> {
    if (!this.eventBus.isConnected()) return;
    await this.eventBus.publish(EVENT_TYPES.GOVERNANCE_EXAM_SCHEDULE_RECEIVED, '1.0.0', tenantId, actorId, 'standard', payload);
  }
}

function extractModuleRegistrations(profileData: Record<string, unknown>): Array<{ moduleRegistrationId: string }> {
  const registrations = profileData['moduleRegistrations'];
  if (!Array.isArray(registrations)) return [];
  return registrations
    .map((registration) => {
      if (!registration || typeof registration !== 'object') return null;
      const moduleRegistrationId = (registration as Record<string, unknown>)['moduleRegistrationId'];
      return typeof moduleRegistrationId === 'string' ? { moduleRegistrationId } : null;
    })
    .filter((registration): registration is { moduleRegistrationId: string } => Boolean(registration));
}

function extractAccommodations(profileData: Record<string, unknown>): Record<string, unknown> {
  const adjustments = profileData['adjustments'];
  if (!Array.isArray(adjustments)) return { adjustments: [] };
  return {
    adjustments: adjustments
      .map((adjustment) => {
        if (!adjustment || typeof adjustment !== 'object') return null;
        const record = adjustment as Record<string, unknown>;
        const adjustmentTypeCode = record['adjustmentTypeCode'];
        const scopeCode = record['scopeCode'];
        if (typeof adjustmentTypeCode !== 'string' || typeof scopeCode !== 'string') return null;
        if (scopeCode !== 'exam' && scopeCode !== 'all') return null;
        return { adjustmentTypeCode, scopeCode };
      })
      .filter(Boolean),
  };
}

function toDto(row: ExamEntry): ExamEntryDto {
  return {
    examEntryId: row.id,
    moduleRegistrationId: row.moduleRegistrationId,
    examBoardId: row.examBoardId,
    candidateNumber: row.candidateNumber,
    scheduledDate: row.scheduledDate,
    roomReference: row.roomReference,
    statusCode: row.statusCode,
    accommodations: row.accommodations,
    validFrom: row.validFrom,
    recordedAt: row.recordedAt,
  };
}

function hashPayload(payload: unknown): string {
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
