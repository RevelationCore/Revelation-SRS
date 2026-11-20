import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import multipart from '@fastify/multipart';
import rateLimiter from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { trace } from '@opentelemetry/api';
import { assertSecureAuthConfig, jwtPlugin, jwtPluginOptions, tenantContextPlugin } from '@revelation-srs/auth';
import { createDb } from '@revelation-srs/db';
import type { DomainError } from '@revelation-srs/domain';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';

import type { Config } from './config.js';
import { AdjustmentService } from './platform/adjustments/adjustment-service.js';
import { AdjustmentDistributionDispatcher } from './platform/adjustments/distribution-dispatcher.js';
import { AdjustmentTargetConfigService } from './platform/adjustments/target-config.js';
import { AdjustmentTaskNoticeService } from './platform/adjustments/task-notices.js';
import { DeliveryService } from './platform/delivery/delivery-service.js';
import { BusinessCaseService } from './platform/cases/business-case-service.js';
import { IdentityResolutionService } from './platform/identity/identity-resolution-service.js';
import { SupervisionService } from './platform/pgr/supervision-service.js';
import { ProgressReviewService } from './platform/pgr/progress-review-service.js';
import { ExaminationService } from './platform/pgr/examination-service.js';
import { CompletionService } from './platform/pgr/completion-service.js';
import { EngagementOutcomeService } from './platform/engagement-outcomes/service.js';
import { AssessmentComponentService } from './platform/assessment/component-service.js';
import { MarkService } from './platform/assessment/mark-service.js';
import { ModerationService } from './platform/assessment/moderation-service.js';
import { ModuleResultService } from './platform/assessment/module-result-service.js';
import { AuditService } from './platform/audit/service.js';
import { AuditReviewService } from './platform/audit/review-service.js';
import { CalendarService } from './platform/calendar/service.js';
import { CatalogueService } from './platform/catalogue/service.js';
import { ExceptionalCircumstancesService } from './platform/circumstances/ec-service.js';
import { MisconductService } from './platform/circumstances/misconduct-service.js';
import { EnrolmentService } from './platform/enrolment/service.js';
import { ExamEntryService } from './platform/assessment/exam-entry-service.js';
import { BoardService } from './platform/governance/board-service.js';
import { BoardAuthorityService } from './platform/governance/board-authority-service.js';
import { AdmissionsService } from './platform/admissions/admissions-service.js';
import { CommunicationService } from './platform/communications/communication-service.js';
import { EmailService } from './platform/email/email-service.js';
import { FakeEmailTransport } from './platform/integration/simulators/email-simulator.js';
import { LocaleService } from './platform/globalisation/locale-service.js';
import { CurrencyService } from './platform/globalisation/currency-service.js';
import { IntegrationBusPublisher } from './platform/integration-bus/publisher.js';
import { AwardService } from './platform/progression/award-service.js';
import { HearService } from './platform/progression/hear-service.js';
import { ProgressionService } from './platform/progression/progression-service.js';
import { CorrectionService } from './platform/governance/correction-service.js';
import { ModuleRegistrationService } from './platform/registration/service.js';
import { SelectionWindowService } from './platform/module-selection/window-service.js';
import { ModuleSubjectService } from './platform/module-selection/joint-honours.js';
import { TimetableService } from './platform/timetabling/timetable-service.js';
import { ModuleSelectionService } from './platform/module-selection/service.js';
import { BindingChangeService } from './platform/module-selection/binding-change-service.js';
import { IntegrationRegistryService } from './platform/integration/registry-service.js';
import { RegulatoryExchangeService } from './platform/regulatory/exchange-service.js';
import { EnvironmentService } from './platform/platform-controls/environment-service.js';
import { FeatureFlagService } from './platform/platform-controls/feature-flag-service.js';
import { WorkflowBridgeService } from './platform/platform-controls/workflow-bridge-service.js';
import {
  ReviewExecutionService,
  type TemporalExecutionSettings,
  type TemporalGateway,
} from './platform/platform-controls/review-execution-service.js';
import { ReviewActivitiesService } from './platform/platform-controls/review-activities.js';
import { SdkTemporalGateway } from './platform/platform-controls/temporal-gateway.js';
import { WorkflowReconciler } from './platform/platform-controls/workflow-reconciler.js';
import { WorkflowDefinitionService } from './platform/platform-controls/workflow-definition-service.js';
import { WorkflowResponsibilityService } from './platform/platform-controls/workflow-responsibility-service.js';
import { WorkflowBuilderService } from './platform/platform-controls/workflow-builder-service.js';
import { WorkflowEscalationService } from './platform/platform-controls/workflow-escalation-service.js';
import { WorkflowInstanceService, WorkflowTaskService } from './platform/platform-controls/workflow-runtime-service.js';
import { DemoService } from './platform/demo/service.js';
import { RetentionEnforcementService } from './platform/privacy/retention-service.js';
import { RightsRequestService } from './platform/privacy/rights-request-service.js';
import { NotificationService } from './platform/notifications/notification-service.js';
import { FoiService } from './platform/regulatory/foi-service.js';
import { HesaService } from './platform/regulatory/hesa-service.js';
import { OfsService } from './platform/regulatory/ofs-service.js';
import { RegulatoryCollectionService } from './platform/regulatory/regulatory-collection-service.js';
import { SlcService } from './platform/regulatory/slc-service.js';
import { UcasService } from './platform/regulatory/ucas-service.js';
import { UkviService } from './platform/regulatory/ukvi-service.js';
import { CasCaseService } from './platform/regulatory/cas-case-service.js';
import { RulesEngine } from './platform/rules-engine/engine.js';
import { StudentService } from './platform/students/service.js';
import { TenantAdminService } from './platform/tenant-admin/service.js';
import { ValueSetService } from './platform/value-sets/service.js';
import { TriggerRuleEvaluator } from './platform/workflow/trigger-rule-service.js';
import { assessmentComponentRoutes } from './routes/assessment-components.js';
import { academicPeriodsRoutes } from './routes/academic-periods.js';
import { circumstancesRoutes } from './routes/circumstances.js';
import { enrolmentRoutes } from './routes/enrolments.js';
import { examBoardRoutes } from './routes/exam-boards.js';
import { boardAuthorityRoutes } from './routes/board-authority.js';
import { healthRoutes } from './routes/health.js';
import { markRoutes } from './routes/marks.js';
import { moderationRoutes } from './routes/moderation.js';
import { moduleResultRoutes } from './routes/module-results.js';
import { moduleRegistrationsRoutes } from './routes/module-registrations.js';
import { moduleAllocationRoutes, moduleSelectionWindowsRoutes } from './routes/module-selection-windows.js';
import { AllocationService } from './platform/module-selection/allocation-service.js';
import { runTimetableDemandSnapshot } from './platform/delivery/producers/timetable-demand.js';
import { timetablingRoutes } from './routes/timetabling.js';
import { moduleSelectionProposalsRoutes } from './routes/module-selection-proposals.js';
import { programmesRoutes } from './routes/programmes.js';
import { progressionRoutes } from './routes/progression.js';
import { regulatoryFoiRoutes } from './routes/regulatory-foi.js';
import { regulatoryHesaRoutes } from './routes/regulatory-hesa.js';
import { regulatoryOfsRoutes } from './routes/regulatory-ofs.js';
import { regulatorySlcRoutes } from './routes/regulatory-slc.js';
import { regulatoryUcasRoutes } from './routes/regulatory-ucas.js';
import { regulatoryUkviRoutes } from './routes/regulatory-ukvi.js';
import { regulatoryCollectionsRoutes } from './routes/regulatory-collections.js';
import { casCasesRoutes } from './routes/cas-cases.js';
import { studentRoutes } from './routes/students.js';
import { tenantAdminRoutes } from './routes/tenant-admin.js';
import { valueSetsRoutes } from './routes/value-sets.js';
import { globalisationRoutes } from './routes/globalisation.js';
import { adjustmentRoutes } from './routes/adjustments.js';
import { deliveryRoutes, inboundRoutes } from './routes/delivery.js';
import { supportRoutes } from './routes/support.js';
import { statusCaseRoutes } from './routes/status-cases.js';
import { nonRegistrationRoutes, registrationPeriodRoutes } from './routes/registration-periods.js';
import { publicVerificationRoutes } from './routes/public-verification.js';
import { ucasDecisionRoutes } from './routes/ucas-decisions.js';
import { signerFromEnv } from './platform/progression/document-signer.js';
import { PdfmakeRenderer } from './platform/progression/document-renderer.js';
import { registrationCheckRoutes } from './routes/registration-checks.js';
import { clockNow } from './platform/clock.js';
import { ClearingService } from './platform/admissions/clearing-service.js';
import { UcasDecisionOutbox } from './platform/regulatory/ucas-decision-outbox.js';
import { UcasResultsService } from './platform/regulatory/ucas-results-service.js';
import { ApplicantConversionService } from './platform/admissions/applicant-conversion-service.js';
import { NonRegistrationService } from './platform/registration-periods/non-registration-service.js';
import { RegistrationPeriodService, composeBlockers } from './platform/registration-periods/service.js';
import { FinancialRegistrationService } from './platform/registration/financial-registration-service.js';
import { RightToStudyService } from './platform/registration/right-to-study-service.js';
import { curriculumPublicationRoutes } from './routes/curriculum-publications.js';
import { awardConfermentRoutes } from './routes/award-conferment.js';
import { awardDocumentRoutes } from './routes/award-documents.js';
import { applicationRoutes } from './routes/applications.js';
import { applicantPortalRoutes } from './routes/applicant-portal.js';
import { ApplicantPortalService } from './platform/admissions/applicant-portal-service.js';
import { SupportService } from './platform/support/support-service.js';
import { requestAccountAccess, requestAccountClosure } from './platform/delivery/producers/access.js';
import { StatusCaseService } from './platform/status-cases/status-case-service.js';
import { CurriculumPublicationService } from './platform/curriculum/publication-service.js';
import { AcademicExceptionService } from './platform/curriculum/academic-exception-service.js';
import { ConfermentService } from './platform/progression/conferment-service.js';
import { AwardDocumentService } from './platform/progression/award-document-service.js';
import { GraduationService } from './platform/progression/graduation-service.js';
import { ApplicationService } from './platform/admissions/application-service.js';
import { EmploymentService } from './platform/support/employment-service.js';
import { InboundRecordService } from './platform/delivery/inbound.js';
import { engagementOutcomeRoutes } from './routes/engagement-outcomes.js';
import { engagementProxyRoutes } from './routes/engagement-proxy.js';
import { communicationRoutes } from './routes/communications.js';
import { correctionCasesRoutes } from './routes/correction-cases.js';
import { identityResolutionRoutes } from './routes/identity-resolution.js';
import { pgrRoutes } from './routes/pgr.js';
import { researchStaffRoutes } from './routes/research-staff.js';
import { nonWorkingDayRoutes } from './routes/non-working-days.js';
import { emailRoutes, emailSimulatorRoutes } from './routes/email.js';
import { EcDeterminationService } from './platform/circumstances/ec-determination-service.js';
import { ResearchStaffService } from './platform/pgr/research-staff-service.js';
import { demoRoutes } from './routes/demo.js';
import { integrationRegistryRoutes } from './routes/integration-registry.js';
import { platformControlRoutes } from './routes/platform-controls.js';
import { reportingRoutes } from './routes/reporting.js';
import { auditLogRoutes } from './routes/audit-log.js';
import { adminRetentionRoutes } from './routes/admin-retention.js';
import { auditReviewRoutes } from './routes/audit-review.js';
import { rightsRequestsRoutes } from './routes/rights-requests.js';
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
  if (path.startsWith('/email-simulator')) return 'private';

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
    '/transitions', '/withdraw', '/graduation',
    '/completion', '/ratification', '/deferral', '/quorum',
    '/external-examiner-signoff', '/generate', '/validate', '/submit',
    '/amendments', '/slc-status-notification', '/expire', '/acknowledge',
    '/retirement', '/link', '/attendance',
  ];
  if (m === 'POST' && WORKFLOW_ACTIONS.some(a => path.includes(a))) return 'workflow';
  if (m === 'POST' && (path.includes('/progression') || path.includes('/award') || path.includes('/classification') || path.includes('/hear'))) return 'workflow';
  if ((m === 'POST' || m === 'PATCH') && path.includes('/correction-cases')) return 'workflow';
  if (m === 'PATCH' && path.includes('/status') && path.includes('/regulatory')) return 'workflow';
  if (m === 'POST' && path.includes('/cas-cases')) return 'workflow';
  if (m === 'POST' && path.includes('/exam-entries')) return 'workflow';
  if ((m === 'POST' || m === 'PATCH') && path.includes('/moderation')) return 'workflow';
  if (m === 'POST' && path.includes('/conflicts')) return 'workflow';
  if (m === 'POST' && path.includes('/decisions')) return 'workflow';
  if (m === 'PATCH' && path.includes('/recuse')) return 'workflow';
  if (m === 'PATCH' && path.includes('/publish')) return 'workflow';
  if (m === 'POST' && path.includes('/signoff')) return 'workflow';
  if (m === 'POST' && path.includes('/identity-resolution')) return 'workflow';
  if ((m === 'POST' || m === 'PATCH') && path.includes('/rights-requests')) return 'workflow';
  if ((m === 'POST' || m === 'PATCH') && path.includes('/rights-restrictions')) return 'workflow';
  if (m === 'POST' && path.includes('/retention-schedules')) return 'workflow';
  if (m === 'POST' && path.includes('/retention-assignments')) return 'workflow';
  if (m === 'POST' && path.includes('/audit-review')) return 'workflow';
  if (m === 'POST' && path.includes('/data-pack')) return 'workflow';

  // Reporting — regulatory submission data and read-only compliance extracts
  if (path.includes('/regulatory/')) return 'reporting';

  // Integration — surfaces for adjacent system connectivity
  if (path.includes('/adjustments') || path.includes('/adjustment-tasks') || path.includes('/adjustment-targets')) return 'integration';
  if (path.includes('/delivery-') || path.includes('/inbound') || path.includes('/external-records')) return 'integration';
  if (path.includes('/engagement-outcomes')) return 'integration';
  if (path.includes('/communication-templates') || path.includes('/communication-dispatch-log')) return 'integration';
  if (path.startsWith('/email/')) return 'integration';

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
  overrides: { eventBus?: IntegrationBusPublisher; temporalGateway?: TemporalGateway } = {},
): Promise<FastifyInstance> {
  assertSecureAuthConfig('srs-api', config.nodeEnv, config);

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
    // Behind the ingress, req.ip is otherwise the ingress pod, and every
    // per-IP limit becomes one budget shared by all callers (BL-168).
    trustProxy: config.trustProxy ?? false,
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

  // Each curriculum object type has one master (Phase 3 D-22 rule 5): when the
  // curriculum system masters a type, the SRS's own write routes for it refuse.
  fastify.addHook('preHandler', async (request, reply) => {
    if (request.method === 'GET' || !request.tenantId) return;
    const type = curriculumWriteType(request.method, request.routeOptions.url ?? '');
    if (!type) return;
    if ((await fastify.curriculumPublicationService.masteredBy(request.tenantId, type)) === 'curriculum-system') {
      await reply.code(409).send({
        type: 'https://srs.example.com/errors/conflict', title: 'Mastered by the curriculum system', status: 409,
        detail: `${type.replace(/-/g, ' ')} records are mastered by the curriculum system: change them there and they arrive in a publication`,
      });
    }
  });

  // - Platform infrastructure -

  const db         = createDb(config.databaseUrl);
  const audit      = new AuditService(db);
  const rules      = new RulesEngine(db);
  const valueSets  = new ValueSetService(db);
  const eventBus   = overrides.eventBus ?? new IntegrationBusPublisher(config.natsUrl);
  const featureFlags = new FeatureFlagService(db);
  const triggerRules = new TriggerRuleEvaluator(db, featureFlags);
  const workflowBridge = new WorkflowBridgeService(db, audit, eventBus);

  // Live Temporal execution (ADR-024). Off unless TEMPORAL_EXECUTION_ENABLED
  // is set; then the rollout flag picks which new reviews use it.
  const temporalSettings: TemporalExecutionSettings = {
    enabled: config.temporalExecutionEnabled ?? false,
    namespace: config.temporalNamespace ?? 'srs-local',
    taskQueue: config.temporalTaskQueue ?? 'srs-workflows',
    environmentCode: config.deploymentEnvironmentCode,
    decisionWaitMs: config.temporalDecisionWaitMs ?? 10_000,
  };
  const temporalGateway: TemporalGateway | null = overrides.temporalGateway
    ?? (temporalSettings.enabled
      ? new SdkTemporalGateway({
          address: config.temporalAddress,
          namespace: temporalSettings.namespace,
          taskQueue: temporalSettings.taskQueue,
        })
      : null);
  const reviewExecution = new ReviewExecutionService(
    db, audit, workflowBridge.outbox, featureFlags, temporalSettings, temporalGateway,
  );
  const reviewActivities = new ReviewActivitiesService(
    db, audit, workflowBridge.outbox, (input) => workflowBridge.recordWorkflowEvent(input),
  );
  const workflowReconciler = new WorkflowReconciler(db, reviewExecution, workflowBridge.outbox, {
    graceSeconds: config.temporalReconcileGraceSeconds ?? 15,
    batchSize: 50,
  });
  const deliveries = new DeliveryService(db, eventBus, valueSets, (err, context) => {
    fastify.log.warn({ err, ...context }, 'Delivery item not yet published; it stays due for the reconcile loop');
  });
  const students   = new StudentService(db, valueSets, workflowBridge, deliveries, reviewExecution);
  students.registerWorkflowEffects(reviewActivities);
  const enrolments = new EnrolmentService(db, eventBus, valueSets, triggerRules, deliveries);
  const catalogue  = new CatalogueService(db, eventBus, valueSets);
  const calendar   = new CalendarService(db);
  const selectionWindows = new SelectionWindowService(db);
  const timetables = new TimetableService(db, valueSets);
  const registrations = new ModuleRegistrationService(db, eventBus, rules, selectionWindows, workflowBridge, reviewExecution, deliveries);
  registrations.registerWorkflowEffects(reviewActivities);
  const tenantAdmin = new TenantAdminService(db);
  const assessmentComponents = new AssessmentComponentService(db, valueSets);
  const moduleResults = new ModuleResultService(db, eventBus, rules);
  const marks = new MarkService(db, eventBus, rules, moduleResults, featureFlags);
  const moderation = new ModerationService(db);
  const adjustmentDispatcher = new AdjustmentDistributionDispatcher(db, eventBus, (err, context) => {
    fastify.log.warn({ err, ...context }, 'Adjustment instruction not yet published; it stays due for the reconcile loop');
  });
  const adjustmentTargets = new AdjustmentTargetConfigService(db, valueSets);
  const adjustments = new AdjustmentService(db, eventBus, valueSets, adjustmentDispatcher, adjustmentTargets);
  const businessCases = new BusinessCaseService(db);
  const auditReview = new AuditReviewService(db, businessCases);
  const identityResolution = new IdentityResolutionService(db, businessCases);
  const engagementOutcomes = new EngagementOutcomeService(db, eventBus);
  const exceptionalCircumstances = new ExceptionalCircumstancesService(db, eventBus);
  const misconduct = new MisconductService(db, valueSets, eventBus);
  const progression = new ProgressionService(db, eventBus, rules, deliveries);
  const awards      = new AwardService(db, eventBus, rules, enrolments);
  const conferment = new ConfermentService(db, valueSets, enrolments, awards);
  // Rendered with pdfmake and signed by the configured signer (Phase 3 D-20).
  const awardDocuments = new AwardDocumentService(db, valueSets, businessCases, signerFromEnv(), new PdfmakeRenderer(), config.publicApiUrl ?? `http://localhost:${config.port}`);
  const graduation = new GraduationService(db);
  const boards = new BoardService(db, eventBus, valueSets, awards, featureFlags, rules);
  const boardAuthority = new BoardAuthorityService(db);
  const hear        = new HearService(db);
  const corrections = new CorrectionService(db, eventBus, marks, moduleResults, progression, valueSets, businessCases);
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
  const moduleSelection = new ModuleSelectionService(db, eventBus, rules, workflowBridge, registrations, selectionWindows, timetables, reviewExecution);
  const bindingChanges = new BindingChangeService(db, valueSets, enrolments, moduleSelection);
  const notificationService = new NotificationService(db);
  // Registration is blocked by right to study and, if the tenant chooses, a tuition hold (Phase 3 D-17, D-18).
  const rightToStudy = new RightToStudyService(db, valueSets, notificationService);
  const financialRegistration = new FinancialRegistrationService(db, valueSets, enrolments, businessCases, deliveries);
  const registrationPeriods = new RegistrationPeriodService(db, valueSets, eventBus, composeBlockers(rightToStudy, financialRegistration));
  fastify.decorate('rightToStudyService', rightToStudy);
  fastify.decorate('financialRegistrationService', financialRegistration);
  moduleSelection.registerWorkflowEffects(reviewActivities);
  const workflowResponsibilities = new WorkflowResponsibilityService(db);
  const workflowBuilder = new WorkflowBuilderService(db, workflowResponsibilities);
  const workflowEscalation = new WorkflowEscalationService(db, workflowBridge);
  const environments = new EnvironmentService(db, runtimeDeployment);
  const admissions    = new AdmissionsService(db, workflowBridge, reviewExecution);
  const applications = new ApplicationService(db, valueSets, students, admissions);
  const localeService   = new LocaleService(db, audit);
  const currencyService = new CurrencyService(db, audit);
  // Only the fake mail server ships as an email transport (config.emailTransport).
  const emailService    = new EmailService(db, new FakeEmailTransport(db), config.emailFromAddress ?? 'registry@revelation.example.ac.uk');
  const communications  = new CommunicationService(db, localeService, featureFlags, emailService);
  const adjustmentTaskNotices = new AdjustmentTaskNoticeService(db, adjustments, adjustmentTargets, communications, config.adminAppUrl, deliveries);
  const ucas = new UcasService(db, valueSets, eventBus, enrolments, regulatoryExchanges, admissions, featureFlags, workflowBridge, reviewExecution, applications);
  // UCAS outbound decisions and results mapped to conditions (Phase 3 D-14, D-15).
  const ucasOutbox = new UcasDecisionOutbox(db, regulatoryExchanges);
  applications.useUcasOutbox(ucasOutbox);
  ucas.useDecisionOutbox(ucasOutbox);
  const ucasResults = new UcasResultsService(db, applications, regulatoryExchanges);
  fastify.decorate('ucasDecisionOutbox', ucasOutbox);
  fastify.decorate('ucasResultsService', ucasResults);
  const hesa = new HesaService(db, eventBus, students, regulatoryExchanges, workflowBridge, reviewExecution);
  const slc = new SlcService(db, eventBus, valueSets, enrolments, regulatoryExchanges, workflowBridge, reviewExecution);
  // An SLC tuition-fee-loan confirmation arranges that year's financial registration (D-18).
  slc.onNotification(async (tenantId, notification, actorId) => {
    const loanType = (notification.rawPayload?.['loanType'] as string | undefined) ?? 'tuition-fee';
    if (notification.notificationTypeCode !== 'entitlement-confirmed' || loanType !== 'tuition-fee') return;
    const academicYear = typeof notification.rawPayload?.['academicYear'] === 'string'
      ? notification.rawPayload['academicYear']
      : academicYearOf(notification.effectiveDate);
    await financialRegistration.applySlcTuitionLoan(tenantId, notification.enrolmentId, academicYear, actorId);
  });
  const casCases = new CasCaseService(db, eventBus, regulatoryExchanges);
  const ukvi = new UkviService(db, eventBus, valueSets, rules, regulatoryExchanges, workflowBridge, reviewExecution, casCases);
  // A visa status change means the right to study is checked again; it is never inferred from the update (D-17).
  ukvi.onVisaStatus((tenantId, personId, statusCode, actorId) =>
    rightToStudy.markRecheckRequired(tenantId, personId, `UKVI visa status changed to ${statusCode}`, actorId));
  const ofs = new OfsService(db, eventBus, workflowBridge, reviewExecution);
  // ADR-024 Stage 6a: approvals that change a record, applied by the worker on Temporal-run reviews.
  for (const service of [ucas, hesa, slc, ofs]) service.registerWorkflowEffects(reviewActivities);
  const regulatoryCollectionService = new RegulatoryCollectionService(db);
  const foi = new FoiService(db, valueSets);
  const examEntries = new ExamEntryService(db, eventBus, regulatoryExchanges, adjustments);
  const pgrSupervision = new SupervisionService(db, businessCases, regulatoryExchanges, deliveries);
  const pgrProgressReview = new ProgressReviewService(db, businessCases, regulatoryExchanges, valueSets);
  const pgrExamination = new ExaminationService(db, businessCases, valueSets);
  const pgrCompletion = new CompletionService(db, businessCases, pgrExamination, pgrSupervision, awards, regulatoryExchanges);

  // Decorate the Fastify instance so plugins and routes can access shared services
  fastify.decorate('config',          config);
  fastify.decorate('db',              db);
  fastify.decorate('audit',           audit);
  fastify.decorate('auditReviewService', auditReview);
  fastify.decorate('rules',           rules);
  fastify.decorate('valueSetService', valueSets);
  fastify.decorate('eventBus',        eventBus);
  fastify.decorate('studentService',  students);
  fastify.decorate('enrolmentService', enrolments);
  fastify.decorate('catalogueService', catalogue);
  fastify.decorate('calendarService',  calendar);
  fastify.decorate('moduleRegistrationService', registrations);
  fastify.decorate('selectionWindowService', selectionWindows);
  fastify.decorate('moduleSubjectService', new ModuleSubjectService(db, valueSets));
  fastify.decorate('timetableService', timetables);
  // An applied allocation sends timetabling the rosters it produced (D-26).
  const allocation = new AllocationService(db, moduleSelection, selectionWindows, timetables, workflowBridge, reviewExecution,
    async (tenantId, academicPeriodId) => { await runTimetableDemandSnapshot(deliveries, db, tenantId, academicPeriodId); });
  allocation.registerWorkflowEffects(reviewActivities);
  fastify.decorate('allocationService', allocation);
  fastify.decorate('moduleSelectionService', moduleSelection);
  fastify.decorate('bindingChangeService', bindingChanges);
  fastify.decorate('registrationPeriodService', registrationPeriods);
  fastify.decorate('tenantAdminService', tenantAdmin);
  fastify.decorate('assessmentComponentService', assessmentComponents);
  fastify.decorate('moduleResultService', moduleResults);
  fastify.decorate('markService', marks);
  fastify.decorate('moderationService', moderation);
  fastify.decorate('adjustmentService', adjustments);
  fastify.decorate('adjustmentDispatcher', adjustmentDispatcher);
  fastify.decorate('adjustmentTargetConfigService', adjustmentTargets);
  fastify.decorate('adjustmentTaskNoticeService', adjustmentTaskNotices);
  fastify.decorate('deliveryService', deliveries);
  const inboundRecords = new InboundRecordService(db, valueSets);
  const support = new SupportService(db, valueSets, deliveries);
  const statusCases = new StatusCaseService(db, valueSets, enrolments, businessCases, rules);
  // An approved leaver closure ends the institutional account after the grace period (D-19).
  statusCases.onLeaverClosure(async (tenantId, closure) => {
    const enrolment = await enrolments.getEnrolment(closure.enrolmentId, tenantId);
    await requestAccountClosure(deliveries, db, tenantId, {
      personId: closure.personId, enrolmentId: closure.enrolmentId, endStatus: enrolment?.statusCode ?? 'withdrawn',
      decidedAt: closure.decidedAt, changeKey: `leaver-closure:${closure.statusCaseId}`,
    });
  });
  const curriculumPublications = new CurriculumPublicationService(db);
  const academicExceptions = new AcademicExceptionService(db, valueSets, enrolments);
  const employment = new EmploymentService(db, valueSets, support);
  // A payroll confirmation that names an SRS instruction reconciles it.
  inboundRecords.onReceived(async (tenantId, record) => {
    if (record.flowCode !== 'F-PAY-SIS-01' || typeof record.payload['instructionId'] !== 'string') return;
    const p = record.payload;
    await support.reconcilePayment(tenantId, record.personId, {
      instructionId: p['instructionId'] as string,
      paymentReference: String(p['paymentReference']),
      paymentStatus: p['paymentStatus'] === 'rejected' ? 'rejected' : 'paid',
      ...(typeof p['amountPence'] === 'number' ? { amountPence: p['amountPence'] } : {}),
      ...(typeof p['paidOn'] === 'string' ? { paidOn: p['paidOn'] } : {}),
      ...(typeof p['rejectionReason'] === 'string' ? { rejectionReason: p['rejectionReason'] } : {}),
    });
  });
  fastify.decorate('inboundRecordService', inboundRecords);
  fastify.decorate('supportService', support);
  fastify.decorate('statusCaseService', statusCases);
  fastify.decorate('curriculumPublicationService', curriculumPublications);
  fastify.decorate('academicExceptionService', academicExceptions);
  fastify.decorate('confermentService', conferment);
  fastify.decorate('awardDocumentService', awardDocuments);
  fastify.decorate('graduationService', graduation);
  fastify.decorate('applicationService', applications);
  // A person bound to an application gets an applicant account (D-38, D-39).
  applications.useAccountRequests((tenantId, personId, changeKey) => requestAccountAccess(deliveries, db, tenantId, { personId, changeKey }));
  fastify.decorate('applicantPortalService', new ApplicantPortalService(db, applications, valueSets));
  fastify.decorate('employmentService', employment);
  fastify.decorate('businessCaseService', businessCases);
  fastify.decorate('identityResolutionService', identityResolution);
  fastify.decorate('engagementOutcomeService', engagementOutcomes);
  fastify.decorate('exceptionalCircumstancesService', exceptionalCircumstances);
  const ecDeterminations = new EcDeterminationService(db, exceptionalCircumstances, valueSets, workflowBridge, reviewExecution);
  ecDeterminations.registerWorkflowEffects(reviewActivities);
  fastify.decorate('ecDeterminationService', ecDeterminations);
  fastify.decorate('misconductService', misconduct);
  fastify.decorate('boardService', boards);
  fastify.decorate('boardAuthorityService', boardAuthority);
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
  fastify.decorate('workflowBuilderService', workflowBuilder);
  fastify.decorate('workflowEscalationService', workflowEscalation);
  fastify.decorate('reviewExecutionService', reviewExecution);
  fastify.decorate('reviewActivitiesService', reviewActivities);
  fastify.decorate('workflowReconciler', workflowReconciler);
  fastify.addHook('onClose', async () => {
    if (temporalGateway instanceof SdkTemporalGateway) await temporalGateway.close();
  });
  fastify.decorate('featureFlagService', featureFlags);
  fastify.decorate('environmentService', environments);
  fastify.decorate('ucasService',        ucas);
  fastify.decorate('hesaService',        hesa);
  fastify.decorate('slcService',         slc);
  fastify.decorate('ukviService',        ukvi);
  fastify.decorate('casCaseService',     casCases);
  fastify.decorate('ofsService',         ofs);
  fastify.decorate('regulatoryCollectionService', regulatoryCollectionService);
  fastify.decorate('foiService',         foi);
  fastify.decorate('examEntryService',   examEntries);
  fastify.decorate('supervisionService', pgrSupervision);
  fastify.decorate('progressReviewService', pgrProgressReview);
  fastify.decorate('examinationService', pgrExamination);
  pgrExamination.useAccountRequests((tenantId, personId, changeKey) => requestAccountAccess(deliveries, db, tenantId, { personId, changeKey }));
  fastify.decorate('researchStaffService', new ResearchStaffService(db, pgrProgressReview, pgrExamination));
  fastify.decorate('completionService', pgrCompletion);
  fastify.decorate('localeService',       localeService);
  fastify.decorate('currencyService',     currencyService);
  fastify.decorate('communicationService', communications);
  fastify.decorate('emailService',         emailService);

  const demo = new DemoService(db);
  fastify.decorate('demoService', demo);

  const retentionService = new RetentionEnforcementService(db, audit);
  const rightsRequestService = new RightsRequestService(db, businessCases);
  fastify.decorate('retentionService', retentionService);
  fastify.decorate('rightsRequestService', rightsRequestService);

  const nonRegistration = new NonRegistrationService(db, valueSets, businessCases, statusCases, notificationService);
  registrationPeriods.onLapse(nonRegistration);
  registrationPeriods.onInitialRegistration(async (tenantId, enrolmentId, actorId) => {
    const enrolment = await enrolments.getEnrolment(enrolmentId, tenantId);
    if (enrolment?.statusCode === 'pre-registration') {
      await enrolments.transitionStatus(enrolmentId, tenantId, 'enrolled', clockNow(), actorId, { reasonText: 'Initial registration confirmed' });
    }
  });
  const applicantConversion = new ApplicantConversionService(db, enrolments, workflowBridge, workflowTasks, reviewExecution, casCases);
  fastify.decorate('applicantConversionService', applicantConversion);
  fastify.decorate('clearingService', new ClearingService(db, applications, businessCases));
  fastify.decorate('nonRegistrationService', nonRegistration);
  fastify.decorate('notificationService', notificationService);

  // - Security plugins -

  await fastify.register(helmet, { global: true });

  // Adjustment outcome-document uploads. Capped above the per-document
  // byte limit the storage adapter itself enforces, so the adapter's
  // DocumentTooLargeError (not a raw multipart abort) is what the caller
  // actually sees.
  await fastify.register(multipart, { limits: { fileSize: 20 * 1024 * 1024 } });

  await fastify.register(cors, {
    origin: config.corsOrigins,
    credentials: true,
  });

  await fastify.register(rateLimiter, {
    max:       1000,
    timeWindow: 60_000,
    keyGenerator: (req) => req.tenantId ?? req.ip,
  });

  await fastify.register(jwtPlugin, jwtPluginOptions(config, 'srs-api'));
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
        { name: 'admissions',           description: 'Applications, assessments, offers and conditions' },
        { name: 'enrolments',           description: 'Enrolment lifecycle' },
        { name: 'public-verification',  description: 'Verification of issued award documents without an account (D-21)' },
        { name: 'module-registrations', description: 'Module registration' },
        { name: 'catalogue',            description: 'Programme and module catalogue' },
        { name: 'calendar',             description: 'Academic calendar and periods' },
        { name: 'assessment',           description: 'Assessment structure and marks' },
        { name: 'adjustments',          description: 'Reasonable adjustments and distribution status' },
        { name: 'engagement-outcomes',  description: 'Recorded engagement outcomes handed off from the attendance module' },
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
        { name: 'module-selection',     description: 'Module selection proposals, diet groups, and curriculum rule-set binding' },
        { name: 'timetabling',          description: 'Timetable publications from the timetabling system, and clash data for selection (Phase 4 D-24)' },
        { name: 'pgr',                  description: 'Postgraduate research supervision, progress review, and examination' },
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
    // Verification without an account (D-21) is published too, as its own surface.
    if (routeOptions.url.startsWith('/public/v1')) {
      const m = Array.isArray(routeOptions.method) ? (routeOptions.method[0] ?? 'GET') : routeOptions.method;
      Object.assign(routeOptions, { schema: { ...(routeOptions.schema ?? {}),
        operationId: `public${generateOperationId(m, routeOptions.url.replace(/^\/public\/v1/, ''))}`, 'x-publication-class': 'public', tags: ['public-verification'] } });
      return;
    }
    if (!routeOptions.url.startsWith('/api/v1')) return;
    if ((routeOptions.schema as { hide?: boolean } | undefined)?.hide) return;

    const tagMap: Array<[string, string]> = [
      // More-specific patterns must precede their containing segments
      ['/adjustments',               'adjustments'],
      ['/adjustment-tasks',          'adjustments'],
      ['/adjustment-targets',        'adjustments'],
      ['/delivery-',                 'integration-registry'],
      ['/inbound',                   'integration-registry'],
      ['/support-',                  'students'],
      ['/status-case',               'enrolments'],
      ['/curriculum-publications',   'catalogue'],
      ['/recognised-credits',        'enrolments'],
      ['/curriculum-binding-changes', 'module-selection'],
      ['/registration-periods',      'enrolments'],
      ['/registration-confirmations', 'enrolments'],
      ['/non-registration-cases', 'enrolments'],
      ['/right-to-study', 'enrolments'],
      ['/financial-registration', 'enrolments'],
      ['/fee-liabilities', 'enrolments'],
      ['/fee-status-reassessments', 'enrolments'],
      ['/clearing', 'admissions'],
      ['/academic-exceptions',       'enrolments'],
      ['/rule-exceptions',           'enrolments'],
      ['/award-recommendations',     'progression'],
      ['/document-issues',           'progression'],
      ['/document-verifications',    'progression'],
      ['/document-revocation-requests', 'progression'],
      ['/document-signing-keys',     'progression'],
      ['/graduation-',               'progression'],
      ['/ceremony-allocations',      'progression'],
      ['/applicants/',               'admissions'],  // applicant self-service (D-39)
      ['/api/v1/applications',       'admissions'],  // anchored: UCAS has /regulatory/ucas/applications
      ['/admissions-offers',         'admissions'],
      ['/offer-conditions',          'admissions'],
      ['/reassessment-plans',        'progression'],
      ['/progression-decisions',     'progression'],
      ['/work-limits',               'tenant-admin'],
      ['/external-records',          'integration-registry'],
      ['/engagement-outcomes',       'engagement-outcomes'],
      ['/exceptional-circumstances', 'circumstances'],
      ['/ec-determinations',         'circumstances'],
      ['/misconduct-outcomes',       'circumstances'],
      ['/correction-cases',          'governance'],
      ['/identity-resolution',       'governance'],
      ['/rights-requests',           'governance'],
      ['/rights-restrictions',       'governance'],
      ['/retention-schedules',       'governance'],
      ['/retention-assignments',     'governance'],
      ['/audit-review',              'governance'],
      ['/exam-boards',               'governance'],
      ['/exam-entry',                'governance'],
      ['/exam-timetable',            'governance'],
      ['/ratification',              'governance'],
      ['/board-conflicts',           'governance'],
      ['/board-decisions',           'governance'],
      ['/hear',                      'progression'],
      ['/award',                     'progression'],
      ['/classification',            'progression'],
      ['/progression',               'progression'],
      ['/regulatory',                'regulatory'],
      ['/identity-change-requests',  'students'],
      ['/students',                  'students'],
      ['/research-staff/',           'pgr'],  // supervisor and examiner self-service (D-40)
      ['/pgr',                       'pgr'],
      ['/supervision',               'pgr'],
      ['/enrolments',                'enrolments'],
      ['/marks',                     'assessment'],
      ['/moderation',                'assessment'],
      ['/result',                    'assessment'],
      ['/module-results',            'assessment'],
      ['/module-registration-requests', 'module-registrations'],
      ['/module-registrations',      'module-registrations'],
      ['/module-selection-proposals', 'module-selection'],
      ['/enrolment-curriculum-bindings', 'module-selection'],
      ['/programme-rule-sets',       'module-selection'],
      ['/module-groups',             'module-selection'],
      ['/programmes',                'catalogue'],
      ['/modules',                   'catalogue'],
      ['/module-relationships',      'catalogue'],
      ['/learning-outcomes',         'catalogue'],
      ['/academic-periods',          'calendar'],
      ['/calendar/',                 'calendar'],
      ['/module-selection-windows',  'calendar'],
      ['/allocation-runs',           'module-selection'],
      ['/timetable-publications',    'timetabling'],
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
      ['/email',                     'communications'],
      ['/notifications',             'communications'],
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
  await fastify.register(deliveryRoutes,            { prefix: '/api/v1' });
  await fastify.register(inboundRoutes,             { prefix: '/api/v1' });
  await fastify.register(supportRoutes,             { prefix: '/api/v1' });
  await fastify.register(statusCaseRoutes,          { prefix: '/api/v1' });
  await fastify.register(registrationPeriodRoutes,  { prefix: '/api/v1' });
  await fastify.register(nonRegistrationRoutes,  { prefix: '/api/v1' });
  await fastify.register(registrationCheckRoutes, { prefix: '/api/v1' });
  await fastify.register(ucasDecisionRoutes, { prefix: '/api/v1' });
  // Verification without an account (D-21): unauthenticated, rate-limited, outside /api/v1.
  await fastify.register(publicVerificationRoutes, { prefix: '/public/v1' });
  await fastify.register(curriculumPublicationRoutes, { prefix: '/api/v1' });
  await fastify.register(awardConfermentRoutes,     { prefix: '/api/v1' });
  await fastify.register(awardDocumentRoutes,       { prefix: '/api/v1' });
  await fastify.register(applicationRoutes,         { prefix: '/api/v1' });
  await fastify.register(applicantPortalRoutes,     { prefix: '/api/v1' });
  await fastify.register(engagementOutcomeRoutes,   { prefix: '/api/v1' });
  await fastify.register(engagementProxyRoutes,     {
    prefix: '/api/v1',
    ...(config.engagementProxyTimeoutMs !== undefined ? { timeoutMs: config.engagementProxyTimeoutMs } : {}),
  });
  await fastify.register(circumstancesRoutes,       { prefix: '/api/v1' });
  await fastify.register(examBoardRoutes,           { prefix: '/api/v1' });
  await fastify.register(boardAuthorityRoutes,      { prefix: '/api/v1' });
  await fastify.register(progressionRoutes,         { prefix: '/api/v1' });
  await fastify.register(correctionCasesRoutes,     { prefix: '/api/v1' });
  await fastify.register(identityResolutionRoutes,  { prefix: '/api/v1' });
  await fastify.register(pgrRoutes,                 { prefix: '/api/v1' });
  await fastify.register(researchStaffRoutes,       { prefix: '/api/v1' });
  await fastify.register(nonWorkingDayRoutes,       { prefix: '/api/v1' });
  await fastify.register(emailRoutes,               { prefix: '/api/v1' });
  if ((config.emailTransport ?? 'fake') === 'fake') {
    await fastify.register(emailSimulatorRoutes,    { prefix: '/api/v1' });
  }
  await fastify.register(regulatoryHesaRoutes,      { prefix: '/api/v1' });
  await fastify.register(regulatorySlcRoutes,       { prefix: '/api/v1' });
  await fastify.register(regulatoryUcasRoutes,      { prefix: '/api/v1' });
  await fastify.register(regulatoryUkviRoutes,      { prefix: '/api/v1' });
  await fastify.register(regulatoryCollectionsRoutes, { prefix: '/api/v1' });
  await fastify.register(casCasesRoutes,            { prefix: '/api/v1' });
  await fastify.register(regulatoryOfsRoutes,       { prefix: '/api/v1' });
  await fastify.register(regulatoryFoiRoutes,       { prefix: '/api/v1' });
  await fastify.register(studentRoutes,             { prefix: '/api/v1' });
  await fastify.register(enrolmentRoutes,           { prefix: '/api/v1' });
  await fastify.register(programmesRoutes,          { prefix: '/api/v1' });
  await fastify.register(academicPeriodsRoutes,     { prefix: '/api/v1' });
  await fastify.register(assessmentComponentRoutes, { prefix: '/api/v1' });
  await fastify.register(markRoutes,                { prefix: '/api/v1' });
  await fastify.register(moderationRoutes,          { prefix: '/api/v1' });
  await fastify.register(moduleResultRoutes,        { prefix: '/api/v1' });
  await fastify.register(moduleRegistrationsRoutes, { prefix: '/api/v1' });
  await fastify.register(moduleSelectionWindowsRoutes, { prefix: '/api/v1' });
  await fastify.register(moduleAllocationRoutes, { prefix: '/api/v1' });
  await fastify.register(timetablingRoutes, { prefix: '/api/v1' });
  await fastify.register(moduleSelectionProposalsRoutes, { prefix: '/api/v1' });
  await fastify.register(tenantAdminRoutes,         { prefix: '/api/v1' });
  await fastify.register(platformControlRoutes,         { prefix: '/api/v1' });
  await fastify.register(integrationRegistryRoutes,     { prefix: '/api/v1' });
  await fastify.register(globalisationRoutes,       { prefix: '/api/v1' });
  await fastify.register(communicationRoutes,       { prefix: '/api/v1' });
  await fastify.register(reportingRoutes,            { prefix: '/api/v1' });
  await fastify.register(auditLogRoutes,             { prefix: '/api/v1' });
  await fastify.register(adminRetentionRoutes,       { prefix: '/api/v1' });
  await fastify.register(auditReviewRoutes,          { prefix: '/api/v1' });
  await fastify.register(rightsRequestsRoutes,       { prefix: '/api/v1' });
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
    auditReviewService: AuditReviewService;
    rules:            RulesEngine;
    valueSetService:  ValueSetService;
    eventBus:         IntegrationBusPublisher;
    studentService:   StudentService;
    enrolmentService: EnrolmentService;
    catalogueService: CatalogueService;
    calendarService:  CalendarService;
    moduleRegistrationService: ModuleRegistrationService;
    selectionWindowService: SelectionWindowService;
    moduleSubjectService: ModuleSubjectService;
    timetableService: TimetableService;
    allocationService: AllocationService;
    applicantPortalService: ApplicantPortalService;
    researchStaffService: ResearchStaffService;
    ecDeterminationService: EcDeterminationService;
    moduleSelectionService: ModuleSelectionService;
    bindingChangeService: BindingChangeService;
    registrationPeriodService: RegistrationPeriodService;
    nonRegistrationService: NonRegistrationService;
    rightToStudyService: RightToStudyService;
    financialRegistrationService: FinancialRegistrationService;
    applicantConversionService: ApplicantConversionService;
    clearingService: ClearingService;
    ucasDecisionOutbox: UcasDecisionOutbox;
    ucasResultsService: UcasResultsService;
    tenantAdminService: TenantAdminService;
    assessmentComponentService: AssessmentComponentService;
    moduleResultService: ModuleResultService;
    markService: MarkService;
    moderationService: ModerationService;
    adjustmentService: AdjustmentService;
    adjustmentDispatcher: AdjustmentDistributionDispatcher;
    adjustmentTargetConfigService: AdjustmentTargetConfigService;
    adjustmentTaskNoticeService: AdjustmentTaskNoticeService;
    deliveryService: DeliveryService;
    inboundRecordService: InboundRecordService;
    supportService: SupportService;
    statusCaseService: StatusCaseService;
    curriculumPublicationService: CurriculumPublicationService;
    academicExceptionService: AcademicExceptionService;
    confermentService: ConfermentService;
    awardDocumentService: AwardDocumentService;
    graduationService: GraduationService;
    applicationService: ApplicationService;
    employmentService: EmploymentService;
    businessCaseService: BusinessCaseService;
    identityResolutionService: IdentityResolutionService;
    engagementOutcomeService: EngagementOutcomeService;
    exceptionalCircumstancesService: ExceptionalCircumstancesService;
    misconductService: MisconductService;
    boardService: BoardService;
    boardAuthorityService: BoardAuthorityService;
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
    workflowBuilderService: WorkflowBuilderService;
    workflowEscalationService: WorkflowEscalationService;
    reviewExecutionService: ReviewExecutionService;
    reviewActivitiesService: ReviewActivitiesService;
    workflowReconciler: WorkflowReconciler;
    featureFlagService: FeatureFlagService;
    environmentService: EnvironmentService;
    ucasService:        UcasService;
    hesaService:        HesaService;
    slcService:         SlcService;
    ukviService:        UkviService;
    casCaseService:     CasCaseService;
    ofsService:         OfsService;
    regulatoryCollectionService: RegulatoryCollectionService;
    foiService:         FoiService;
    examEntryService:   ExamEntryService;
    supervisionService: SupervisionService;
    progressReviewService: ProgressReviewService;
    examinationService: ExaminationService;
    completionService: CompletionService;
    localeService:        LocaleService;
    currencyService:      CurrencyService;
    communicationService: CommunicationService;
    emailService:         EmailService;
    demoService:          DemoService;
    retentionService:     RetentionEnforcementService;
    rightsRequestService: RightsRequestService;
    notificationService:  NotificationService;
  }
  interface FastifyContextConfig {
    skipAuth?: boolean;
  }
}

/** The academic year (August to July) a date falls in. */
function academicYearOf(isoDate: string): string {
  const year = Number(isoDate.slice(0, 4));
  const start = Number(isoDate.slice(5, 7)) >= 8 ? year : year - 1;
  return `${start}-${String((start + 1) % 100).padStart(2, '0')}`;
}

/** The curriculum object type a write route changes, for the master check (D-22). */
function curriculumWriteType(method: string, url: string): 'programme' | 'module' | 'rule-set' | 'module-group' | 'module-group-member' | 'learning-outcome' | 'module-offering' | null {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(method)) return null;
  const path = url.replace(/^\/api\/v1/, '');
  if (/^\/programmes(\/:programmeId)?$/.test(path)) return 'programme';
  if (/^\/modules(\/:moduleId)?$/.test(path)) return 'module';
  if (/^\/learning-outcomes/.test(path)) return 'learning-outcome';
  if (/^\/module-offerings(\/:moduleOfferingId)?$/.test(path)) return 'module-offering';
  if (/^\/programme-rule-sets/.test(path)) return 'rule-set';
  if (/^\/module-groups\/:moduleGroupId\/members/.test(path)) return 'module-group-member';
  if (/^\/module-groups/.test(path)) return 'module-group';
  return null;
}
