import { randomUUID } from 'node:crypto';

import { and, desc, eq, isNull, or } from 'drizzle-orm';
import {
  communicationDispatchLog,
  communicationTemplates,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { FeatureFlagService } from '../platform-controls/feature-flag-service.js';
import type { LocaleService } from '../globalisation/locale-service.js';

// ── DTOs ─────────────────────────────────────────────────────────────────────

export type ChannelCode = 'email' | 'crm-handoff' | 'integration-event';

export interface CommunicationTemplateDto {
  templateId:      string;
  tenantId:        string | null;
  templateKey:     string;
  channelCode:     string;
  localeCode:      string;
  subjectTemplate: string | null;
  bodyTemplate:    string;
  version:         number;
  active:          boolean;
  createdAt:       Date;
}

export interface CreateCommunicationTemplateInput {
  templateKey:     string;
  channelCode:     ChannelCode;
  localeCode?:     string;
  subjectTemplate?: string;
  bodyTemplate:    string;
}

export interface DispatchCommunicationInput {
  templateKey:       string;
  channelCode:       ChannelCode;
  subjectEntityType: string;
  subjectEntityId:   string;
  recipientRef?:     string;
  payload:           Record<string, unknown>;
  preferredLocale?:  string;
  workflowInstanceId?: string;
}

export type DispatchStatusCode = 'dispatched' | 'suppressed' | 'failed';

export interface DispatchResult {
  dispatchId:         string;
  statusCode:         DispatchStatusCode;
  localeCode:         string;
  channelCode:        string;
  templateKey:        string;
  suppressionReason?: string;
}

export interface DispatchLogEntryDto {
  dispatchId:          string;
  tenantId:            string;
  templateKey:         string;
  channelCode:         string;
  localeCode:          string;
  subjectEntityType:   string;
  subjectEntityId:     string;
  recipientRef:        string | null;
  payload:             Record<string, unknown>;
  workflowInstanceId:  string | null;
  statusCode:          string;
  suppressionReason:   string | null;
  dispatchedAt:        Date;
  dispatchedBy:        string;
}

export interface ListDispatchLogOptions {
  subjectEntityType?: string;
  subjectEntityId?:   string;
  limit?:             number;
}

// ── Service ───────────────────────────────────────────────────────────────────

const CHANNEL_FLAGS: Record<ChannelCode, string> = {
  'email':               'communications.channel.email.enabled',
  'crm-handoff':         'communications.channel.crm-handoff.enabled',
  'integration-event':   'communications.channel.integration-event.enabled',
};

export class CommunicationService {
  constructor(
    private readonly db:           Db,
    private readonly localeService: LocaleService,
    private readonly featureFlags?: FeatureFlagService,
  ) {}

  // ── Templates ───────────────────────────────────────────────────────────────

  async createTemplate(
    tenantId:  string,
    input:     CreateCommunicationTemplateInput,
    actorId:   string,
  ): Promise<CommunicationTemplateDto> {
    const localeCode = input.localeCode ?? 'en-GB';
    await this.#assertLocaleValid(localeCode);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.insert(communicationTemplates).values({
        id:              randomUUID(),
        tenantId:        tenantId as `${string}-${string}-${string}-${string}-${string}`,
        templateKey:     input.templateKey,
        channelCode:     input.channelCode,
        localeCode,
        subjectTemplate: input.subjectTemplate ?? null,
        bodyTemplate:    input.bodyTemplate,
        version:         1,
        active:          true,
        createdBy:       actorId,
        createdAt:       new Date(),
      }).returning(),
    );

    return templateToDto(rows[0]!);
  }

  async listTemplates(tenantId: string): Promise<CommunicationTemplateDto[]> {
    const rows = await this.db
      .select()
      .from(communicationTemplates)
      .where(and(
        or(
          isNull(communicationTemplates.tenantId),
          eq(communicationTemplates.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
        ),
        eq(communicationTemplates.active, true),
      ))
      .orderBy(communicationTemplates.templateKey, communicationTemplates.localeCode);

    return rows.map(templateToDto);
  }

  async getTemplate(templateId: string): Promise<CommunicationTemplateDto> {
    const rows = await this.db
      .select()
      .from(communicationTemplates)
      .where(eq(communicationTemplates.id, templateId as `${string}-${string}-${string}-${string}-${string}`))
      .limit(1);

    if (!rows[0]) throw new NotFoundError('CommunicationTemplate', templateId);
    return templateToDto(rows[0]);
  }

  // ── Dispatch ────────────────────────────────────────────────────────────────

  /**
   * Dispatch a communication.
   *
   * Resolution order:
   *   1. Check channel flag — if off, record as suppressed and return early.
   *   2. Resolve locale: preferredLocale → tenant.defaultLocale → 'en-GB'.
   *   3. Find template: preferred locale → fallback locale → 'en-GB' (tenant then system).
   *   4. Render body (simple {key} substitution).
   *   5. Record dispatch log.
   *   6. Return result.
   *
   * The SRS does not send email itself — it records what should be sent and
   * publishes integration events. External consumers handle delivery.
   */
  async dispatch(
    tenantId: string,
    input:    DispatchCommunicationInput,
    actorId:  string,
  ): Promise<DispatchResult> {
    const channelEnabled = await this.#evaluateBooleanFlag(
      tenantId,
      CHANNEL_FLAGS[input.channelCode],
      false,
    );

    const localeConfig = await this.localeService.getTenantLocaleConfig(tenantId);
    const resolvedLocale = input.preferredLocale ?? localeConfig.defaultLocale;
    const fallbackLocale = localeConfig.fallbackLocale;

    if (!channelEnabled) {
      const dispatchId = await this.#recordDispatch(tenantId, {
        ...input,
        localeCode:         resolvedLocale,
        statusCode:         'suppressed',
        suppressionReason:  `Channel flag '${CHANNEL_FLAGS[input.channelCode]}' is off`,
        dispatchedBy:       actorId,
      });

      return {
        dispatchId,
        statusCode:        'suppressed',
        localeCode:        resolvedLocale,
        channelCode:       input.channelCode,
        templateKey:       input.templateKey,
        suppressionReason: `Channel flag '${CHANNEL_FLAGS[input.channelCode]}' is off`,
      };
    }

    const template = await this.#resolveTemplate(
      tenantId,
      input.templateKey,
      input.channelCode,
      resolvedLocale,
      fallbackLocale,
    );

    const dispatchId = await this.#recordDispatch(tenantId, {
      ...input,
      localeCode:   template.localeCode,
      statusCode:   'dispatched',
      dispatchedBy: actorId,
    });

    return {
      dispatchId,
      statusCode:  'dispatched',
      localeCode:  template.localeCode,
      channelCode: input.channelCode,
      templateKey: input.templateKey,
    };
  }

  async listDispatchLog(
    tenantId: string,
    options:  ListDispatchLogOptions = {},
  ): Promise<DispatchLogEntryDto[]> {
    const conditions = [
      eq(communicationDispatchLog.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
      ...(options.subjectEntityType
        ? [eq(communicationDispatchLog.subjectEntityType, options.subjectEntityType)]
        : []),
      ...(options.subjectEntityId
        ? [eq(communicationDispatchLog.subjectEntityId, options.subjectEntityId as `${string}-${string}-${string}-${string}-${string}`)]
        : []),
    ];

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx.select()
        .from(communicationDispatchLog)
        .where(and(...conditions))
        .orderBy(desc(communicationDispatchLog.dispatchedAt))
        .limit(options.limit ?? 100),
    );

    return rows.map(logEntryToDto);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  async #resolveTemplate(
    tenantId:       string,
    templateKey:    string,
    channelCode:    string,
    preferredLocale: string,
    fallbackLocale:  string,
  ): Promise<CommunicationTemplateDto> {
    const tenantUuid = tenantId as `${string}-${string}-${string}-${string}-${string}`;
    const candidates = await this.db
      .select()
      .from(communicationTemplates)
      .where(and(
        eq(communicationTemplates.templateKey, templateKey),
        eq(communicationTemplates.channelCode, channelCode),
        eq(communicationTemplates.active, true),
        or(
          isNull(communicationTemplates.tenantId),
          eq(communicationTemplates.tenantId, tenantUuid),
        ),
      ));

    // Priority: tenant-specific beats system; preferred locale beats fallback beats en-GB
    const localeOrder = [...new Set([preferredLocale, fallbackLocale, 'en-GB'])];
    for (const locale of localeOrder) {
      const tenantMatch = candidates.find(
        (c) => c.tenantId === tenantId && c.localeCode === locale,
      );
      if (tenantMatch) return templateToDto(tenantMatch);

      const systemMatch = candidates.find(
        (c) => c.tenantId === null && c.localeCode === locale,
      );
      if (systemMatch) return templateToDto(systemMatch);
    }

    throw new NotFoundError('CommunicationTemplate', `${templateKey}/${channelCode}`);
  }

  async #recordDispatch(
    tenantId: string,
    entry: DispatchCommunicationInput & {
      localeCode:        string;
      statusCode:        DispatchStatusCode;
      suppressionReason?: string;
      dispatchedBy:      string;
    },
  ): Promise<string> {
    const id = randomUUID();
    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx.insert(communicationDispatchLog).values({
        id,
        tenantId:            tenantId as `${string}-${string}-${string}-${string}-${string}`,
        templateKey:         entry.templateKey,
        channelCode:         entry.channelCode,
        localeCode:          entry.localeCode,
        subjectEntityType:   entry.subjectEntityType,
        subjectEntityId:     entry.subjectEntityId as `${string}-${string}-${string}-${string}-${string}`,
        recipientRef:        entry.recipientRef ?? null,
        payload:             entry.payload,
        workflowInstanceId:  entry.workflowInstanceId
          ? entry.workflowInstanceId as `${string}-${string}-${string}-${string}-${string}`
          : null,
        statusCode:          entry.statusCode,
        suppressionReason:   entry.suppressionReason ?? null,
        dispatchedAt:        new Date(),
        dispatchedBy:        entry.dispatchedBy,
      });
    });
    return id;
  }

  async #evaluateBooleanFlag(
    tenantId:  string,
    flagKey:   string,
    fallback:  boolean,
  ): Promise<boolean> {
    if (!this.featureFlags) return fallback;
    try {
      const flag = await this.featureFlags.getFlagByKey(flagKey);
      if (!flag) return fallback;
      const result = await this.featureFlags.evaluatePreview(flag.featureFlagId, { tenantId });
      return result.value === true || result.variantKey === 'on';
    } catch {
      return fallback;
    }
  }

  async #assertLocaleValid(localeCode: string): Promise<void> {
    try {
      await this.localeService.getLocaleResourcePack(localeCode);
    } catch {
      throw new ValidationError(
        `Locale '${localeCode}' is not an active locale resource pack`,
        [{ field: 'localeCode', message: 'Must be a registered active locale' }],
      );
    }
  }
}

