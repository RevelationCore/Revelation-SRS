import { createHash, randomUUID } from 'node:crypto';

import { and, eq, inArray, isNull, sql } from 'drizzle-orm';
import {
  adjustmentDistributions,
  assessmentComponents,
  enrolments,
  examBoardCandidateProfiles,
  examBoardDataPacks,
  examBoards,
  examEntries,
  examTimetableReceipts,
  moduleRegistrations,
  reasonableAdjustments,
  type Db,
  type ExamEntry,
  withTenantContext,
} from '@revelation-srs/db';
import {
  ConflictError,
  EVENT_TYPES,
  NotFoundError,
  ValidationError,
  type GovernanceExamEntrySubmittedV1Payload,
  type GovernanceExamScheduleReceivedV1Payload,
} from '@revelation-srs/domain';

import type { AdjustmentService } from '../adjustments/adjustment-service.js';
import type { IntegrationBusPublisher } from '../integration-bus/publisher.js';
import { RegulatoryExchangeService } from '../regulatory/exchange-service.js';
import { clockNow } from '../clock.js';

import {
  NO_AMOUNT_REASON,
  buildExamAccommodations,
  isExamAccommodations,
  withoutAdjustment,
  type ExamComponent,
  type InForceAdjustment,
} from './exam-accommodations.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

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

  /**
   * The SRS is the 'exams' target for adjustment distributions: an exam
   * entry carries the candidate's in-force adjustments with the time they
   * are entitled to, the schedule returned by the timetabling system is the
   * delivery confirmation, and a withdrawal removes the arrangement from
   * entries for exams not yet sat. `adjustments` records those outcomes on
   * the distribution ledger.
   */
  constructor(
    private readonly db: Db,
    private readonly eventBus: IntegrationBusPublisher,
    exchanges?: RegulatoryExchangeService,
    private readonly adjustments?: AdjustmentService,
  ) {
    this.exchanges = exchanges ?? new RegulatoryExchangeService(db);
  }

  async generateExamEntries(
    examBoardId: string,
    tenantId: string,
    actorId: string,
  ): Promise<{ entryCount: number; entries: ExamEntryDto[] }> {
    const board = await this.#requireExamBoard(examBoardId, tenantId);
    const dataPack = await this.#requireCurrentDataPack(examBoardId, tenantId);
    const candidates = await this.#loadCandidateProfiles(dataPack.id, tenantId);
    const now = clockNow();
    // Same rule as the board pack: adjustments in force on the board's date.
    const contextDate = board.meetingDate ? new Date(`${board.meetingDate}T00:00:00.000Z`) : now;
    const created: ExamEntryDto[] = [];

    for (const candidate of candidates) {
      const registrations = extractModuleRegistrations(candidate.profileData);
      const inForce = await this.#loadInForceAdjustments(candidate.enrolmentId, tenantId, contextDate);

      for (const registration of registrations) {
        const existing = await this.#getCurrentEntryForBoard(registration.moduleRegistrationId, examBoardId, tenantId);
        if (existing) continue;

        const built = buildExamAccommodations(inForce, await this.#loadExamComponents(registration.moduleRegistrationId, tenantId));
        const accommodations = built as unknown as Record<string, unknown>;
        // A time adjustment with no amount cannot be stated on the entry:
        // tell the distribution ledger, so the gap is owned, not silent.
        for (const a of built.adjustments) {
          if (!a.applied && a.reason === NO_AMOUNT_REASON && a.distributionId) {
            await this.#reportExamsFailure(a.adjustmentId, a.distributionId, tenantId, a.reason);
          }
        }

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
    const now = clockNow();
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
      const scheduled = await this.#scheduleEntry(examBoardId, tenantId, candidate);
      if (!scheduled) continue;
      updatedCount += 1;
      // The timetabling system has scheduled an entry carrying these
      // arrangements: that is the exams target's delivery confirmation.
      await this.#acknowledgeExamsDelivery(scheduled.accommodations, tenantId);
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
    if (!row) {
      throw new NotFoundError('Exam timetable', moduleRegistrationId);
    }
    return { ...toDto(row.entry), personId: row.personId };
  }

  async #scheduleEntry(
    examBoardId: string,
    tenantId: string,
    candidate: ExamScheduleCandidateInput,
  ): Promise<ExamEntry | null> {
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
    if (!closed) return null;

    const recordedAt = closed.recordedUntil ?? clockNow();
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

    return closed;
  }

  /**
   * Act on 'exams' withdrawal instructions: remove each ended adjustment from
   * the entries for exams not yet sat (unscheduled, or scheduled on or after
   * the adjustment's end), keeping it on entries for exams already sat —
   * expiry does not rewrite past arrangements (AJ-21) — and confirm the
   * withdrawal. Called after an expiry and by the worker's reconcile loop.
   */
  async applyExamWithdrawals(tenantId: string): Promise<number> {
    if (!this.adjustments) return 0;
    const due = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          distributionId: adjustmentDistributions.id,
          adjustmentId: adjustmentDistributions.adjustmentId,
          validTo: reasonableAdjustments.validTo,
          withdrawalRequestedAt: adjustmentDistributions.withdrawalRequestedAt,
        })
        .from(adjustmentDistributions)
        .innerJoin(reasonableAdjustments, and(
          eq(reasonableAdjustments.id, adjustmentDistributions.adjustmentId),
          eq(reasonableAdjustments.tenantId, adjustmentDistributions.tenantId),
          isNull(reasonableAdjustments.recordedUntil),
        ))
        .where(and(
          eq(adjustmentDistributions.tenantId, tenantId as Uuid),
          eq(adjustmentDistributions.targetSystem, 'exams'),
          eq(adjustmentDistributions.fulfilmentModeCode, 'file'),
          eq(adjustmentDistributions.statusCode, 'withdrawal-requested'),
        )),
    );

    let withdrawn = 0;
    for (const d of due) {
      const endedAt = d.validTo ?? d.withdrawalRequestedAt ?? clockNow();
      const endDate = endedAt.toISOString().slice(0, 10);
      const entries = await withTenantContext(this.db, tenantId, async (tx) =>
        tx
          .select()
          .from(examEntries)
          .where(and(
            eq(examEntries.tenantId, tenantId),
            isNull(examEntries.recordedUntil),
            sql`${examEntries.accommodations} -> 'adjustments' @> ${JSON.stringify([{ adjustmentId: d.adjustmentId }])}::jsonb`,
            sql`(${examEntries.scheduledDate} IS NULL OR ${examEntries.scheduledDate} >= ${endDate})`,
          )),
      );
      for (const entry of entries) {
        if (!isExamAccommodations(entry.accommodations)) continue;
        await this.#replaceAccommodations(entry, tenantId, withoutAdjustment(entry.accommodations, d.adjustmentId) as unknown as Record<string, unknown>);
      }
      try {
        await this.adjustments.acknowledgeWithdrawal(d.adjustmentId, d.distributionId, tenantId, 'exams');
        withdrawn += 1;
      } catch (err) {
        if (!(err instanceof ConflictError)) throw err;
      }
    }
    return withdrawn;
  }

  async #replaceAccommodations(entry: ExamEntry, tenantId: string, accommodations: Record<string, unknown>): Promise<void> {
    await withTenantContext(this.db, tenantId, async (tx) => {
      const now = clockNow();
      const closed = await tx
        .update(examEntries)
        .set({ recordedUntil: now })
        .where(and(eq(examEntries.versionId, entry.versionId), isNull(examEntries.recordedUntil)))
        .returning({ versionId: examEntries.versionId });
      if (closed.length === 0) return; // changed concurrently; the next run re-checks
      await tx.insert(examEntries).values({
        ...entry,
        versionId: randomUUID(),
        accommodations,
        recordedAt: now,
        recordedUntil: null,
      });
    });
  }

  /** The enrolment's adjustments in force at `at`, with their 'exams' distribution. */
  async #loadInForceAdjustments(enrolmentId: string, tenantId: string, at: Date): Promise<InForceAdjustment[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({
          adjustmentId: reasonableAdjustments.id,
          adjustmentTypeCode: reasonableAdjustments.adjustmentTypeCode,
          scopeCode: reasonableAdjustments.scopeCode,
          amountValue: reasonableAdjustments.amountValue,
          amountUnitCode: reasonableAdjustments.amountUnitCode,
          validFrom: reasonableAdjustments.validFrom,
          validTo: reasonableAdjustments.validTo,
          distributionId: adjustmentDistributions.id,
        })
        .from(reasonableAdjustments)
        .leftJoin(adjustmentDistributions, and(
          eq(adjustmentDistributions.adjustmentId, reasonableAdjustments.id),
          eq(adjustmentDistributions.tenantId, reasonableAdjustments.tenantId),
          eq(adjustmentDistributions.targetSystem, 'exams'),
          // The SRS acts as the exams target only in 'file' mode; a connected
          // or manual exams target replies for itself.
          eq(adjustmentDistributions.fulfilmentModeCode, 'file'),
          inArray(adjustmentDistributions.statusCode, ['pending', 'failed', 'distributed']),
        ))
        .where(and(
          eq(reasonableAdjustments.enrolmentId, enrolmentId as Uuid),
          eq(reasonableAdjustments.tenantId, tenantId as Uuid),
          isNull(reasonableAdjustments.recordedUntil),
        )),
    );
    return rows
      .filter((r) => r.validFrom <= at && (r.validTo === null || r.validTo > at))
      .map((r) => ({
        adjustmentId: r.adjustmentId,
        distributionId: r.distributionId,
        adjustmentTypeCode: r.adjustmentTypeCode,
        scopeCode: r.scopeCode,
        amount: r.amountValue !== null && r.amountUnitCode !== null
          ? { value: Number(r.amountValue), unitCode: r.amountUnitCode }
          : null,
      }));
  }

  /** The exam components of the registration's module offering. */
  async #loadExamComponents(moduleRegistrationId: string, tenantId: string): Promise<ExamComponent[]> {
    return withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .selectDistinct({
          assessmentComponentId: assessmentComponents.id,
          title: assessmentComponents.title,
          durationMinutes: assessmentComponents.durationMinutes,
        })
        .from(moduleRegistrations)
        .innerJoin(assessmentComponents, and(
          eq(assessmentComponents.moduleOfferingId, moduleRegistrations.moduleOfferingId),
          eq(assessmentComponents.tenantId, moduleRegistrations.tenantId),
          eq(assessmentComponents.componentTypeCode, 'exam'),
        ))
        .where(and(
          eq(moduleRegistrations.id, moduleRegistrationId as Uuid),
          eq(moduleRegistrations.tenantId, tenantId as Uuid),
          isNull(moduleRegistrations.recordedUntil),
        ))
        .orderBy(assessmentComponents.title),
    );
  }

  async #acknowledgeExamsDelivery(accommodations: Record<string, unknown>, tenantId: string): Promise<void> {
    if (!this.adjustments || !isExamAccommodations(accommodations)) return;
    for (const a of accommodations.adjustments) {
      if (!a.applied || !a.distributionId) continue;
      try {
        await this.adjustments.acknowledgeDistribution(a.adjustmentId, a.distributionId, tenantId, 'exams');
      } catch (err) {
        // Ended (withdrawal requested) or superseded since the entry was made.
        if (!(err instanceof ConflictError) && !(err instanceof NotFoundError)) throw err;
      }
    }
  }

  async #reportExamsFailure(adjustmentId: string, distributionId: string, tenantId: string, reason: string): Promise<void> {
    if (!this.adjustments) return;
    try {
      await this.adjustments.reportDistributionFailure(adjustmentId, distributionId, tenantId, 'exams', reason);
    } catch (err) {
      if (!(err instanceof ConflictError)) throw err;
    }
  }

  async #requireExamBoard(examBoardId: string, tenantId: string): Promise<{ id: string; meetingDate: string | null }> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: examBoards.id, meetingDate: examBoards.meetingDate })
        .from(examBoards)
        .where(and(eq(examBoards.id, examBoardId), eq(examBoards.tenantId, tenantId)))
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Exam board', examBoardId);
    return rows[0];
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
