import { and, eq } from 'drizzle-orm';
import { adjustmentTargetConfigs, type Db, withTenantContext } from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';
import { clockNow } from '../clock.js';

type Uuid = `${string}-${string}-${string}-${string}-${string}`;
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

/** The targets an adjustment's scope can reach. */
export const ADJUSTMENT_TARGETS = ['vle', 'attendance', 'exams'] as const;
export type AdjustmentTarget = (typeof ADJUSTMENT_TARGETS)[number];

export type FulfilmentMode = 'connected' | 'manual' | 'file' | 'not-used';

/**
 * Platform defaults for a tenant that has not configured a target:
 *   vle        — connected: the reference VLE connector (adapters/vle) exists
 *   attendance — manual: no attendance connector consumes instructions yet,
 *                so the work goes to a person rather than waiting forever
 *   exams      — file: the SRS's own exam entries (exam-scheduling.v1)
 */
export const DEFAULT_FULFILMENT_MODES: Readonly<Record<AdjustmentTarget, FulfilmentMode>> = {
  vle:        'connected',
  attendance: 'manual',
  exams:      'file',
};

export const DEFAULT_ALERT_AFTER_HOURS = 72;

export interface TargetConfigDto {
  targetSystem:       AdjustmentTarget;
  fulfilmentModeCode: FulfilmentMode;
  ownerDescription:   string | null;
  alertAfterHours:    number;
  /** True when no tenant setting exists and the platform default applies. */
  isDefault:          boolean;
  updatedAt:          Date | null;
  updatedBy:          string | null;
}

export interface SetTargetConfigInput {
  fulfilmentModeCode: string;
  ownerDescription?:  string | null;
  alertAfterHours?:   number;
}

export function isAdjustmentTarget(value: string): value is AdjustmentTarget {
  return (ADJUSTMENT_TARGETS as readonly string[]).includes(value);
}

/**
 * Per-tenant configuration of how each adjustment target is fulfilled. See
 * migration 0027 for the modes and why they exist.
 */
export class AdjustmentTargetConfigService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
  ) {}

  async list(tenantId: string): Promise<TargetConfigDto[]> {
    const rows = await withTenantContext(this.db, tenantId, (tx) => this.#rows(tx, tenantId));
    return ADJUSTMENT_TARGETS.map((target) => toDto(target, rows.find((r) => r.targetSystem === target)));
  }

  async get(tenantId: string, targetSystem: string): Promise<TargetConfigDto> {
    if (!isAdjustmentTarget(targetSystem)) throw new NotFoundError('AdjustmentTarget', targetSystem);
    const all = await this.list(tenantId);
    return all.find((c) => c.targetSystem === targetSystem)!;
  }

  async set(tenantId: string, targetSystem: string, input: SetTargetConfigInput, actorId: string): Promise<TargetConfigDto> {
    if (!isAdjustmentTarget(targetSystem)) throw new NotFoundError('AdjustmentTarget', targetSystem);
    const valid = await this.valueSets.validateFieldValue(
      'adjustment_target_config', 'fulfilment_mode_code', input.fulfilmentModeCode, tenantId,
    );
    if (valid === false) {
      throw new ValidationError(`Invalid value '${input.fulfilmentModeCode}' for adjustment_target_config.fulfilment_mode_code`, [
        { field: 'fulfilmentModeCode', message: 'Value is not active in the configured value set' },
      ]);
    }
    const now = clockNow();
    const values = {
      tenantId:           tenantId as Uuid,
      targetSystem,
      fulfilmentModeCode: input.fulfilmentModeCode,
      ownerDescription:   input.ownerDescription ?? null,
      alertAfterHours:    input.alertAfterHours ?? DEFAULT_ALERT_AFTER_HOURS,
      updatedAt:          now,
      updatedBy:          actorId,
    };
    await withTenantContext(this.db, tenantId, (tx) =>
      tx.insert(adjustmentTargetConfigs).values(values).onConflictDoUpdate({
        target: [adjustmentTargetConfigs.tenantId, adjustmentTargetConfigs.targetSystem],
        set: {
          fulfilmentModeCode: values.fulfilmentModeCode,
          ownerDescription:   values.ownerDescription,
          alertAfterHours:    values.alertAfterHours,
          updatedAt:          values.updatedAt,
          updatedBy:          values.updatedBy,
        },
      }),
    );
    return this.get(tenantId, targetSystem);
  }

  /** Effective mode per target, read inside the caller's transaction. */
  async modesIn(tx: Tx, tenantId: string): Promise<Record<AdjustmentTarget, FulfilmentMode>> {
    const rows = await this.#rows(tx, tenantId);
    return Object.fromEntries(
      ADJUSTMENT_TARGETS.map((t) => [t, toDto(t, rows.find((r) => r.targetSystem === t)).fulfilmentModeCode]),
    ) as Record<AdjustmentTarget, FulfilmentMode>;
  }

  #rows(tx: Tx, tenantId: string) {
    return tx.select().from(adjustmentTargetConfigs).where(and(eq(adjustmentTargetConfigs.tenantId, tenantId as Uuid)));
  }
}

function toDto(target: AdjustmentTarget, row: typeof adjustmentTargetConfigs.$inferSelect | undefined): TargetConfigDto {
  if (!row) {
    return {
      targetSystem: target,
      fulfilmentModeCode: DEFAULT_FULFILMENT_MODES[target],
      ownerDescription: null,
      alertAfterHours: DEFAULT_ALERT_AFTER_HOURS,
      isDefault: true,
      updatedAt: null,
      updatedBy: null,
    };
  }
  return {
    targetSystem: target,
    fulfilmentModeCode: row.fulfilmentModeCode as FulfilmentMode,
    ownerDescription: row.ownerDescription,
    alertAfterHours: row.alertAfterHours,
    isDefault: false,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}
