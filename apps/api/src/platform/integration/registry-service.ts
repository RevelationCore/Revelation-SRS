import { and, asc, desc, eq } from 'drizzle-orm';
import {
  integrationContracts,
  integrationExchanges,
  integrationRegistrations,
  withTenantContext,
  type Db,
} from '@revelation-srs/db';
import { ConflictError, NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { AuditService } from '../audit/service.js';
import {
  assertIntegrationEndpointAllowed,
  type IntegrationEndpointSafetyClass,
} from '../regulatory/exchange-service.js';

// ---------------------------------------------------------------------------
// DTOs
// ---------------------------------------------------------------------------

export interface ContractDto {
  contractId: string;
  displayName: string;
  ownerModuleCode: string;
  directionCode: string;
  patternType: string;
  currentContractVersion: string;
  dataClassificationCode: string;
  deprecatedAt: string | null;
  minimumSupportedVersion: string | null;
  createdAt: string;
}

export interface RegistrationDto {
  registrationId: string;
  tenantId: string;
  contractId: string;
  displayName: string;
  contractVersion: string;
  transportCode: string;
  subjectFilter: string | null;
  consumerGroup: string | null;
  endpointUrl: string | null;
  fileSchedule: string | null;
  secretRef: string | null;
  replaySupported: boolean;
  retryPolicy: {
    maxAttempts: number;
    backoffCoefficient: number;
    initialInterval: string;
    deadLetterSubject: string;
  } | null;
  enabled: boolean;
  endpointSafetyClass: string;
  liveTrafficApproved: boolean;
  systemManaged: boolean;
  healthStatusCode: string | null;
  lastHealthCheckAt: string | null;
  lastSuccessfulExchangeAt: string | null;
  registeredAt: string;
  lastUpdatedAt: string;
}

export interface ExchangeDto {
  exchangeId: string;
  registrationId: string;
  contractId: string;
  directionCode: string;
  exchangeTypeCode: string;
  idempotencyKey: string;
  correlationId: string | null;
  sourceReference: string | null;
  statusCode: string;
  attemptCount: number;
  lastAttemptAt: string | null;
  lastError: string | null;
  payloadHash: string | null;
  payloadSummary: Record<string, unknown> | null;
  receivedAt: string | null;
  sentAt: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

export interface CreateRegistrationInput {
  contractId: string;
  displayName?: string;
  transportCode: string;
  endpointUrl?: string | null;
  subjectFilter?: string | null;
  consumerGroup?: string | null;
  fileSchedule?: string | null;
  secretRef?: string | null;
  replaySupported?: boolean;
  retryPolicy?: {
    maxAttempts: number;
    backoffCoefficient: number;
    initialInterval: string;
    deadLetterSubject: string;
  } | null;
  endpointSafetyClass?: IntegrationEndpointSafetyClass;
  liveTrafficApproved?: boolean;
}

export type UpdateRegistrationInput = Partial<Omit<CreateRegistrationInput, 'contractId'>>;

export interface ListRegistrationsFilter {
  contractId?: string;
  enabled?: boolean;
  limit?: number;
}

export interface ListExchangesFilter {
  registrationId?: string;
  statusCode?: string;
  directionCode?: string;
  limit?: number;
}

export interface RegistryRuntimeContext {
  environmentCode: string;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class IntegrationRegistryService {
  constructor(
    private readonly db: Db,
    private readonly runtime: RegistryRuntimeContext = { environmentCode: 'local' },
    private readonly audit?: AuditService,
  ) {}

  // --- Contracts ---

  async listContracts(): Promise<ContractDto[]> {
    const rows = await this.db
      .select()
      .from(integrationContracts)
      .orderBy(asc(integrationContracts.displayName));
    return rows.map(toContractDto);
  }

  async getContract(contractId: string): Promise<ContractDto> {
    const rows = await this.db
      .select()
      .from(integrationContracts)
      .where(eq(integrationContracts.contractId, contractId))
      .limit(1);
    if (!rows[0]) throw new NotFoundError('Integration contract', contractId);
    return toContractDto(rows[0]);
  }

  // --- Registrations ---

  async listRegistrations(tenantId: string, filter: ListRegistrationsFilter = {}): Promise<RegistrationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationRegistrations)
        .where(
          and(
            eq(integrationRegistrations.tenantId, tenantId),
            filter.contractId ? eq(integrationRegistrations.integrationCode, filter.contractId) : undefined,
            filter.enabled !== undefined ? eq(integrationRegistrations.enabled, filter.enabled) : undefined,
          ),
        )
        .orderBy(desc(integrationRegistrations.registeredAt))
        .limit(filter.limit ?? 50),
    );
    return rows.map(toRegistrationDto);
  }

  async getRegistration(id: string, tenantId: string): Promise<RegistrationDto> {
    const row = await this.getRawRegistration(id, tenantId);
    return toRegistrationDto(row);
  }

  async createRegistration(tenantId: string, input: CreateRegistrationInput, actorId: string): Promise<RegistrationDto> {
    const contracts = await this.db
      .select()
      .from(integrationContracts)
      .where(eq(integrationContracts.contractId, input.contractId))
      .limit(1);

    const contract = contracts[0];
    if (!contract) throw new NotFoundError('Integration contract', input.contractId);

    if (contract.deprecatedAt) {
      throw new ValidationError(
        `Integration contract '${input.contractId}' is deprecated and cannot accept new registrations`,
      );
    }

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(integrationRegistrations)
        .values({
          tenantId,
          integrationContractId: contract.id,
          integrationCode: contract.contractId,
          displayName: input.displayName ?? contract.displayName,
          contractVersion: contract.currentContractVersion,
          transportCode: input.transportCode,
          endpointUrl: input.endpointUrl ?? null,
          subjectFilter: input.subjectFilter ?? null,
          consumerGroup: input.consumerGroup ?? null,
          fileSchedule: input.fileSchedule ?? null,
          secretRef: input.secretRef ?? null,
          replaySupported: input.replaySupported ?? false,
          retryPolicy: input.retryPolicy ?? null,
          enabled: false,
          configuration: {
            systemManaged: false,
            createdBy: actorId,
            ownerModuleCode: contract.ownerModuleCode,
            endpointSafetyClass: input.endpointSafetyClass ?? 'simulator',
            liveTrafficApproved: input.liveTrafficApproved ?? false,
          },
        })
        .returning(),
    );

    const row = rows[0];
    if (!row) throw new ConflictError('Failed to create integration registration');

    await this.audit?.record({
      tenantId,
      entityType: 'integration_registration',
      entityId:   row.id,
      actionType: 'create',
      actorType:  'user',
      actorId,
      afterValue: { contractId: input.contractId, transportCode: input.transportCode },
    });

    return toRegistrationDto(row);
  }

  async updateRegistration(id: string, tenantId: string, input: UpdateRegistrationInput, actorId: string): Promise<RegistrationDto> {
    const current = await this.getRawRegistration(id, tenantId);

    const updatedConfiguration = { ...current.configuration };
    if (input.endpointSafetyClass !== undefined) updatedConfiguration['endpointSafetyClass'] = input.endpointSafetyClass;
    if (input.liveTrafficApproved !== undefined) updatedConfiguration['liveTrafficApproved'] = input.liveTrafficApproved;

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(integrationRegistrations)
        .set({
          ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
          ...(input.transportCode !== undefined ? { transportCode: input.transportCode } : {}),
          ...(input.endpointUrl !== undefined ? { endpointUrl: input.endpointUrl } : {}),
          ...(input.subjectFilter !== undefined ? { subjectFilter: input.subjectFilter } : {}),
          ...(input.consumerGroup !== undefined ? { consumerGroup: input.consumerGroup } : {}),
          ...(input.fileSchedule !== undefined ? { fileSchedule: input.fileSchedule } : {}),
          ...(input.secretRef !== undefined ? { secretRef: input.secretRef } : {}),
          ...(input.replaySupported !== undefined ? { replaySupported: input.replaySupported } : {}),
          ...(input.retryPolicy !== undefined ? { retryPolicy: input.retryPolicy } : {}),
          configuration: updatedConfiguration,
          lastUpdatedAt: new Date(),
        })
        .where(
          and(
            eq(integrationRegistrations.id, id),
            eq(integrationRegistrations.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    if (!rows[0]) throw new NotFoundError('Integration registration', id);

    await this.audit?.record({
      tenantId,
      entityType: 'integration_registration',
      entityId:   id,
      actionType: 'update',
      actorType:  'user',
      actorId,
      afterValue: input,
    });

    return toRegistrationDto(rows[0]);
  }

  async enableRegistration(id: string, tenantId: string, actorId: string): Promise<RegistrationDto> {
    const current = await this.getRawRegistration(id, tenantId);

    assertIntegrationEndpointAllowed({
      environmentCode: this.runtime.environmentCode,
      directionCode: 'outbound',
      ownerModuleCode: ownerModule(current.configuration),
      endpointSafetyClass: safetyClassFrom(current.configuration),
      liveTrafficApproved: liveTrafficApprovedFrom(current.configuration),
    });

    const updatedConfiguration = {
      ...current.configuration,
      lastEnabledBy: actorId,
      lastEnabledAt: new Date().toISOString(),
    };

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(integrationRegistrations)
        .set({ enabled: true, configuration: updatedConfiguration, lastUpdatedAt: new Date() })
        .where(
          and(
            eq(integrationRegistrations.id, id),
            eq(integrationRegistrations.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    if (!rows[0]) throw new NotFoundError('Integration registration', id);

    await this.audit?.record({
      tenantId,
      entityType: 'integration_registration',
      entityId:   id,
      actionType: 'update',
      actorType:  'user',
      actorId,
      afterValue: { enabled: true },
    });

    return toRegistrationDto(rows[0]);
  }

  async disableRegistration(id: string, tenantId: string, actorId: string): Promise<RegistrationDto> {
    const current = await this.getRawRegistration(id, tenantId);

    const updatedConfiguration = {
      ...current.configuration,
      lastDisabledBy: actorId,
      lastDisabledAt: new Date().toISOString(),
    };

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(integrationRegistrations)
        .set({ enabled: false, configuration: updatedConfiguration, lastUpdatedAt: new Date() })
        .where(
          and(
            eq(integrationRegistrations.id, id),
            eq(integrationRegistrations.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    if (!rows[0]) throw new NotFoundError('Integration registration', id);

    await this.audit?.record({
      tenantId,
      entityType: 'integration_registration',
      entityId:   id,
      actionType: 'update',
      actorType:  'user',
      actorId,
      afterValue: { enabled: false },
    });

    return toRegistrationDto(rows[0]);
  }

  async recordHealthCheck(id: string, tenantId: string, statusCode: string, actorId: string): Promise<RegistrationDto> {
    const now = new Date();
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .update(integrationRegistrations)
        .set({
          healthStatusCode: statusCode,
          lastHealthCheckAt: now,
          ...(statusCode === 'healthy' ? { lastSuccessfulExchangeAt: now } : {}),
          lastUpdatedAt: now,
        })
        .where(
          and(
            eq(integrationRegistrations.id, id),
            eq(integrationRegistrations.tenantId, tenantId),
          ),
        )
        .returning(),
    );

    if (!rows[0]) throw new NotFoundError('Integration registration', id);

    await this.audit?.record({
      tenantId,
      entityType: 'integration_registration',
      entityId:   id,
      actionType: 'update',
      actorType:  'user',
      actorId,
      afterValue: { healthStatusCode: statusCode },
    });

    return toRegistrationDto(rows[0]);
  }

  async initiateReplay(id: string, tenantId: string, fromDate: Date, actorId: string): Promise<ExchangeDto> {
    const registration = await this.getRawRegistration(id, tenantId);

    if (!registration.replaySupported) {
      throw new ValidationError('Integration registration does not support replay');
    }

    const idempotencyKey = `replay-${id}-${fromDate.toISOString()}-${actorId}`;

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(integrationExchanges)
        .values({
          tenantId,
          integrationRegistrationId: id,
          contractId: registration.integrationCode,
          directionCode: 'inbound',
          exchangeTypeCode: 'replay-backfill',
          idempotencyKey,
          statusCode: 'requested',
          attemptCount: 0,
          lastAttemptAt: new Date(),
          sourceReference: fromDate.toISOString(),
          payloadSummary: { requestedBy: actorId, fromDate: fromDate.toISOString() },
        })
        .onConflictDoNothing()
        .returning(),
    );

    if (rows[0]) {
      await this.audit?.record({
        tenantId,
        entityType: 'integration_exchange',
        entityId:   rows[0].id,
        actionType: 'create',
        actorType:  'user',
        actorId,
        afterValue: { exchangeTypeCode: 'replay-backfill', fromDate: fromDate.toISOString() },
      });
      return toExchangeDto(rows[0]);
    }

    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationExchanges)
        .where(
          and(
            eq(integrationExchanges.tenantId, tenantId),
            eq(integrationExchanges.idempotencyKey, idempotencyKey),
          ),
        )
        .limit(1),
    );

    if (!existing[0]) throw new ConflictError('Failed to create replay exchange');
    return toExchangeDto(existing[0]);
  }

  // --- Exchanges ---

  async listExchanges(tenantId: string, filter: ListExchangesFilter = {}): Promise<ExchangeDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationExchanges)
        .where(
          and(
            eq(integrationExchanges.tenantId, tenantId),
            filter.registrationId
              ? eq(integrationExchanges.integrationRegistrationId, filter.registrationId)
              : undefined,
            filter.statusCode ? eq(integrationExchanges.statusCode, filter.statusCode) : undefined,
            filter.directionCode ? eq(integrationExchanges.directionCode, filter.directionCode) : undefined,
          ),
        )
        .orderBy(desc(integrationExchanges.createdAt))
        .limit(filter.limit ?? 50),
    );
    return rows.map(toExchangeDto);
  }

  async getExchange(id: string, tenantId: string): Promise<ExchangeDto> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationExchanges)
        .where(
          and(
            eq(integrationExchanges.id, id),
            eq(integrationExchanges.tenantId, tenantId),
          ),
        )
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Integration exchange', id);
    return toExchangeDto(rows[0]);
  }

  // --- Private helpers ---

  private async getRawRegistration(id: string, tenantId: string) {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationRegistrations)
        .where(
          and(
            eq(integrationRegistrations.id, id),
            eq(integrationRegistrations.tenantId, tenantId),
          ),
        )
        .limit(1),
    );
    if (!rows[0]) throw new NotFoundError('Integration registration', id);
    return rows[0];
  }
}

