import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimiter from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { trace } from '@opentelemetry/api';
import { jwtPlugin, tenantContextPlugin } from '@revelation-srs/auth';
import { createDb } from '@revelation-srs/db';
import type { DomainError } from '@revelation-srs/domain';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { AdjustmentService } from './platform/adjustments/adjustment-service.js';
import { AssessmentComponentService } from './platform/assessment/component-service.js';
import { MarkService } from './platform/assessment/mark-service.js';
import { ModuleResultService } from './platform/assessment/module-result-service.js';
import { AuditService } from './platform/audit/service.js';
import { CalendarService } from './platform/calendar/service.js';
import { CatalogueService } from './platform/catalogue/service.js';
import { ExceptionalCircumstancesService } from './platform/circumstances/ec-service.js';
import { MisconductService } from './platform/circumstances/misconduct-service.js';
import { EnrolmentService } from './platform/enrolment/service.js';
import { EngagementService } from './platform/engagement/engagement-service.js';
import { ExamEntryService } from './platform/assessment/exam-entry-service.js';
import { BoardService } from './platform/governance/board-service.js';
import { AdmissionsService } from './platform/admissions/admissions-service.js';
import { CommunicationService } from './platform/communications/communication-service.js';
import { LocaleService } from './platform/globalisation/locale-service.js';
import { CurrencyService } from './platform/globalisation/currency-service.js';
import { IntegrationBusPublisher } from './platform/integration-bus/publisher.js';
import { AwardService } from './platform/progression/award-service.js';
import { HearService } from './platform/progression/hear-service.js';
import { ProgressionService } from './platform/progression/progression-service.js';
import { CorrectionService } from './platform/governance/correction-service.js';
import { ModuleRegistrationService } from './platform/registration/service.js';
import { IntegrationRegistryService } from './platform/integration/registry-service.js';
import { RegulatoryExchangeService } from './platform/regulatory/exchange-service.js';
import { EnvironmentService } from './platform/platform-controls/environment-service.js';
import { FeatureFlagService } from './platform/platform-controls/feature-flag-service.js';
import { WorkflowBridgeService } from './platform/platform-controls/workflow-bridge-service.js';
import { WorkflowDefinitionService } from './platform/platform-controls/workflow-definition-service.js';
import { WorkflowResponsibilityService } from './platform/platform-controls/workflow-responsibility-service.js';
import { WorkflowInstanceService, WorkflowTaskService } from './platform/platform-controls/workflow-runtime-service.js';
import { DemoService } from './platform/demo/service.js';
import { RetentionEnforcementService } from './platform/privacy/retention-service.js';
import { NotificationService } from './platform/notifications/notification-service.js';
import { FoiService } from './platform/regulatory/foi-service.js';
import { HesaService } from './platform/regulatory/hesa-service.js';
import { OfsService } from './platform/regulatory/ofs-service.js';
import { SlcService } from './platform/regulatory/slc-service.js';
import { UcasService } from './platform/regulatory/ucas-service.js';
import { UkviService } from './platform/regulatory/ukvi-service.js';
import { RulesEngine } from './platform/rules-engine/engine.js';
import { StudentService } from './platform/students/service.js';
import { TenantAdminService } from './platform/tenant-admin/service.js';
import { ValueSetService } from './platform/value-sets/service.js';
import { TriggerRuleEvaluator } from './platform/workflow/trigger-rule-service.js';
import { assessmentComponentRoutes } from './routes/assessment-components.js';
import { academicPeriodsRoutes } from './routes/academic-periods.js';
import { circumstancesRoutes } from './routes/circumstances.js';
import { enrolmentRoutes } from './routes/enrolments.js';
import { engagementRoutes } from './routes/engagement.js';
import { examBoardRoutes } from './routes/exam-boards.js';
import { healthRoutes } from './routes/health.js';
import { markRoutes } from './routes/marks.js';
import { moduleResultRoutes } from './routes/module-results.js';
import { moduleRegistrationsRoutes } from './routes/module-registrations.js';
import { programmesRoutes } from './routes/programmes.js';
import { progressionRoutes } from './routes/progression.js';
import { regulatoryFoiRoutes } from './routes/regulatory-foi.js';
import { regulatoryHesaRoutes } from './routes/regulatory-hesa.js';
import { regulatoryOfsRoutes } from './routes/regulatory-ofs.js';
import { regulatorySlcRoutes } from './routes/regulatory-slc.js';
import { regulatoryUcasRoutes } from './routes/regulatory-ucas.js';
import { regulatoryUkviRoutes } from './routes/regulatory-ukvi.js';
import { studentRoutes } from './routes/students.js';
import { tenantAdminRoutes } from './routes/tenant-admin.js';
import { valueSetsRoutes } from './routes/value-sets.js';
import { globalisationRoutes } from './routes/globalisation.js';
import { adjustmentRoutes } from './routes/adjustments.js';
import { communicationRoutes } from './routes/communications.js';
import { correctionCasesRoutes } from './routes/correction-cases.js';
import { demoRoutes } from './routes/demo.js';
import { integrationRegistryRoutes } from './routes/integration-registry.js';
import { platformControlRoutes } from './routes/platform-controls.js';
import { reportingRoutes } from './routes/reporting.js';
import { auditLogRoutes } from './routes/audit-log.js';
import { adminRetentionRoutes } from './routes/admin-retention.js';
import { notificationRoutes } from './routes/notifications.js';

