import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.js';
import { RequireRole } from './auth/RequireRole.js';
import { RequirePermission } from './auth/RequirePermission.js';
import { Layout } from './components/Layout.js';
import { CallbackPage } from './pages/CallbackPage.js';
import { LoginPage } from './pages/LoginPage.js';

const AcademicRulesPage = lazy(() => import('./pages/AcademicRulesPage.js').then((m) => ({ default: m.AcademicRulesPage })));
const SelectionWindowsPage = lazy(() => import('./pages/SelectionWindowsPage.js').then((m) => ({ default: m.SelectionWindowsPage })));
const AuditPage = lazy(() => import('./pages/AuditPage.js').then((m) => ({ default: m.AuditPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })));
const EnrolmentReportPage = lazy(() => import('./pages/EnrolmentReportPage.js').then((m) => ({ default: m.EnrolmentReportPage })));
const EnvironmentRuntimePage = lazy(() => import('./pages/EnvironmentRuntimePage.js').then((m) => ({ default: m.EnvironmentRuntimePage })));
const ExamBoardDetailPage = lazy(() => import('./pages/ExamBoardDetailPage.js').then((m) => ({ default: m.ExamBoardDetailPage })));
const ExamBoardsPage = lazy(() => import('./pages/ExamBoardsPage.js').then((m) => ({ default: m.ExamBoardsPage })));
const FeatureFlagsPage = lazy(() => import('./pages/FeatureFlagsPage.js').then((m) => ({ default: m.FeatureFlagsPage })));
const FoiPage = lazy(() => import('./pages/FoiPage.js').then((m) => ({ default: m.FoiPage })));
const ForbiddenPage = lazy(() => import('./pages/ForbiddenPage.js').then((m) => ({ default: m.ForbiddenPage })));
const GlobalisationPage = lazy(() => import('./pages/GlobalisationPage.js').then((m) => ({ default: m.GlobalisationPage })));
const HesaPage = lazy(() => import('./pages/HesaPage.js').then((m) => ({ default: m.HesaPage })));
const IntegrationOpsPage = lazy(() => import('./pages/IntegrationOpsPage.js').then((m) => ({ default: m.IntegrationOpsPage })));
const IntegrationTasksPage = lazy(() => import('./pages/IntegrationTasksPage.js').then((m) => ({ default: m.IntegrationTasksPage })));
const ExamTimingsPage = lazy(() => import('./pages/ExamTimingsPage.js').then((m) => ({ default: m.ExamTimingsPage })));
const AssessmentStructuresPage = lazy(() => import('./pages/AssessmentStructuresPage.js').then((m) => ({ default: m.AssessmentStructuresPage })));
const ProgrammeRulesPage = lazy(() => import('./pages/ProgrammeRulesPage.js').then((m) => ({ default: m.ProgrammeRulesPage })));
const ClearingPage = lazy(() => import('./pages/ClearingPage.js').then((m) => ({ default: m.ClearingPage })));
const RegistrationPeriodsPage = lazy(() => import('./pages/RegistrationPeriodsPage.js').then((m) => ({ default: m.RegistrationPeriodsPage })));
const RegistrationChecksPage = lazy(() => import('./pages/RegistrationChecksPage.js').then((m) => ({ default: m.RegistrationChecksPage })));
const NonRegistrationPage = lazy(() => import('./pages/NonRegistrationPage.js').then((m) => ({ default: m.NonRegistrationPage })));
const RegistrationPeriodDetailPage = lazy(() => import('./pages/RegistrationPeriodsPage.js').then((m) => ({ default: m.RegistrationPeriodDetailPage })));
const IntegrationsPage = lazy(() => import('./pages/IntegrationsPage.js').then((m) => ({ default: m.IntegrationsPage })));
const OfsPage = lazy(() => import('./pages/OfsPage.js').then((m) => ({ default: m.OfsPage })));
const OperationsPage = lazy(() => import('./pages/OperationsPage.js').then((m) => ({ default: m.OperationsPage })));
const RegulatoryPage = lazy(() => import('./pages/RegulatoryPage.js').then((m) => ({ default: m.RegulatoryPage })));
const RegulatoryStatusPage = lazy(() => import('./pages/RegulatoryStatusPage.js').then((m) => ({ default: m.RegulatoryStatusPage })));
const ReportingPage = lazy(() => import('./pages/ReportingPage.js').then((m) => ({ default: m.ReportingPage })));
const SlcPage = lazy(() => import('./pages/SlcPage.js').then((m) => ({ default: m.SlcPage })));
const StudentDetailPage = lazy(() => import('./pages/StudentDetailPage.js').then((m) => ({ default: m.StudentDetailPage })));
const StudentsPage = lazy(() => import('./pages/StudentsPage.js').then((m) => ({ default: m.StudentsPage })));
const TaskInboxPage = lazy(() => import('./pages/TaskInboxPage.js').then((m) => ({ default: m.TaskInboxPage })));
const ModuleSelectionProposalsPage = lazy(() => import('./pages/ModuleSelectionProposalsPage.js').then((m) => ({ default: m.ModuleSelectionProposalsPage })));
const ModuleRegistrationRequestsPage = lazy(() => import('./pages/ModuleRegistrationRequestsPage.js').then((m) => ({ default: m.ModuleRegistrationRequestsPage })));
const IdentityChangeRequestsPage = lazy(() => import('./pages/IdentityChangeRequestsPage.js').then((m) => ({ default: m.IdentityChangeRequestsPage })));
const TenantAdminPage = lazy(() => import('./pages/TenantAdminPage.js').then((m) => ({ default: m.TenantAdminPage })));
const TenantConfigPage = lazy(() => import('./pages/TenantConfigPage.js').then((m) => ({ default: m.TenantConfigPage })));
const UcasPage = lazy(() => import('./pages/UcasPage.js').then((m) => ({ default: m.UcasPage })));
const UkviPage = lazy(() => import('./pages/UkviPage.js').then((m) => ({ default: m.UkviPage })));
const ValueSetsPage = lazy(() => import('./pages/ValueSetsPage.js').then((m) => ({ default: m.ValueSetsPage })));
const WorkflowDefsPage = lazy(() => import('./pages/WorkflowDefsPage.js').then((m) => ({ default: m.WorkflowDefsPage })));
const StartWorkflowPage = lazy(() => import('./pages/StartWorkflowPage.js').then((m) => ({ default: m.StartWorkflowPage })));
const AccessibilityStatementPage = lazy(() => import('./pages/AccessibilityStatementPage.js').then((m) => ({ default: m.AccessibilityStatementPage })));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.js').then((m) => ({ default: m.NotFoundPage })));
const EngagementPage = lazy(() => import('./pages/EngagementPage.js').then((m) => ({ default: m.EngagementPage })));
const EngagementCasePage = lazy(() => import('./pages/EngagementCasePage.js').then((m) => ({ default: m.EngagementCasePage })));
const ModerationPage = lazy(() => import('./pages/ModerationPage.js').then((m) => ({ default: m.ModerationPage })));
const RegulatoryCollectionsPage = lazy(() => import('./pages/RegulatoryCollectionsPage.js').then((m) => ({ default: m.RegulatoryCollectionsPage })));
const IdentityResolutionPage = lazy(() => import('./pages/IdentityResolutionPage.js').then((m) => ({ default: m.IdentityResolutionPage })));
const PgrSupervisionPage = lazy(() => import('./pages/PgrSupervisionPage.js').then((m) => ({ default: m.PgrSupervisionPage })));
const PgrProgressReviewPage = lazy(() => import('./pages/PgrProgressReviewPage.js').then((m) => ({ default: m.PgrProgressReviewPage })));
const PgrExaminationPage = lazy(() => import('./pages/PgrExaminationPage.js').then((m) => ({ default: m.PgrExaminationPage })));
const PgrCompletionPage = lazy(() => import('./pages/PgrCompletionPage.js').then((m) => ({ default: m.PgrCompletionPage })));
const RightsRequestsPage = lazy(() => import('./pages/RightsRequestsPage.js').then((m) => ({ default: m.RightsRequestsPage })));
const AuditReviewPage = lazy(() => import('./pages/AuditReviewPage.js').then((m) => ({ default: m.AuditReviewPage })));
const AdjustmentCasesPage = lazy(() => import('./pages/AdjustmentCasesPage.js').then((m) => ({ default: m.AdjustmentCasesPage })));
const AdjustmentCaseDetailPage = lazy(() => import('./pages/AdjustmentCaseDetailPage.js').then((m) => ({ default: m.AdjustmentCaseDetailPage })));
const ApplicationsPage = lazy(() => import('./pages/ApplicationsPage.js').then((m) => ({ default: m.ApplicationsPage })));
const ApplicationDetailPage = lazy(() => import('./pages/ApplicationDetailPage.js').then((m) => ({ default: m.ApplicationDetailPage })));
const PendingApprovalsPage = lazy(() => import('./pages/PendingApprovalsPage.js').then((m) => ({ default: m.PendingApprovalsPage })));
const StatusCasesPage = lazy(() => import('./pages/StatusCasesPage.js').then((m) => ({ default: m.StatusCasesPage })));
const StatusCaseDetailPage = lazy(() => import('./pages/StatusCaseDetailPage.js').then((m) => ({ default: m.StatusCaseDetailPage })));
const GraduationPage = lazy(() => import('./pages/GraduationPage.js').then((m) => ({ default: m.GraduationPage })));
const GraduationCycleDetailPage = lazy(() => import('./pages/GraduationCycleDetailPage.js').then((m) => ({ default: m.GraduationCycleDetailPage })));
const DocumentVerificationPage = lazy(() => import('./pages/DocumentVerificationPage.js').then((m) => ({ default: m.DocumentVerificationPage })));
const CurriculumPublicationsPage = lazy(() => import('./pages/CurriculumPublicationsPage.js').then((m) => ({ default: m.CurriculumPublicationsPage })));
const CurriculumPublicationDetailPage = lazy(() => import('./pages/CurriculumPublicationsPage.js').then((m) => ({ default: m.CurriculumPublicationDetailPage })));

