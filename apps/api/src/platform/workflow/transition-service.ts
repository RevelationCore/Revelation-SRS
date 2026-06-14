import { ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';

export type TransitionMatrix<TStatus extends string> = Record<TStatus, readonly TStatus[]>;

export interface TransitionRule<TStatus extends string = string> {
  fromStatusCode: TStatus;
  toStatusCode: TStatus;
}

export interface TransitionValidationInput<TStatus extends string> {
  tenantId: string;
  entityName: string;
  fieldName: string;
  entityLabel: string;
  fromStatus: TStatus;
  toStatus: TStatus;
  defaultTransitions: TransitionMatrix<TStatus>;
  configuredTransitions?: Array<TransitionRule<TStatus>>;
  asAt?: Date;
}

export interface TransitionValidationResult<TStatus extends string> {
  entityName: string;
  fieldName: string;
  fromStatus: TStatus;
  toStatus: TStatus;
  allowedTargets: readonly TStatus[];
  ruleSource: 'default-configuration' | 'workflow-configuration';
  valueSetChecked: boolean;
}

export class TransitionValidator {
  constructor(private readonly valueSets?: ValueSetService) {}

  async assertAllowed<TStatus extends string>(
    input: TransitionValidationInput<TStatus>,
  ): Promise<TransitionValidationResult<TStatus>> {
    const valueSetChecked = await this.#validateTargetStatus(input);
    const { matrix, ruleSource } = resolveTransitionMatrix(input.defaultTransitions, input.configuredTransitions);
    const allowedTargets = matrix[input.fromStatus] ?? [];

    if (!allowedTargets.includes(input.toStatus)) {
      throw new ValidationError(
        `Cannot transition ${input.entityLabel} from '${input.fromStatus}' to '${input.toStatus}'`,
      );
    }

    return {
      entityName: input.entityName,
      fieldName: input.fieldName,
      fromStatus: input.fromStatus,
      toStatus: input.toStatus,
      allowedTargets,
      ruleSource,
      valueSetChecked,
    };
  }

  async #validateTargetStatus<TStatus extends string>(
    input: TransitionValidationInput<TStatus>,
  ): Promise<boolean> {
    if (!this.valueSets) return false;

    const isValid = await this.valueSets.validateFieldValue(
      input.entityName,
      input.fieldName,
      input.toStatus,
      input.tenantId,
      input.asAt,
    );
    if (isValid === null) return false;
    if (!isValid) {
      throw new ValidationError(
        `Invalid transition target '${input.toStatus}' for ${input.entityName}.${input.fieldName}`,
        [{ field: input.fieldName, message: `Value '${input.toStatus}' is not active in the configured value set` }],
      );
    }
    return true;
  }
}

export function resolveTransitionMatrix<TStatus extends string>(
  defaultTransitions: TransitionMatrix<TStatus>,
  configuredTransitions?: Array<TransitionRule<TStatus>>,
): { matrix: TransitionMatrix<TStatus>; ruleSource: 'default-configuration' | 'workflow-configuration' } {
  if (!configuredTransitions || configuredTransitions.length === 0) {
    return { matrix: defaultTransitions, ruleSource: 'default-configuration' };
  }

  const matrix = {} as Record<TStatus, TStatus[]>;
  for (const status of Object.keys(defaultTransitions) as TStatus[]) {
    matrix[status] = [];
  }

  for (const transition of configuredTransitions) {
    matrix[transition.fromStatusCode] ??= [];
    matrix[transition.fromStatusCode].push(transition.toStatusCode);
  }

  return { matrix, ruleSource: 'workflow-configuration' };
}

export function transitionAuditValue<TStatus extends string>(
  result: TransitionValidationResult<TStatus>,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    entityName: result.entityName,
    fieldName: result.fieldName,
    fromStatusCode: result.fromStatus,
    toStatusCode: result.toStatus,
    allowedTargets: [...result.allowedTargets],
    ruleSource: result.ruleSource,
    valueSetChecked: result.valueSetChecked,
    ...extra,
  };
}