// ---------------------------------------------------------------------------
// OpenAPI helpers — injected via onRoute hook so route files stay declaration-free
// ---------------------------------------------------------------------------

const METHOD_VERB: Record<string, string> = {
  GET: 'get', POST: 'create', PUT: 'replace', PATCH: 'update', DELETE: 'delete',
};

function generateOperationId(method: string, url: string): string {
  const path = url.replace(/^\/api\/v1/, '').replace(/^\//, '');
  const verb = METHOD_VERB[method.toUpperCase()] ?? method.toLowerCase();
  const parts = path.split('/').filter(Boolean).map(seg => {
    if (seg.startsWith(':')) {
      const n = seg.slice(1);
      return 'By' + n.charAt(0).toUpperCase() + n.slice(1);
    }
    return seg.replace(/-([a-z])/g, (_: string, c: string) => c.toUpperCase())
              .replace(/^([a-z])/, (_: string, c: string) => c.toUpperCase());
  });
  return verb + parts.join('');
}

/**
 * Publication classes (x-publication-class):
 *   public      — core student record surface, accessible to authenticated principals
 *   integration — adjacent-system connectivity (adjustments, communications)
 *   workflow    — state-machine command endpoints that trigger process transitions
 *   admin       — tenant-scoped configuration and workflow runtime management
 *   system      — platform-level controls (super-admin, cross-tenant)
 *   reporting   — regulatory submission data and read-only compliance extracts
 *   operational — infrastructure endpoints not included in the published API
 *   private     — internal routing surfaces not intended for external consumers
 */
function classifyOperation(method: string, url: string): string {
  if (!url.startsWith('/api/v1')) return 'operational';
  const path = url.replace(/^\/api\/v1/, '');
  const m = method.toUpperCase();

  // Private — internal surfaces not for external consumers
  if (path.includes('/downstream-triggers')) return 'private';
  if (path === '/communications/dispatch') return 'private';

  // System — platform-level, cross-tenant configuration
  if (path.startsWith('/admin/globalisation')) return 'system';
  if (path.startsWith('/workflow-definitions') || path.startsWith('/workflow-definition-versions')) return 'system';
  if (path.startsWith('/workflow-assignment-rules')) return 'system';
  if (path.startsWith('/tenants') && !path.startsWith('/tenant/')) return 'system';
  if (path.startsWith('/environments') || path === '/environment-runtime') return 'system';
  if (path.startsWith('/environment-promotions')) return 'system';
  if (path.startsWith('/feature-flags') && !path.includes('/assignments') && !path.includes('/evaluation-preview')) return 'system';

  // Admin — tenant-scoped configuration and workflow runtime management
  if (path.startsWith('/tenant/')) return 'admin';
  if (path.startsWith('/value-sets') || path.startsWith('/fields/')) return 'admin';
  if (path.startsWith('/academic-rules')) return 'admin';
  if (path.startsWith('/workflow-instances') || path.startsWith('/workflow-tasks')) return 'admin';
  if (path.includes('/feature-flags') && (path.includes('/assignments') || path.includes('/evaluation-preview'))) return 'admin';
  if (path.startsWith('/integration-contracts') || path.startsWith('/integration-registrations') || path.startsWith('/integration-exchanges')) return 'admin';

  // Workflow — commands that trigger state machine transitions
  const WORKFLOW_ACTIONS = [
    '/transitions', '/intermit', '/withdraw', '/suspend', '/graduation',
    '/completion', '/ratification', '/deferral', '/quorum',
    '/external-examiner-signoff', '/generate', '/validate', '/submit',
    '/amendments', '/slc-status-notification', '/expire', '/acknowledge',
    '/retirement', '/link', '/attendance',
  ];
  if (m === 'POST' && WORKFLOW_ACTIONS.some(a => path.includes(a))) return 'workflow';
  if (m === 'POST' && (path.includes('/progression') || path.includes('/award') || path.includes('/classification') || path.includes('/hear'))) return 'workflow';
  if ((m === 'POST' || m === 'PATCH') && path.includes('/correction-cases')) return 'workflow';
  if (m === 'PATCH' && path.includes('/status') && path.includes('/regulatory')) return 'workflow';
  if (m === 'PATCH' && path.includes('/assignment') && path.includes('/cas-requests')) return 'workflow';
  if (m === 'POST' && path.includes('/exam-entries')) return 'workflow';
  if (m === 'POST' && path.includes('/data-pack')) return 'workflow';

  // Reporting — regulatory submission data and read-only compliance extracts
  if (path.includes('/regulatory/')) return 'reporting';

  // Integration — surfaces for adjacent system connectivity
  if (path.includes('/adjustments')) return 'integration';
  if (path.includes('/communication-templates') || path.includes('/communication-dispatch-log')) return 'integration';

  // Public — core student record data
  return 'public';
}

/**
 * Builds and configures the Fastify application.
 * Decoupled from process startup so it can be instantiated in tests.
 *
 * @param overrides.eventBus  Replace the real NATS publisher with a test spy.
 */
export async function buildApp(
  config: Config,
  overrides: { eventBus?: IntegrationBusPublisher } = {},
): Promise<FastifyInstance> {
  const serializers = {
    req(req: { method: string; url: string; headers: Record<string, string | string[] | undefined> }) {
      return {
        method:        req.method,
        url:           req.url,
        correlationId: req.headers['x-correlation-id'],
      };
    },
  };

  const fastify = Fastify({
    logger: config.nodeEnv === 'development'
      ? {
          level: config.logLevel,
          transport: { target: 'pino-pretty', options: { colorize: true } },
          serializers,
        }
      : {
          level: config.logLevel,
          serializers,
        },
    genReqId: () => crypto.randomUUID(),
    disableRequestLogging: false,
  });

  // Inject OTel traceId into every Fastify log line for log-trace correlation.
  fastify.addHook('onRequest', (req, _reply, done) => {
    const span = trace.getActiveSpan();
    if (span) {
      const { traceId, spanId } = span.spanContext();
      req.log = req.log.child({ traceId, spanId });
    }
    done();
  });

  // - Platform infrastructure -

  const db         = createDb(config.databaseUrl);
  const audit      = new AuditService(db);
  const rules      = new RulesEngine(db);
  const valueSets  = new ValueSetService(db);
  const eventBus   = overrides.eventBus ?? new IntegrationBusPublisher(config.natsUrl);
  const featureFlags = new FeatureFlagService(db);
  const triggerRules = new TriggerRuleEvaluator(db, featureFlags);
  const students   = new StudentService(db, valueSets);
  const enrolments = new EnrolmentService(db, eventBus, valueSets, triggerRules);
  const engagement = new EngagementService(db, eventBus, valueSets);
  const catalogue  = new CatalogueService(db, eventBus, valueSets);
  const calendar   = new CalendarService(db);
  const registrations = new ModuleRegistrationService(db, eventBus, rules);
  const tenantAdmin = new TenantAdminService(db);
  const assessmentComponents = new AssessmentComponentService(db, valueSets);
  const moduleResults = new ModuleResultService(db, eventBus, rules);
  const marks = new MarkService(db, eventBus, rules, moduleResults, featureFlags);
  const adjustments = new AdjustmentService(db, eventBus, valueSets);
  const exceptionalCircumstances = new ExceptionalCircumstancesService(db, eventBus);
  const misconduct = new MisconductService(db, valueSets, eventBus);
  const progression = new ProgressionService(db, eventBus, rules);
  const awards      = new AwardService(db, eventBus, rules, enrolments);
  const boards = new BoardService(db, eventBus, valueSets, awards, featureFlags);
  const hear        = new HearService(db);
  const corrections = new CorrectionService(db, eventBus, marks, moduleResults, progression, valueSets);
  const runtimeDeployment = {
    environmentCode: config.deploymentEnvironmentCode,
    releaseVersion: config.releaseVersion,
    ...(config.imageDigest ? { imageDigest: config.imageDigest } : {}),
    migrationVersion: config.migrationVersion,
  };
  const regulatoryExchanges = new RegulatoryExchangeService(db, {
    environmentCode: config.deploymentEnvironmentCode,
  });
  const integrationRegistry = new IntegrationRegistryService(db, {
    environmentCode: config.deploymentEnvironmentCode,
  }, audit);
  const workflowDefinitions = new WorkflowDefinitionService(db);
  const workflowInstances = new WorkflowInstanceService(db);
  const workflowTasks = new WorkflowTaskService(db);
  const workflowBridge = new WorkflowBridgeService(db, audit, eventBus);
  const workflowResponsibilities = new WorkflowResponsibilityService(db);
  const environments = new EnvironmentService(db, runtimeDeployment);
  const admissions    = new AdmissionsService(db, workflowBridge);
  const localeService   = new LocaleService(db, audit);
  const currencyService = new CurrencyService(db, audit);
  const communications  = new CommunicationService(db, localeService, featureFlags);
  const ucas = new UcasService(db, valueSets, eventBus, enrolments, regulatoryExchanges, admissions, featureFlags);
  const hesa = new HesaService(db, eventBus, students, regulatoryExchanges);
  const slc = new SlcService(db, eventBus, valueSets, enrolments, regulatoryExchanges);
  const ukvi = new UkviService(db, eventBus, valueSets, rules, regulatoryExchanges);
  const ofs = new OfsService(db, eventBus);
  const foi = new FoiService(db, valueSets);
  const examEntries = new ExamEntryService(db, eventBus, regulatoryExchanges);

  // Decorate the Fastify instance so plugins and routes can access shared services
  fastify.decorate('config',          config);
  fastify.decorate('db',              db);
  fastify.decorate('audit',           audit);
  fastify.decorate('rules',           rules);
  fastify.decorate('valueSetService', valueSets);
  fastify.decorate('eventBus',        eventBus);
  fastify.decorate('studentService',  students);
  fastify.decorate('enrolmentService', enrolments);
  fastify.decorate('engagementService', engagement);
  fastify.decorate('catalogueService', catalogue);
  fastify.decorate('calendarService',  calendar);
  fastify.decorate('moduleRegistrationService', registrations);
  fastify.decorate('tenantAdminService', tenantAdmin);
  fastify.decorate('assessmentComponentService', assessmentComponents);
  fastify.decorate('moduleResultService', moduleResults);
  fastify.decorate('markService', marks);
  fastify.decorate('adjustmentService', adjustments);
  fastify.decorate('exceptionalCircumstancesService', exceptionalCircumstances);
  fastify.decorate('misconductService', misconduct);
  fastify.decorate('boardService', boards);
  fastify.decorate('progressionService', progression);
  fastify.decorate('awardService',       awards);
  fastify.decorate('hearService',        hear);
  fastify.decorate('correctionService',  corrections);
  fastify.decorate('regulatoryExchangeService', regulatoryExchanges);
  fastify.decorate('integrationRegistryService', integrationRegistry);
  fastify.decorate('workflowDefinitionService', workflowDefinitions);
  fastify.decorate('workflowInstanceService', workflowInstances);
  fastify.decorate('workflowTaskService', workflowTasks);
  fastify.decorate('workflowBridgeService', workflowBridge);
  fastify.decorate('workflowResponsibilityService', workflowResponsibilities);
  fastify.decorate('featureFlagService', featureFlags);
  fastify.decorate('environmentService', environments);
  fastify.decorate('ucasService',        ucas);
  fastify.decorate('hesaService',        hesa);
  fastify.decorate('slcService',         slc);
  fastify.decorate('ukviService',        ukvi);
  fastify.decorate('ofsService',         ofs);
  fastify.decorate('foiService',         foi);
  fastify.decorate('examEntryService',   examEntries);
  fastify.decorate('localeService',       localeService);
  fastify.decorate('currencyService',     currencyService);
  fastify.decorate('communicationService', communications);

  const demo = new DemoService(db);
  fastify.decorate('demoService', demo);

  const retentionService = new RetentionEnforcementService(db, audit);
  fastify.decorate('retentionService', retentionService);

  const notificationService = new NotificationService(db);
  fastify.decorate('notificationService', notificationService);

  // - Security plugins -

  await fastify.register(helmet, { global: true });

  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await fastify.register(rateLimiter, {
    max:       1000,
    timeWindow: 60_000,
    keyGenerator: (req) => req.tenantId ?? req.ip,
  });

  await fastify.register(jwtPlugin, {
    secret:  config.jwtSecret,
    ...(config.keycloakJwksUrl ? { jwksUrl: config.keycloakJwksUrl } : {}),
  });
  await fastify.register(tenantContextPlugin);

  // - Global error handler -

  fastify.setErrorHandler((err, req, reply) => {
    const error = err as Error & Partial<DomainError> & { statusCode?: number; fields?: unknown };
    const isDomain = typeof error.code === 'string' && typeof error.statusCode === 'number';
    const status   = isDomain ? error.statusCode! : (error.statusCode ?? 500);

    if (status >= 500) {
      req.log.error({ err }, 'Unhandled error');
    }

    void reply.code(status).send({
      type:          `https://srs.example.com/errors/${isDomain ? error.code : 'internal-error'}`,
      title:         status >= 500 ? 'Internal Server Error' : error.message,
      status,
      detail:        status < 500 ? error.message : 'An unexpected error occurred',
      instance:      req.url,
      correlationId: req.id,
      ...(isDomain && error.fields
        ? { errors: error.fields }
        : {}),
    });
  });

  // - OpenAPI -

  await fastify.register(swagger, {
    openapi: {
      openapi: '3.1.0',
      info: {
        title:       'Revelation SRS API',
        description: 'Student Records System — core REST API',
        version:     '1.0.0',
        license:     { name: 'AGPL-3.0', url: 'https://www.gnu.org/licenses/agpl-3.0.html' },
      },
      components: {
        securitySchemes: {
          bearerAuth: {
            type:         'http',
            scheme:       'bearer',
            bearerFormat: 'JWT',
          },
        },
      },
      security: [{ bearerAuth: [] }],
      tags: [
        { name: 'students',             description: 'Student identity and personal data' },
        { name: 'enrolments',           description: 'Enrolment lifecycle' },
        { name: 'module-registrations', description: 'Module registration' },
        { name: 'catalogue',            description: 'Programme and module catalogue' },
        { name: 'calendar',             description: 'Academic calendar and periods' },
        { name: 'assessment',           description: 'Assessment structure and marks' },
        { name: 'adjustments',          description: 'Reasonable adjustments and distribution status' },
        { name: 'engagement',           description: 'Expected academic engagement events and observations' },
        { name: 'circumstances',        description: 'Exceptional circumstances and misconduct outcomes' },
        { name: 'governance',           description: 'Exam boards, data packs, and governance workflows' },
        { name: 'progression',          description: 'Progression decisions, awards, and outcomes' },
        { name: 'regulatory',           description: 'Regulatory compliance and statutory exchanges' },
        { name: 'tenant-admin',         description: 'Tenant administration and configuration' },
        { name: 'value-sets',           description: 'Value set management' },
        { name: 'platform-controls',    description: 'Workflow, feature flags, and environment controls' },
        { name: 'globalisation',        description: 'Locale, time zone, currency, and multilingual label administration' },
        { name: 'communications',       description: 'Communication templates, channel dispatch, and audit log' },
        { name: 'integration-registry', description: 'Integration contracts, registrations, and exchange audit' },
      ],
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: '/api/v1/docs',
    uiConfig:    { docExpansion: 'list', deepLinking: true },
    staticCSP:   true,
  });

  // Inject OpenAPI metadata from URL pattern so individual route files stay declaration-free
  fastify.addHook('onRoute', (routeOptions) => {
    if (!routeOptions.url.startsWith('/api/v1')) return;
    if ((routeOptions.schema as { hide?: boolean } | undefined)?.hide) return;

    const tagMap: Array<[string, string]> = [
      // More-specific patterns must precede their containing segments
      ['/adjustments',               'adjustments'],
      ['/engagement',                'engagement'],
      ['/exceptional-circumstances', 'circumstances'],
      ['/misconduct-outcomes',       'circumstances'],
      ['/correction-cases',          'governance'],
      ['/exam-boards',               'governance'],
      ['/exam-entry',                'governance'],
      ['/exam-timetable',            'governance'],
      ['/ratification',              'governance'],
      ['/hear',                      'progression'],
      ['/award',                     'progression'],
      ['/classification',            'progression'],
      ['/progression',               'progression'],
      ['/regulatory',                'regulatory'],
      ['/students',                  'students'],
      ['/enrolments',                'enrolments'],
      ['/marks',                     'assessment'],
      ['/result',                    'assessment'],
      ['/module-registrations',      'module-registrations'],
      ['/programmes',                'catalogue'],
      ['/modules',                   'catalogue'],
      ['/module-relationships',      'catalogue'],
      ['/learning-outcomes',         'catalogue'],
      ['/academic-periods',          'calendar'],
      ['/components',                'assessment'],
      ['/module-offerings',          'calendar'],
      ['/value-sets',                'value-sets'],
      ['/fields/',                   'value-sets'],
      ['/workflow-',                 'platform-controls'],
      ['/feature-flags',             'platform-controls'],
      ['/environments',              'platform-controls'],
      ['/environment-runtime',       'platform-controls'],
      ['/environment-promotions',    'platform-controls'],
      ['/tenants',                   'tenant-admin'],
      ['/academic-rules',            'tenant-admin'],
      ['/tenant/',                   'tenant-admin'],
      ['/globalisation',             'globalisation'],
      ['/communication',             'communications'],
      ['/integration-contracts',     'integration-registry'],
      ['/integration-registrations', 'integration-registry'],
      ['/integration-exchanges',     'integration-registry'],
    ];

    const method = Array.isArray(routeOptions.method)
      ? (routeOptions.method[0] ?? 'GET')
      : routeOptions.method;

    const extensions: Record<string, unknown> = {
      operationId:           generateOperationId(method, routeOptions.url),
      'x-publication-class': classifyOperation(method, routeOptions.url),
    };

    for (const [prefix, tag] of tagMap) {
      if (routeOptions.url.includes(prefix)) {
        extensions['tags'] = [tag];
        break;
      }
    }

    Object.assign(routeOptions, { schema: { ...(routeOptions.schema ?? {}), ...extensions } });
  });

  // - Routes -

  await fastify.register(healthRoutes);
  await fastify.register(valueSetsRoutes,           { prefix: '/api/v1' });
  await fastify.register(adjustmentRoutes,          { prefix: '/api/v1' });
  await fastify.register(engagementRoutes,          { prefix: '/api/v1' });
  await fastify.register(circumstancesRoutes,       { prefix: '/api/v1' });
  await fastify.register(examBoardRoutes,           { prefix: '/api/v1' });
  await fastify.register(progressionRoutes,         { prefix: '/api/v1' });
  await fastify.register(correctionCasesRoutes,     { prefix: '/api/v1' });
  await fastify.register(regulatoryHesaRoutes,      { prefix: '/api/v1' });
  await fastify.register(regulatorySlcRoutes,       { prefix: '/api/v1' });
  await fastify.register(regulatoryUcasRoutes,      { prefix: '/api/v1' });
  await fastify.register(regulatoryUkviRoutes,      { prefix: '/api/v1' });
  await fastify.register(regulatoryOfsRoutes,       { prefix: '/api/v1' });
  await fastify.register(regulatoryFoiRoutes,       { prefix: '/api/v1' });
  await fastify.register(studentRoutes,             { prefix: '/api/v1' });
  await fastify.register(enrolmentRoutes,           { prefix: '/api/v1' });
  await fastify.register(programmesRoutes,          { prefix: '/api/v1' });
  await fastify.register(academicPeriodsRoutes,     { prefix: '/api/v1' });
  await fastify.register(assessmentComponentRoutes, { prefix: '/api/v1' });
  await fastify.register(markRoutes,                { prefix: '/api/v1' });
  await fastify.register(moduleResultRoutes,        { prefix: '/api/v1' });
  await fastify.register(moduleRegistrationsRoutes, { prefix: '/api/v1' });
  await fastify.register(tenantAdminRoutes,         { prefix: '/api/v1' });
  await fastify.register(platformControlRoutes,         { prefix: '/api/v1' });
  await fastify.register(integrationRegistryRoutes,     { prefix: '/api/v1' });
  await fastify.register(globalisationRoutes,       { prefix: '/api/v1' });
  await fastify.register(communicationRoutes,       { prefix: '/api/v1' });
  await fastify.register(reportingRoutes,            { prefix: '/api/v1' });
  await fastify.register(auditLogRoutes,             { prefix: '/api/v1' });
  await fastify.register(adminRetentionRoutes,       { prefix: '/api/v1' });
  await fastify.register(notificationRoutes,         { prefix: '/api/v1' });
  await fastify.register(demoRoutes);

  // Canonical OpenAPI spec endpoint — served alongside the Swagger UI at /api/v1/docs
  fastify.get(
    '/api/v1/openapi.json',
    { schema: { hide: true }, config: { skipAuth: true } },
    async (_req, reply) => reply.send(fastify.swagger()),
  );

  return fastify;
}

// Fastify module augmentation for decorated properties
declare module 'fastify' {
  interface FastifyInstance {
    db:               ReturnType<typeof createDb>;
    config:           Config;
    audit:            AuditService;
    rules:            RulesEngine;
    valueSetService:  ValueSetService;
    eventBus:         IntegrationBusPublisher;
    studentService:   StudentService;
    enrolmentService: EnrolmentService;
    engagementService: EngagementService;
    catalogueService: CatalogueService;
    calendarService:  CalendarService;
    moduleRegistrationService: ModuleRegistrationService;
    tenantAdminService: TenantAdminService;
    assessmentComponentService: AssessmentComponentService;
    moduleResultService: ModuleResultService;
    markService: MarkService;
    adjustmentService: AdjustmentService;
    exceptionalCircumstancesService: ExceptionalCircumstancesService;
    misconductService: MisconductService;
    boardService: BoardService;
    progressionService: ProgressionService;
    awardService:       AwardService;
    hearService:        HearService;
    correctionService:  CorrectionService;
    regulatoryExchangeService: RegulatoryExchangeService;
    integrationRegistryService: IntegrationRegistryService;
    workflowDefinitionService: WorkflowDefinitionService;
    workflowInstanceService: WorkflowInstanceService;
    workflowTaskService: WorkflowTaskService;
    workflowBridgeService: WorkflowBridgeService;
    workflowResponsibilityService: WorkflowResponsibilityService;
    featureFlagService: FeatureFlagService;
    environmentService: EnvironmentService;
    ucasService:        UcasService;
    hesaService:        HesaService;
    slcService:         SlcService;
    ukviService:        UkviService;
    ofsService:         OfsService;
    foiService:         FoiService;
    examEntryService:   ExamEntryService;
    localeService:        LocaleService;
    currencyService:      CurrencyService;
    communicationService: CommunicationService;
    demoService:          DemoService;
    retentionService:     RetentionEnforcementService;
    notificationService:  NotificationService;
  }
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}