// ---------------------------------------------------------------------------
// DTO converters
// ---------------------------------------------------------------------------

function toContractDto(row: typeof integrationContracts.$inferSelect): ContractDto {
  return {
    contractId:              row.contractId,
    displayName:             row.displayName,
    ownerModuleCode:         row.ownerModuleCode,
    directionCode:           row.directionCode,
    patternType:             row.patternType,
    currentContractVersion:  row.currentContractVersion,
    dataClassificationCode:  row.dataClassificationCode,
    deprecatedAt:            row.deprecatedAt?.toISOString() ?? null,
    minimumSupportedVersion: row.minimumSupportedVersion ?? null,
    createdAt:               row.createdAt.toISOString(),
  };
}

function toRegistrationDto(row: typeof integrationRegistrations.$inferSelect): RegistrationDto {
  return {
    registrationId:           row.id,
    tenantId:                 row.tenantId,
    contractId:               row.integrationCode,
    displayName:              row.displayName,
    contractVersion:          row.contractVersion,
    transportCode:            row.transportCode,
    subjectFilter:            row.subjectFilter,
    consumerGroup:            row.consumerGroup,
    endpointUrl:              row.endpointUrl,
    fileSchedule:             row.fileSchedule,
    secretRef:                row.secretRef,
    replaySupported:          row.replaySupported,
    retryPolicy:              row.retryPolicy ?? null,
    enabled:                  row.enabled,
    endpointSafetyClass:      safetyClassFrom(row.configuration),
    liveTrafficApproved:      liveTrafficApprovedFrom(row.configuration),
    systemManaged:            row.configuration['systemManaged'] === true,
    healthStatusCode:         row.healthStatusCode,
    lastHealthCheckAt:        row.lastHealthCheckAt?.toISOString() ?? null,
    lastSuccessfulExchangeAt: row.lastSuccessfulExchangeAt?.toISOString() ?? null,
    registeredAt:             row.registeredAt.toISOString(),
    lastUpdatedAt:            row.lastUpdatedAt.toISOString(),
  };
}