const ENGAGEMENT_ROLES = ['module-tutor', 'personal-tutor', 'engagement-officer', 'registry-administrator', 'tenant-administrator'];
const ADMIN_PERMISSIONS = [
  'config:read',
  'globalisation:read',
  'rule:read',
  'workflow:read',
  'feature-flag:read',
  'integration:read',
  'audit-log:read',
] as const;

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, isReady } = useAuth();
  if (!isReady) return null;
  if (!token)   return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Suspense fallback={null}>
    <Routes>
      {/* Public routes */}
      <Route path="/login"           element={<LoginPage />} />
      <Route path="/callback"        element={<CallbackPage />} />
      <Route path="/403"             element={<ForbiddenPage />} />
      <Route path="/accessibility-statement" element={<AccessibilityStatementPage />} />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Suspense fallback={<div className="flex justify-center py-16" role="status" aria-label="Loading page" />}>
              <Routes>
                <Route index                              element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard"                  element={<DashboardPage />} />
                <Route path="tasks" element={<RequirePermission permissions={['workflow-task:complete']}><TaskInboxPage /></RequirePermission>} />
                <Route path="module-selection-proposals" element={<RequirePermission permissions={['module-selection:decide', 'module-selection:read:all']}><ModuleSelectionProposalsPage /></RequirePermission>} />
                <Route path="module-registration-requests" element={<RequirePermission permissions={['module-registration:decide']}><ModuleRegistrationRequestsPage /></RequirePermission>} />
                <Route path="identity-change-requests" element={<RequirePermission permissions={['student:decide']}><IdentityChangeRequestsPage /></RequirePermission>} />
                <Route path="clearing" element={<RequirePermission permissions={['clearing:decide', 'clearing:review']}><ClearingPage /></RequirePermission>} />
                <Route path="applications" element={<RequirePermission permissions={['application:read']}><ApplicationsPage /></RequirePermission>} />
                <Route path="applications/:applicationId" element={<RequirePermission permissions={['application:read']}><ApplicationDetailPage /></RequirePermission>} />
                <Route path="graduation" element={<RequirePermission permissions={['graduation:read']}><GraduationPage /></RequirePermission>} />
                <Route path="graduation/:cycleId" element={<RequirePermission permissions={['graduation:read']}><GraduationCycleDetailPage /></RequirePermission>} />
                <Route path="document-verification" element={<RequirePermission permissions={['document:verify']}><DocumentVerificationPage /></RequirePermission>} />
                <Route path="curriculum-publications" element={<RequirePermission permissions={['curriculum-publication:read']}><CurriculumPublicationsPage /></RequirePermission>} />
                <Route path="curriculum-publications/:publicationId" element={<RequirePermission permissions={['curriculum-publication:read']}><CurriculumPublicationDetailPage /></RequirePermission>} />
                <Route path="status-cases" element={<RequirePermission permissions={['status-case:read']}><StatusCasesPage /></RequirePermission>} />
                <Route path="status-cases/:statusCaseId" element={<RequirePermission permissions={['status-case:read']}><StatusCaseDetailPage /></RequirePermission>} />
                <Route path="credit-approvals" element={<RequirePermission permissions={['academic-exception:approve']}><PendingApprovalsPage /></RequirePermission>} />
                <Route path="students" element={<RequirePermission permissions={['student:read:all']}><StudentsPage /></RequirePermission>} />
                <Route path="students/:personId" element={<RequirePermission permissions={['student:read:all']}><StudentDetailPage /></RequirePermission>} />
                <Route path="exam-boards" element={<RequirePermission permissions={['exam-board:read']}><ExamBoardsPage /></RequirePermission>} />
                <Route path="exam-boards/:boardId" element={<RequirePermission permissions={['exam-board:read']}><ExamBoardDetailPage /></RequirePermission>} />
                <Route path="registration" element={<RequirePermission permissions={['registration:read']}><RegistrationPeriodsPage /></RequirePermission>} />
                <Route path="registration/checks" element={<RequirePermission permissions={['right-to-study:read', 'financial-registration:read', 'fee-status:decide']}><RegistrationChecksPage /></RequirePermission>} />
                <Route path="registration/non-registration" element={<RequirePermission permissions={['non-registration:manage', 'registration:read']}><NonRegistrationPage /></RequirePermission>} />
                <Route path="registration/:periodId" element={<RequirePermission permissions={['registration:read']}><RegistrationPeriodDetailPage /></RequirePermission>} />
                <Route path="programme-rules" element={<RequirePermission permissions={['module-selection:configure', 'curriculum-binding:read']}><ProgrammeRulesPage /></RequirePermission>} />
                <Route path="assessment-structures" element={<RequirePermission permissions={['catalogue:read']}><AssessmentStructuresPage /></RequirePermission>} />
                <Route path="exam-timings" element={<RequirePermission permissions={['catalogue:write']}><ExamTimingsPage /></RequirePermission>} />
                <Route path="engagement" element={<RequireRole roles={ENGAGEMENT_ROLES}><EngagementPage /></RequireRole>} />
                <Route path="engagement/cases/:caseId" element={<RequireRole roles={ENGAGEMENT_ROLES}><EngagementCasePage /></RequireRole>} />
                <Route path="regulatory" element={<RequirePermission permissions={['regulatory:read']}><RegulatoryPage /></RequirePermission>} />
                <Route path="regulatory/hesa" element={<RequirePermission permissions={['regulatory:read']}><HesaPage /></RequirePermission>} />
                <Route path="regulatory/ucas" element={<RequirePermission permissions={['regulatory:read']}><UcasPage /></RequirePermission>} />
                <Route path="regulatory/slc" element={<RequirePermission permissions={['regulatory:read']}><SlcPage /></RequirePermission>} />
                <Route path="regulatory/ukvi" element={<RequirePermission permissions={['regulatory:read']}><UkviPage /></RequirePermission>} />
                <Route path="regulatory/ofs" element={<RequirePermission permissions={['regulatory:read']}><OfsPage /></RequirePermission>} />

                {/* Tenant administration — gated to tenant/registry/system roles */}
                <Route
                  path="tenant-admin"
                  element={<RequirePermission permissions={[...ADMIN_PERMISSIONS]}><TenantAdminPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/config"
                  element={<RequirePermission permissions={['config:read']}><TenantConfigPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/value-sets"
                  element={<RequirePermission permissions={['config:read']}><ValueSetsPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/globalisation"
                  element={<RequirePermission permissions={['globalisation:read']}><GlobalisationPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/rules"
                  element={<RequirePermission permissions={['rule:read']}><AcademicRulesPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/selection-windows"
                  element={<RequirePermission permissions={['calendar:read']}><SelectionWindowsPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/workflows"
                  element={<RequirePermission permissions={['workflow:read']}><WorkflowDefsPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/workflows/start"
                  element={<RequirePermission permissions={['workflow:write']}><StartWorkflowPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/flags"
                  element={<RequirePermission permissions={['feature-flag:read']}><FeatureFlagsPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/integrations"
                  element={<RequirePermission permissions={['integration:read']}><IntegrationsPage /></RequirePermission>}
                />
                {/* Audit log: API guards with audit-log:read (dpo, registry-administrator, system-administrator, wellbeing-auditor) */}
                <Route path="tenant-admin/audit" element={<RequirePermission permissions={['audit-log:read']}><AuditPage /></RequirePermission>} />

                {/* Reporting */}
                <Route path="reporting" element={<RequirePermission permissions={['enrolment:read:all', 'regulatory:read']}><ReportingPage /></RequirePermission>} />
                <Route path="reporting/enrolments" element={<RequirePermission permissions={['enrolment:read:all']}><EnrolmentReportPage /></RequirePermission>} />
                <Route path="reporting/regulatory-status" element={<RequirePermission permissions={['regulatory:read']}><RegulatoryStatusPage /></RequirePermission>} />
                <Route path="reporting/foi" element={<RequirePermission permissions={['regulatory:read']}><FoiPage /></RequirePermission>} />

                {/* Governance — write-only workflow consoles (no list endpoints) */}
                <Route path="governance/moderation" element={<RequirePermission permissions={['mark:write']}><ModerationPage /></RequirePermission>} />
                <Route path="governance/regulatory-collections" element={<RequirePermission permissions={['regulatory:write']}><RegulatoryCollectionsPage /></RequirePermission>} />
                <Route path="governance/identity-resolution" element={<RequirePermission permissions={['identity:manage']}><IdentityResolutionPage /></RequirePermission>} />
                <Route path="governance/pgr-supervision" element={<RequirePermission permissions={['pgr-case:read']}><PgrSupervisionPage /></RequirePermission>} />
                <Route path="governance/pgr-progress-review" element={<RequirePermission permissions={['pgr-case:read']}><PgrProgressReviewPage /></RequirePermission>} />
                <Route path="governance/pgr-examination" element={<RequirePermission permissions={['pgr-case:read']}><PgrExaminationPage /></RequirePermission>} />
                <Route path="governance/pgr-completion" element={<RequirePermission permissions={['pgr-case:read']}><PgrCompletionPage /></RequirePermission>} />
                <Route path="governance/rights-requests" element={<RequirePermission permissions={['identity:manage', 'retention:enforce']}><RightsRequestsPage /></RequirePermission>} />
                <Route path="governance/audit-review" element={<RequirePermission permissions={['audit-log:read']}><AuditReviewPage /></RequirePermission>} />
                <Route path="governance/adjustment-cases" element={<RequirePermission permissions={['adjustment-case:read:all']}><AdjustmentCasesPage /></RequirePermission>} />
                <Route path="governance/adjustment-cases/:caseId" element={<RequirePermission permissions={['adjustment-case:read:all']}><AdjustmentCaseDetailPage /></RequirePermission>} />

                {/* Operations */}
                <Route path="operations" element={<RequirePermission permissions={['environment:read', 'integration:read', 'adjustment:fulfil', 'delivery:fulfil']}><OperationsPage /></RequirePermission>} />
                <Route path="operations/environment" element={<RequirePermission permissions={['environment:read']}><EnvironmentRuntimePage /></RequirePermission>} />
                <Route path="operations/integrations" element={<RequirePermission permissions={['integration:read']}><IntegrationOpsPage /></RequirePermission>} />
                <Route path="operations/integration-tasks" element={<RequirePermission permissions={['adjustment:fulfil', 'delivery:fulfil']}><IntegrationTasksPage /></RequirePermission>} />
                {/* Earlier address, kept for links already sent. */}
                <Route path="operations/adjustment-tasks" element={<RequirePermission permissions={['adjustment:fulfil', 'delivery:fulfil']}><IntegrationTasksPage /></RequirePermission>} />

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
              </Suspense>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
    </Suspense>
  );
}
