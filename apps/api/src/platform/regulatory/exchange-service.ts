import { and, eq } from 'drizzle-orm';
import {
  integrationContracts,
  integrationExchanges,
  integrationRegistrations,
  type Db,
  type IntegrationExchange,
  type IntegrationRegistration,
  withTenantContext,
} from '@revelation-srs/db';
import { ConflictError, ForbiddenError, NotFoundError } from '@revelation-srs/domain';

import { clockNow } from '../clock.js';

export type IntegrationEndpointSafetyClass = 'simulator' | 'external-test' | 'external-production';

export interface RegulatoryExchangeRuntimeContext {
  environmentCode: string;
}

export interface RegulatoryExchangeInput {
  directionCode: 'inbound' | 'outbound';
  exchangeTypeCode: string;
  idempotencyKey: string;
  correlationId?: string | null;
  sourceReference?: string | null;
  statusCode?: string;
  attemptCount?: number;
  lastAttemptAt?: Date | null;
  lastError?: string | null;
  payloadHash?: string | null;
  payloadSummary?: Record<string, unknown> | null;
  receivedAt?: Date | null;
  sentAt?: Date | null;
  transportCode?: 'manual-file' | 'manual-api';
}

export class RegulatoryExchangeService {
  constructor(
    private readonly db: Db,
    private readonly runtime: RegulatoryExchangeRuntimeContext = { environmentCode: 'local' },
  ) {}

  async ensureRegistration(
    tenantId: string,
    contractId: string,
    actorId: string,
    transportCode: 'manual-file' | 'manual-api' = 'manual-file',
  ): Promise<IntegrationRegistration> {
    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationRegistrations)
        .where(
          and(
            eq(integrationRegistrations.tenantId, tenantId),
            eq(integrationRegistrations.integrationCode, contractId),
          ),
        )
        .limit(1),
    );

    if (existing[0]) return existing[0];

    const contracts = await this.db
      .select()
      .from(integrationContracts)
      .where(eq(integrationContracts.contractId, contractId))
      .limit(1);

    const contract = contracts[0];
    if (!contract) throw new NotFoundError('Integration contract', contractId);

    const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(integrationRegistrations)
        .values({
          tenantId,
          integrationContractId: contract.id,
          integrationCode: contract.contractId,
          displayName: contract.displayName,
          contractVersion: contract.currentContractVersion,
          transportCode,
          enabled: true,
          configuration: {
            systemManaged: true,
            createdBy: actorId,
            purpose: 'phase-6-regulatory-exchange',
            ownerModuleCode: contract.ownerModuleCode,
            endpointSafetyClass: defaultEndpointSafetyClass(this.runtime.environmentCode),
            liveTrafficApproved: false,
          },
        })
        .onConflictDoNothing()
        .returning(),
    );

    if (inserted[0]) return inserted[0];

    const afterConflict = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationRegistrations)
        .where(
          and(
            eq(integrationRegistrations.tenantId, tenantId),
            eq(integrationRegistrations.integrationCode, contractId),
          ),
        )
        .limit(1),
    );

    if (!afterConflict[0]) {
      throw new ConflictError(`Could not create integration registration for '${contractId}'`);
    }

    return afterConflict[0];
  }

  async recordExchange(
    tenantId: string,
    contractId: string,
    input: RegulatoryExchangeInput,
    actorId = 'system',
  ): Promise<IntegrationExchange> {
    const registration = await this.ensureRegistration(
      tenantId,
      contractId,
      actorId,
      input.transportCode ?? (input.directionCode === 'inbound' ? 'manual-api' : 'manual-file'),
    );

    const statusCode = input.statusCode ?? (input.directionCode === 'inbound' ? 'received' : 'sent');
    const now = clockNow();
    assertIntegrationEndpointAllowed({
      environmentCode: this.runtime.environmentCode,
      directionCode: input.directionCode,
      ownerModuleCode: registrationOwnerModule(registration),
      endpointSafetyClass: endpointSafetyClass(registration.configuration),
      liveTrafficApproved: liveTrafficApproved(registration.configuration),
    });

    const inserted = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .insert(integrationExchanges)
        .values({
          tenantId,
          integrationRegistrationId: registration.id,
          contractId,
          directionCode: input.directionCode,
          exchangeTypeCode: input.exchangeTypeCode,
          idempotencyKey: input.idempotencyKey,
          correlationId: input.correlationId ?? null,
          sourceReference: input.sourceReference ?? null,
          statusCode,
          attemptCount: input.attemptCount ?? 0,
          lastAttemptAt: input.lastAttemptAt ?? now,
          lastError: input.lastError ?? null,
          payloadHash: input.payloadHash ?? null,
          payloadSummary: input.payloadSummary ?? null,
          receivedAt: input.receivedAt ?? (input.directionCode === 'inbound' ? now : null),
          sentAt: input.sentAt ?? (input.directionCode === 'outbound' ? now : null),
        })
        .onConflictDoNothing()
        .returning(),
    );

    if (inserted[0]) return inserted[0];

    const existing = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(integrationExchanges)
        .where(
          and(
            eq(integrationExchanges.tenantId, tenantId),
            eq(integrationExchanges.integrationRegistrationId, registration.id),
            eq(integrationExchanges.idempotencyKey, input.idempotencyKey),
          ),
        )
        .limit(1),
    );

    if (!existing[0]) {
      throw new ConflictError(`Could not record integration exchange '${input.idempotencyKey}'`);
    }

    return existing[0];
  }
}

export function assertIntegrationEndpointAllowed(input: {
  environmentCode: string;
  directionCode: 'inbound' | 'outbound';
  ownerModuleCode: string;
  endpointSafetyClass: IntegrationEndpointSafetyClass;
  liveTrafficApproved: boolean;
}): void {
  if (input.directionCode !== 'outbound') return;
  if (input.endpointSafetyClass !== 'external-production') return;
  if (productionEnvironmentAllowsLiveTraffic(input.environmentCode)) return;
  if (input.liveTrafficApproved) return;

  throw new ForbiddenError(
    `Live production integration endpoint is not allowed from environment '${input.environmentCode}' for '${input.ownerModuleCode}'`,
  );
}

function productionEnvironmentAllowsLiveTraffic(environmentCode: string): boolean {
  return environmentCode === 'prod' || environmentCode === 'production';
}

function defaultEndpointSafetyClass(environmentCode: string): IntegrationEndpointSafetyClass {
  return productionEnvironmentAllowsLiveTraffic(environmentCode) ? 'external-production' : 'simulator';
}

function endpointSafetyClass(configuration: Record<string, unknown>): IntegrationEndpointSafetyClass {
  const configured = configuration['endpointSafetyClass'];
  if (configured === 'external-production' || configured === 'external-test' || configured === 'simulator') {
    return configured;
  }
  return 'simulator';
}

function liveTrafficApproved(configuration: Record<string, unknown>): boolean {
  return configuration['liveTrafficApproved'] === true;
}

function registrationOwnerModule(registration: IntegrationRegistration): string {
  const configured = registration.configuration['ownerModuleCode'];
  return typeof configured === 'string' ? configured : 'regulatory';
}
