import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.js';
import { RequireRole } from './auth/RequireRole.js';
import { Layout } from './components/Layout.js';
import { AcademicRulesPage } from './pages/AcademicRulesPage.js';
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
import { TenantAdminPage } from './pages/TenantAdminPage.js';
import { TenantConfigPage } from './pages/TenantConfigPage.js';
import { UcasPage } from './pages/UcasPage.js';
import { UkviPage } from './pages/UkviPage.js';
import { ValueSetsPage } from './pages/ValueSetsPage.js';
import { WorkflowDefsPage } from './pages/WorkflowDefsPage.js';
import { AccessibilityStatementPage } from './pages/AccessibilityStatementPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

const TENANT_ADMIN_ROLES      = ['tenant-administrator', 'registry-administrator', 'system-administrator'];
const INTEGRATION_ADMIN_ROLES = ['tenant-administrator', 'system-administrator'];

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
                <Route path="tasks"                      element={<TaskInboxPage />} />
                <Route path="students"                   element={<StudentsPage />} />
                <Route path="students/:personId"         element={<StudentDetailPage />} />
                <Route path="exam-boards"                element={<ExamBoardsPage />} />
                <Route path="exam-boards/:boardId"       element={<ExamBoardDetailPage />} />
                <Route path="regulatory"                 element={<RegulatoryPage />} />
                <Route path="regulatory/hesa"            element={<HesaPage />} />
                <Route path="regulatory/ucas"            element={<UcasPage />} />
                <Route path="regulatory/slc"             element={<SlcPage />} />
                <Route path="regulatory/ukvi"            element={<UkviPage />} />
                <Route path="regulatory/ofs"             element={<OfsPage />} />

                {/* Tenant administration — gated to tenant/registry/system roles */}
                <Route
                  path="tenant-admin"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><TenantAdminPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/config"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><TenantConfigPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/value-sets"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><ValueSetsPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/globalisation"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><GlobalisationPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/rules"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><AcademicRulesPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/workflows"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><WorkflowDefsPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/flags"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><FeatureFlagsPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/integrations"
                  element={<RequireRole roles={INTEGRATION_ADMIN_ROLES}><IntegrationsPage /></RequireRole>}
                />
                <Route
                  path="tenant-admin/audit"
                  element={<RequireRole roles={TENANT_ADMIN_ROLES}><AuditPage /></RequireRole>}
                />

                {/* Reporting */}
                <Route path="reporting"                          element={<ReportingPage />} />
                <Route path="reporting/enrolments"              element={<EnrolmentReportPage />} />
                <Route path="reporting/regulatory-status"       element={<RegulatoryStatusPage />} />
                <Route path="reporting/foi"                     element={<FoiPage />} />

                {/* Operations */}
                <Route path="operations"                        element={<OperationsPage />} />
                <Route path="operations/environment"            element={<EnvironmentRuntimePage />} />
                <Route path="operations/integrations"           element={<IntegrationOpsPage />} />

                <Route path="*" element={<NotFoundPage />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
