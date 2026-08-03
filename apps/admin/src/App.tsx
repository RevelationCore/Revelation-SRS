import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.js';
import { RequireRole } from './auth/RequireRole.js';
import { RequirePermission } from './auth/RequirePermission.js';
import { Layout } from './components/Layout.js';
import { AcademicRulesPage } from './pages/AcademicRulesPage.js';
import { RegistrationWindowsPage } from './pages/RegistrationWindowsPage.js';
import { AuditPage } from './pages/AuditPage.js';
import { CallbackPage } from './pages/CallbackPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { EnrolmentReportPage } from './pages/EnrolmentReportPage.js';
import { EnvironmentRuntimePage } from './pages/EnvironmentRuntimePage.js';
import { ExamBoardDetailPage } from './pages/ExamBoardDetailPage.js';
import { ExamBoardsPage } from './pages/ExamBoardsPage.js';
import { FeatureFlagsPage } from './pages/FeatureFlagsPage.js';
import { FoiPage } from './pages/FoiPage.js';
import { ForbiddenPage } from './pages/ForbiddenPage.js';
import { GlobalisationPage } from './pages/GlobalisationPage.js';
import { HesaPage } from './pages/HesaPage.js';
import { IntegrationOpsPage } from './pages/IntegrationOpsPage.js';
import { IntegrationsPage } from './pages/IntegrationsPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { OfsPage } from './pages/OfsPage.js';
import { OperationsPage } from './pages/OperationsPage.js';
import { RegulatoryPage } from './pages/RegulatoryPage.js';
import { RegulatoryStatusPage } from './pages/RegulatoryStatusPage.js';
import { ReportingPage } from './pages/ReportingPage.js';
import { SlcPage } from './pages/SlcPage.js';
import { StudentDetailPage } from './pages/StudentDetailPage.js';
import { StudentsPage } from './pages/StudentsPage.js';
import { TaskInboxPage } from './pages/TaskInboxPage.js';
import { ModuleSelectionProposalsPage } from './pages/ModuleSelectionProposalsPage.js';
import { ModuleRegistrationRequestsPage } from './pages/ModuleRegistrationRequestsPage.js';
import { IdentityChangeRequestsPage } from './pages/IdentityChangeRequestsPage.js';
import { TenantAdminPage } from './pages/TenantAdminPage.js';
import { TenantConfigPage } from './pages/TenantConfigPage.js';
import { UcasPage } from './pages/UcasPage.js';
import { UkviPage } from './pages/UkviPage.js';
import { ValueSetsPage } from './pages/ValueSetsPage.js';
import { WorkflowDefsPage } from './pages/WorkflowDefsPage.js';
import { AccessibilityStatementPage } from './pages/AccessibilityStatementPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';
import { EngagementPage } from './pages/EngagementPage.js';
import { EngagementCasePage } from './pages/EngagementCasePage.js';
import { ModerationPage } from './pages/ModerationPage.js';
import { RegulatoryCollectionsPage } from './pages/RegulatoryCollectionsPage.js';
import { IdentityResolutionPage } from './pages/IdentityResolutionPage.js';
import { PgrSupervisionPage } from './pages/PgrSupervisionPage.js';
import { PgrProgressReviewPage } from './pages/PgrProgressReviewPage.js';
import { PgrExaminationPage } from './pages/PgrExaminationPage.js';
import { PgrCompletionPage } from './pages/PgrCompletionPage.js';
import { RightsRequestsPage } from './pages/RightsRequestsPage.js';
import { AuditReviewPage } from './pages/AuditReviewPage.js';

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
              <Routes>
                <Route index                              element={<Navigate to="/dashboard" replace />} />
                <Route path="dashboard"                  element={<DashboardPage />} />
                <Route path="tasks" element={<RequirePermission permissions={['workflow-task:complete']}><TaskInboxPage /></RequirePermission>} />
                <Route path="module-selection-proposals" element={<RequirePermission permissions={['module-selection:decide', 'module-selection:read:all']}><ModuleSelectionProposalsPage /></RequirePermission>} />
                <Route path="module-registration-requests" element={<RequirePermission permissions={['module-registration:decide']}><ModuleRegistrationRequestsPage /></RequirePermission>} />
                <Route path="identity-change-requests" element={<RequirePermission permissions={['student:decide']}><IdentityChangeRequestsPage /></RequirePermission>} />
                <Route path="students" element={<RequirePermission permissions={['student:read:all']}><StudentsPage /></RequirePermission>} />
                <Route path="students/:personId" element={<RequirePermission permissions={['student:read:all']}><StudentDetailPage /></RequirePermission>} />
                <Route path="exam-boards" element={<RequirePermission permissions={['exam-board:read']}><ExamBoardsPage /></RequirePermission>} />
                <Route path="exam-boards/:boardId" element={<RequirePermission permissions={['exam-board:read']}><ExamBoardDetailPage /></RequirePermission>} />
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
                  path="tenant-admin/registration-windows"
                  element={<RequirePermission permissions={['calendar:read']}><RegistrationWindowsPage /></RequirePermission>}
                />
                <Route
                  path="tenant-admin/workflows"
                  element={<RequirePermission permissions={['workflow:read']}><WorkflowDefsPage /></RequirePermission>}
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

                {/* Operations */}
                <Route path="operations" element={<RequirePermission permissions={['environment:read', 'integration:read']}><OperationsPage /></RequirePermission>} />
                <Route path="operations/environment" element={<RequirePermission permissions={['environment:read']}><EnvironmentRuntimePage /></RequirePermission>} />
                <Route path="operations/integrations" element={<RequirePermission permissions={['integration:read']}><IntegrationOpsPage /></RequirePermission>} />

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
