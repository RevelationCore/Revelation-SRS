import {
  awards,
  ceremonyAllocations,
  graduationCeremonies,
  graduationCycles,
  graduationInvitations,
  personIdentities,
  persons,
  type CeremonyAllocation,
  type Db,
  type GraduationCeremony,
  type GraduationCycle,
  type GraduationInvitation,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';
import { and, asc, count, desc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export interface CreateCycleInput {
  cycleCode: string;
  title: string;
  awardsFrom: string;
  awardsTo: string;
  ceremonies: Array<{ ceremonyCode: string; startsAt: string; venue: string; capacity: number; guestLimit?: number }>;
}

export type InvitationResponse = 'attending' | 'in-absentia' | 'deferred' | 'declined';

export interface CycleDto extends GraduationCycle {
  ceremonies: Array<GraduationCeremony & { allocated: number }>;
}

export interface PresentationEntry {
  ceremonyCode: string;
  presentationOrder: number | null;
  invitationId: string;
  awardId: string;
  personId: string;
  guestCount: number;
  accessibilityRequired: boolean;
  attendanceCode: string;
}

/**
 * Graduation cycles (BPR-D15; BP-06-005). Invitations are derived from
 * conferred awards; attendance and presentation are recorded separately
 * and never change the award or academic status (E1, A1).
 */
export class GraduationService {
  constructor(private readonly db: Db) {}

  async createCycle(tenantId: string, input: CreateCycleInput, actorId: string): Promise<CycleDto> {
    if (input.awardsTo < input.awardsFrom) throw new ValidationError('The award window must end on or after it starts');
    if (input.ceremonies.length === 0) throw new ValidationError('A cycle needs at least one ceremony');
    const id = await withTenantContext(this.db, tenantId, async (tx) => {
      const existing = await tx.select({ id: graduationCycles.id }).from(graduationCycles)
        .where(and(eq(graduationCycles.tenantId, tenantId as Uuid), eq(graduationCycles.cycleCode, input.cycleCode))).limit(1);
      if (existing[0]) throw new ConflictError(`Graduation cycle ${input.cycleCode} already exists`);
      const [cycle] = await tx.insert(graduationCycles).values({
        tenantId: tenantId as Uuid, cycleCode: input.cycleCode, title: input.title,
        awardsFrom: input.awardsFrom, awardsTo: input.awardsTo, createdBy: actorId,
      }).returning();
      await tx.insert(graduationCeremonies).values(input.ceremonies.map((c) => ({
        tenantId: tenantId as Uuid, cycleId: cycle!.id, ceremonyCode: c.ceremonyCode, startsAt: new Date(c.startsAt),
        venue: c.venue, capacity: c.capacity, guestLimit: c.guestLimit ?? 2,
      })));
      return cycle!.id;
    });
    return this.getCycle(tenantId, id);
  }

  async getCycle(tenantId: string, cycleId: string): Promise<CycleDto> {
    const cycle = await this.#cycle(tenantId, cycleId);
    const ceremonies = await withTenantContext(this.db, tenantId, async (tx) => {
      const list = await tx.select().from(graduationCeremonies).where(eq(graduationCeremonies.cycleId, cycle.id)).orderBy(asc(graduationCeremonies.startsAt));
      const counts = list.length === 0 ? [] : await tx.select({ ceremonyId: ceremonyAllocations.ceremonyId, n: count() }).from(ceremonyAllocations)
        .where(inArray(ceremonyAllocations.ceremonyId, list.map((c) => c.id))).groupBy(ceremonyAllocations.ceremonyId);
      return list.map((c) => ({ ...c, allocated: Number(counts.find((x) => x.ceremonyId === c.id)?.n ?? 0) }));
    });
    return { ...cycle, ceremonies };
  }

  /**
   * Invites every student whose award was conferred in the cycle's window,
   * except those already presented or presented in absentia in another
   * cycle. A deferral elsewhere is invited again (A1). Safe to repeat.
   */
  async deriveInvitations(tenantId: string, cycleId: string): Promise<{ invited: number; alreadyInvited: number; previouslyPresented: number }> {
    const cycle = await this.#requireOpen(tenantId, cycleId);
    return withTenantContext(this.db, tenantId, async (tx) => {
      const eligible = await tx.select({ awardId: awards.id, personId: awards.personId }).from(awards).where(and(
        eq(awards.tenantId, tenantId as Uuid), isNull(awards.recordedUntil),
        gte(awards.awardDate, cycle.awardsFrom), lte(awards.awardDate, cycle.awardsTo),
      ));
      if (eligible.length === 0) return { invited: 0, alreadyInvited: 0, previouslyPresented: 0 };
      const existing = await tx.select({ awardId: graduationInvitations.awardId, cycleId: graduationInvitations.cycleId, response: graduationInvitations.responseCode })
        .from(graduationInvitations).where(and(
          eq(graduationInvitations.tenantId, tenantId as Uuid),
          inArray(graduationInvitations.awardId, eligible.map((e) => e.awardId)),
        ));
      let alreadyInvited = 0;
      let previouslyPresented = 0;
      const toInvite = eligible.filter((e) => {
        const prior = existing.filter((x) => x.awardId === e.awardId);
        if (prior.some((p) => p.cycleId === cycle.id)) { alreadyInvited += 1; return false; }
        if (prior.some((p) => p.response === 'attending' || p.response === 'in-absentia')) { previouslyPresented += 1; return false; }
        return true;
      });
      if (toInvite.length > 0) {
        await tx.insert(graduationInvitations).values(toInvite.map((e) => ({
          tenantId: tenantId as Uuid, cycleId: cycle.id, awardId: e.awardId, personId: e.personId,
        })));
      }
      return { invited: toInvite.length, alreadyInvited, previouslyPresented };
    });
  }

  async listInvitations(tenantId: string, cycleId: string): Promise<GraduationInvitation[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(graduationInvitations)
      .where(and(eq(graduationInvitations.tenantId, tenantId as Uuid), eq(graduationInvitations.cycleId, cycleId as Uuid)))
      .orderBy(asc(graduationInvitations.createdAt)));
  }

  /** All cycles, newest first. */
  async listCycles(tenantId: string): Promise<GraduationCycle[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(graduationCycles)
      .where(eq(graduationCycles.tenantId, tenantId as Uuid)).orderBy(desc(graduationCycles.createdAt)));
  }

  /** A cycle's invitations with each graduand's name, number and ceremony allocation, for the registry. */
  async listInvitationsWithAllocations(tenantId: string, cycleId: string): Promise<Array<GraduationInvitation & {
    studentName: string; studentNumber: string; allocation: CeremonyAllocation | null;
  }>> {
    const invitations = await this.listInvitations(tenantId, cycleId);
    if (invitations.length === 0) return [];
    return withTenantContext(this.db, tenantId, async (tx) => {
      const allocations = await tx.select().from(ceremonyAllocations).where(inArray(ceremonyAllocations.invitationId, invitations.map((i) => i.id)));
      const people = await tx.select({
        id: persons.id, studentNumber: persons.studentNumber, first: personIdentities.legalFirstName, family: personIdentities.legalFamilyName,
      }).from(persons)
        .leftJoin(personIdentities, and(eq(personIdentities.personId, persons.id), isNull(personIdentities.recordedUntil), isNull(personIdentities.validTo)))
        .where(inArray(persons.id, [...new Set(invitations.map((i) => i.personId))]));
      return invitations.map((i) => {
        const p = people.find((x) => x.id === i.personId);
        return {
          ...i,
          studentName: p?.first ? `${p.first} ${p.family ?? ''}`.trim() : (p?.studentNumber ?? i.personId),
          studentNumber: p?.studentNumber ?? '',
          allocation: allocations.find((a) => a.invitationId === i.id) ?? null,
        };
      });
    });
  }

  async listInvitationsForPerson(tenantId: string, personId: string): Promise<GraduationInvitation[]> {
    return withTenantContext(this.db, tenantId, (tx) => tx.select().from(graduationInvitations)
      .where(and(eq(graduationInvitations.tenantId, tenantId as Uuid), eq(graduationInvitations.personId, personId as Uuid))));
  }

  async getInvitation(tenantId: string, invitationId: string): Promise<GraduationInvitation> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(graduationInvitations)
      .where(and(eq(graduationInvitations.id, invitationId as Uuid), eq(graduationInvitations.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('GraduationInvitation', invitationId);
    return row;
  }

  /** The student's choice. Changing away from attending releases any allocation. */
  async respond(tenantId: string, invitationId: string, input: { responseCode: InvitationResponse; guestCount?: number; accessibilityRequired?: boolean }): Promise<GraduationInvitation> {
    const invitation = await this.getInvitation(tenantId, invitationId);
    await this.#requireOpen(tenantId, invitation.cycleId);
    const guestCount = input.responseCode === 'attending' ? (input.guestCount ?? 0) : 0;
    return withTenantContext(this.db, tenantId, async (tx) => {
      if (input.responseCode !== 'attending') {
        await tx.delete(ceremonyAllocations).where(eq(ceremonyAllocations.invitationId, invitation.id));
      }
      const [row] = await tx.update(graduationInvitations).set({
        responseCode: input.responseCode, guestCount, accessibilityRequired: input.accessibilityRequired ?? invitation.accessibilityRequired,
        respondedAt: clockNow(),
      }).where(eq(graduationInvitations.id, invitation.id)).returning();
      return row!;
    });
  }

  /** Allocates an attending graduand to a ceremony, within its capacity and guest limit (E1). */
  async allocate(tenantId: string, invitationId: string, ceremonyId: string, actorId: string): Promise<CeremonyAllocation> {
    const invitation = await this.getInvitation(tenantId, invitationId);
    await this.#requireOpen(tenantId, invitation.cycleId);
    if (invitation.responseCode !== 'attending') throw new ConflictError('Only a graduand who is attending can be allocated to a ceremony');
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [ceremony] = await tx.select().from(graduationCeremonies)
        .where(and(eq(graduationCeremonies.id, ceremonyId as Uuid), eq(graduationCeremonies.cycleId, invitation.cycleId))).for('update').limit(1);
      if (!ceremony) throw new NotFoundError('GraduationCeremony', ceremonyId);
      if (invitation.guestCount > ceremony.guestLimit) {
        throw new ConflictError(`This ceremony allows ${ceremony.guestLimit} guests; the graduand asked for ${invitation.guestCount}`);
      }
      const [{ n }] = await tx.select({ n: count() }).from(ceremonyAllocations).where(and(
        eq(ceremonyAllocations.ceremonyId, ceremony.id), ne(ceremonyAllocations.invitationId, invitation.id),
      )) as [{ n: number }];
      if (Number(n) >= ceremony.capacity) {
        throw new ConflictError(`Ceremony ${ceremony.ceremonyCode} is full (${ceremony.capacity}); allocate another ceremony. The award is unaffected.`);
      }
      await tx.delete(ceremonyAllocations).where(eq(ceremonyAllocations.invitationId, invitation.id));
      const [row] = await tx.insert(ceremonyAllocations).values({
        tenantId: tenantId as Uuid, invitationId: invitation.id, ceremonyId: ceremony.id,
        presentationOrder: Number(n) + 1, allocatedBy: actorId,
      }).returning();
      return row!;
    });
  }

  /** Freezes the presentation list: no further responses or allocations (step 5). */
  async freeze(tenantId: string, cycleId: string): Promise<PresentationEntry[]> {
    const cycle = await this.#requireOpen(tenantId, cycleId);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(graduationCycles)
      .set({ statusCode: 'frozen', frozenAt: clockNow() }).where(eq(graduationCycles.id, cycle.id)));
    return this.presentationList(tenantId, cycleId);
  }

  async presentationList(tenantId: string, cycleId: string): Promise<PresentationEntry[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({
      ceremonyCode: graduationCeremonies.ceremonyCode, startsAt: graduationCeremonies.startsAt, allocation: ceremonyAllocations, invitation: graduationInvitations,
    }).from(ceremonyAllocations)
      .innerJoin(graduationInvitations, eq(graduationInvitations.id, ceremonyAllocations.invitationId))
      .innerJoin(graduationCeremonies, eq(graduationCeremonies.id, ceremonyAllocations.ceremonyId))
      .where(eq(graduationInvitations.cycleId, cycleId as Uuid))
      .orderBy(asc(graduationCeremonies.startsAt), asc(ceremonyAllocations.presentationOrder)));
    return rows.map((r) => ({
      ceremonyCode: r.ceremonyCode, presentationOrder: r.allocation.presentationOrder, invitationId: r.invitation.id,
      awardId: r.invitation.awardId, personId: r.invitation.personId, guestCount: r.invitation.guestCount,
      accessibilityRequired: r.invitation.accessibilityRequired, attendanceCode: r.allocation.attendanceCode,
    }));
  }

  /** Records attendance on the day; separate from, and never changing, the award (step 6). */
  async recordAttendance(tenantId: string, allocationId: string, attendanceCode: 'attended' | 'absent'): Promise<CeremonyAllocation> {
    const [allocation] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(ceremonyAllocations)
      .where(and(eq(ceremonyAllocations.id, allocationId as Uuid), eq(ceremonyAllocations.tenantId, tenantId as Uuid))).limit(1));
    if (!allocation) throw new NotFoundError('CeremonyAllocation', allocationId);
    const invitation = await this.getInvitation(tenantId, allocation.invitationId);
    const cycle = await this.#cycle(tenantId, invitation.cycleId);
    if (cycle.statusCode !== 'frozen') throw new ConflictError('Attendance is recorded once the presentation list is frozen');
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.update(ceremonyAllocations)
      .set({ attendanceCode, attendanceRecordedAt: clockNow() }).where(eq(ceremonyAllocations.id, allocation.id)).returning());
    return row!;
  }

  async #cycle(tenantId: string, cycleId: string): Promise<GraduationCycle> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(graduationCycles)
      .where(and(eq(graduationCycles.id, cycleId as Uuid), eq(graduationCycles.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('GraduationCycle', cycleId);
    return row;
  }

  async #requireOpen(tenantId: string, cycleId: string): Promise<GraduationCycle> {
    const cycle = await this.#cycle(tenantId, cycleId);
    if (cycle.statusCode !== 'open') throw new ConflictError(`Graduation cycle ${cycle.cycleCode} is ${cycle.statusCode}`);
    return cycle;
  }
}
