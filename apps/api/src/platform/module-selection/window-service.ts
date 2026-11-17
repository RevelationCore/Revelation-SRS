import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';
import {
  academicPeriods,
  moduleSelectionWindows,
  tenants,
  type Db,
  type ModuleSelectionWindow,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;

export type AllocationMode = 'first-come' | 'ranked';
export type WindowEnforcement = 'when-configured' | 'required';

export interface SelectionWindowInput {
  academicPeriodId: string;
  programmeId?: string | null;
  fheqLevel?: number | null;
  opensAt: Date;
  closesAt: Date;
  resubmissionClosesAt?: Date | null;
  allocationModeCode?: AllocationMode;
}

export interface SelectionWindowDto {
  moduleSelectionWindowId: string;
  academicPeriodId: string;
  academicYear: string;
  periodCode: string;
  programmeId: string | null;
  fheqLevel: number | null;
  opensAt: Date;
  closesAt: Date;
  resubmissionClosesAt: Date | null;
  allocationModeCode: AllocationMode;
  allocationSeeded: boolean;
}

export interface WindowScope {
  academicPeriodId: string;
  programmeId: string | null;
  fheqLevel: number | null;
}

/** The outcome of checking a submission against its window. */
export interface WindowCheck {
  window: ModuleSelectionWindow | null;
  /** True when submission is allowed now (inside the window, or no window applies and none is required). */
  open: boolean;
  message: string | null;
}

/**
 * When students may submit module selections (Phase 4 D-29). A window
 * belongs to an academic period and may be narrowed to a programme and/or
 * the student's current FHEQ level; the most specific window that exists
 * for the student applies. Drafts can be edited at any time; submission is
 * checked here, and a returned proposal may be resubmitted until the
 * window's resubmission close. Confirming an already validated or approved
 * proposal is never checked: the window was checked at submission.
 */
export class SelectionWindowService {
  constructor(private readonly db: Db) {}

  async createWindow(tenantId: string, input: SelectionWindowInput, actorId: string): Promise<string> {
    this.#validateDates(input.opensAt, input.closesAt, input.resubmissionClosesAt ?? null);
    const scope = { academicPeriodId: input.academicPeriodId, programmeId: input.programmeId ?? null, fheqLevel: input.fheqLevel ?? null };
    await this.#refuseOverlap(tenantId, scope, input.opensAt, input.resubmissionClosesAt ?? input.closesAt, null);
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, (tx) => tx.insert(moduleSelectionWindows).values({
      id: id as Uuid, tenantId: tenantId as Uuid, academicPeriodId: input.academicPeriodId as Uuid,
      programmeId: (scope.programmeId ?? null) as Uuid | null, fheqLevel: scope.fheqLevel,
      opensAt: input.opensAt, closesAt: input.closesAt, resubmissionClosesAt: input.resubmissionClosesAt ?? null,
      allocationModeCode: input.allocationModeCode ?? 'ranked', createdBy: actorId,
    }));
    return id;
  }

  async updateWindow(
    windowId: string,
    tenantId: string,
    input: { opensAt: Date; closesAt: Date; resubmissionClosesAt?: Date | null; allocationModeCode?: AllocationMode },
  ): Promise<void> {
    const current = await this.getWindow(tenantId, windowId);
    this.#validateDates(input.opensAt, input.closesAt, input.resubmissionClosesAt ?? null);
    if (input.allocationModeCode && input.allocationModeCode !== current.allocationModeCode && current.allocationSeed) {
      throw new ConflictError('The allocation mode cannot change once an allocation has been previewed for this window');
    }
    await this.#refuseOverlap(tenantId, current, input.opensAt, input.resubmissionClosesAt ?? input.closesAt, windowId);
    await withTenantContext(this.db, tenantId, (tx) => tx.update(moduleSelectionWindows).set({
      opensAt: input.opensAt, closesAt: input.closesAt,
      ...(input.resubmissionClosesAt !== undefined ? { resubmissionClosesAt: input.resubmissionClosesAt } : {}),
      ...(input.allocationModeCode ? { allocationModeCode: input.allocationModeCode } : {}),
    }).where(and(eq(moduleSelectionWindows.id, windowId as Uuid), eq(moduleSelectionWindows.tenantId, tenantId as Uuid))));
  }

  async getWindow(tenantId: string, windowId: string): Promise<ModuleSelectionWindow> {
    const [row] = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleSelectionWindows)
      .where(and(eq(moduleSelectionWindows.id, windowId as Uuid), eq(moduleSelectionWindows.tenantId, tenantId as Uuid))).limit(1));
    if (!row) throw new NotFoundError('ModuleSelectionWindow', windowId);
    return row;
  }

  async listWindows(tenantId: string, opts: { academicPeriodId?: string } = {}): Promise<SelectionWindowDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select({ w: moduleSelectionWindows, academicYear: academicPeriods.academicYear, periodCode: academicPeriods.periodCode })
      .from(moduleSelectionWindows)
      .innerJoin(academicPeriods, eq(moduleSelectionWindows.academicPeriodId, academicPeriods.id))
      .where(and(
        eq(moduleSelectionWindows.tenantId, tenantId as Uuid),
        ...(opts.academicPeriodId ? [eq(moduleSelectionWindows.academicPeriodId, opts.academicPeriodId as Uuid)] : []),
      ))
      .orderBy(asc(academicPeriods.startDate), asc(moduleSelectionWindows.opensAt)));
    return rows.map(({ w, academicYear, periodCode }) => ({
      moduleSelectionWindowId: w.id, academicPeriodId: w.academicPeriodId, academicYear, periodCode,
      programmeId: w.programmeId, fheqLevel: w.fheqLevel, opensAt: w.opensAt, closesAt: w.closesAt,
      resubmissionClosesAt: w.resubmissionClosesAt, allocationModeCode: w.allocationModeCode as AllocationMode,
      allocationSeeded: w.allocationSeed !== null,
    }));
  }

  async enforcement(tenantId: string): Promise<WindowEnforcement> {
    const [row] = await this.db.select({ configuration: tenants.configuration }).from(tenants).where(eq(tenants.id, tenantId as Uuid)).limit(1);
    const ms = (row?.configuration?.['moduleSelection'] ?? {}) as Record<string, unknown>;
    return ms['windowEnforcement'] === 'required' ? 'required' : 'when-configured';
  }

  /**
   * The window that applies to a student: among the most specific scope that
   * has any window (programme and level, programme, level, whole period),
   * the one open now, else the next to open, else the last to close.
   */
  async resolve(tenantId: string, scope: WindowScope, at: Date = clockNow()): Promise<ModuleSelectionWindow | null> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleSelectionWindows).where(and(
      eq(moduleSelectionWindows.tenantId, tenantId as Uuid), eq(moduleSelectionWindows.academicPeriodId, scope.academicPeriodId as Uuid),
    )));
    const specificity = (w: ModuleSelectionWindow): number => {
      if (w.programmeId !== null && w.programmeId !== scope.programmeId) return -1;
      if (w.fheqLevel !== null && w.fheqLevel !== scope.fheqLevel) return -1;
      return (w.programmeId !== null ? 2 : 0) + (w.fheqLevel !== null ? 1 : 0);
    };
    const applicable = rows.filter((w) => specificity(w) >= 0);
    if (applicable.length === 0) return null;
    const best = Math.max(...applicable.map(specificity));
    const candidates = applicable.filter((w) => specificity(w) === best);
    const end = (w: ModuleSelectionWindow) => w.resubmissionClosesAt ?? w.closesAt;
    return candidates.find((w) => w.opensAt <= at && at <= end(w))
      ?? candidates.filter((w) => w.opensAt > at).sort((a, b) => a.opensAt.getTime() - b.opensAt.getTime())[0]
      ?? candidates.sort((a, b) => end(b).getTime() - end(a).getTime())[0]!;
  }

  /** Whether a submission (or a resubmission of a returned proposal) is allowed now. */
  async check(tenantId: string, scope: WindowScope, opts: { resubmission: boolean }, at: Date = clockNow()): Promise<WindowCheck> {
    const window = await this.resolve(tenantId, scope, at);
    if (!window) {
      const required = (await this.enforcement(tenantId)) === 'required';
      return { window: null, open: !required, message: required ? 'No module selection window is configured for this period' : null };
    }
    const closes = opts.resubmission ? (window.resubmissionClosesAt ?? window.closesAt) : window.closesAt;
    if (at < window.opensAt) return { window, open: false, message: `Module selection opens on ${window.opensAt.toISOString()}` };
    if (at > closes) return { window, open: false, message: `Module selection ${opts.resubmission ? 'resubmission ' : ''}closed on ${closes.toISOString()}` };
    return { window, open: true, message: null };
  }

  /** The window's allocation seed, generated and stored on first use and never changed (D-30). */
  async seed(tenantId: string, windowId: string, generate: () => Buffer): Promise<Buffer> {
    return withTenantContext(this.db, tenantId, async (tx) => {
      const [row] = await tx.select({ seed: moduleSelectionWindows.allocationSeed }).from(moduleSelectionWindows)
        .where(and(eq(moduleSelectionWindows.id, windowId as Uuid), eq(moduleSelectionWindows.tenantId, tenantId as Uuid))).for('update');
      if (!row) throw new NotFoundError('ModuleSelectionWindow', windowId);
      if (row.seed) return row.seed;
      const seed = generate();
      await tx.update(moduleSelectionWindows).set({ allocationSeed: seed }).where(eq(moduleSelectionWindows.id, windowId as Uuid));
      return seed;
    });
  }

  #validateDates(opensAt: Date, closesAt: Date, resubmissionClosesAt: Date | null): void {
    if (closesAt <= opensAt) throw new ValidationError('closesAt must be after opensAt', [{ field: 'closesAt', message: 'Window close time must be after the open time' }]);
    if (resubmissionClosesAt && resubmissionClosesAt < closesAt) {
      throw new ValidationError('resubmissionClosesAt must not be before closesAt', [{ field: 'resubmissionClosesAt', message: 'Resubmission cannot close before the window' }]);
    }
  }

  async #refuseOverlap(tenantId: string, scope: WindowScope, from: Date, to: Date, exceptId: string | null): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => tx.select().from(moduleSelectionWindows).where(and(
      eq(moduleSelectionWindows.tenantId, tenantId as Uuid), eq(moduleSelectionWindows.academicPeriodId, scope.academicPeriodId as Uuid),
    )));
    const clash = rows.find((w) => w.id !== exceptId && w.programmeId === scope.programmeId && w.fheqLevel === scope.fheqLevel
      && w.opensAt <= to && from <= (w.resubmissionClosesAt ?? w.closesAt));
    if (clash) throw new ConflictError('Another selection window for the same period and scope overlaps these dates');
  }
}