function toExchangeDto(row: typeof integrationExchanges.$inferSelect): ExchangeDto {
  return {
    exchangeId:       row.id,
    registrationId:   row.integrationRegistrationId,
    contractId:       row.contractId,
    directionCode:    row.directionCode,
    exchangeTypeCode: row.exchangeTypeCode,
    idempotencyKey:   row.idempotencyKey,
    correlationId:    row.correlationId ?? null,
    sourceReference:  row.sourceReference ?? null,
    statusCode:       row.statusCode,
    attemptCount:     row.attemptCount,
    lastAttemptAt:    row.lastAttemptAt?.toISOString() ?? null,
    lastError:        row.lastError ?? null,
    payloadHash:      row.payloadHash ?? null,
    payloadSummary:   (row.payloadSummary as Record<string, unknown> | null) ?? null,
    receivedAt:       row.receivedAt?.toISOString() ?? null,
    sentAt:           row.sentAt?.toISOString() ?? null,
    createdAt:        row.createdAt.toISOString(),
  };
}

function safetyClassFrom(configuration: Record<string, unknown>): IntegrationEndpointSafetyClass {
  const v = configuration['endpointSafetyClass'];
  if (v === 'external-production' || v === 'external-test' || v === 'simulator') return v;
  return 'simulator';
}

function liveTrafficApprovedFrom(configuration: Record<string, unknown>): boolean {
  return configuration['liveTrafficApproved'] === true;
}

function ownerModule(configuration: Record<string, unknown>): string {
  return typeof configuration['ownerModuleCode'] === 'string' ? configuration['ownerModuleCode'] : 'unknown';
}