// ── Mappers ──────────────────────────────────────────────────────────────────

function templateToDto(row: typeof communicationTemplates.$inferSelect): CommunicationTemplateDto {
  return {
    templateId:      row.id,
    tenantId:        row.tenantId,
    templateKey:     row.templateKey,
    channelCode:     row.channelCode,
    localeCode:      row.localeCode,
    subjectTemplate: row.subjectTemplate,
    bodyTemplate:    row.bodyTemplate,
    version:         row.version,
    active:          row.active,
    createdAt:       row.createdAt,
  };
}

function logEntryToDto(row: typeof communicationDispatchLog.$inferSelect): DispatchLogEntryDto {
  return {
    dispatchId:         row.id,
    tenantId:           row.tenantId,
    templateKey:        row.templateKey,
    channelCode:        row.channelCode,
    localeCode:         row.localeCode,
    subjectEntityType:  row.subjectEntityType,
    subjectEntityId:    row.subjectEntityId,
    recipientRef:       row.recipientRef,
    payload:            row.payload as Record<string, unknown>,
    workflowInstanceId: row.workflowInstanceId,
    statusCode:         row.statusCode,
    suppressionReason:  row.suppressionReason,
    dispatchedAt:       row.dispatchedAt,
    dispatchedBy:       row.dispatchedBy,
  };
}
