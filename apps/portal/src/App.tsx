import { lazy, Suspense } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '@revelation-srs/ui';
import { RequireAuth } from './auth/RequireAuth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/LoginPage.js';
import { CallbackPage } from './pages/CallbackPage.js';
import { AccessibilityStatementPage } from './pages/AccessibilityStatementPage.js';
import { ForbiddenPage } from './pages/ForbiddenPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

// Signed-in pages load on demand, so the login page ships only what it needs.
const DashboardPage = lazy(() => import('./pages/DashboardPage.js').then((m) => ({ default: m.DashboardPage })));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js').then((m) => ({ default: m.ProfilePage })));
const ProfileEditPage = lazy(() => import('./pages/ProfileEditPage.js').then((m) => ({ default: m.ProfileEditPage })));
const AddAddressPage = lazy(() => import('./pages/AddAddressPage.js').then((m) => ({ default: m.AddAddressPage })));
const EnrolmentsPage = lazy(() => import('./pages/EnrolmentsPage.js').then((m) => ({ default: m.EnrolmentsPage })));
const EnrolmentDetailPage = lazy(() => import('./pages/EnrolmentDetailPage.js').then((m) => ({ default: m.EnrolmentDetailPage })));
const ModulesPage = lazy(() => import('./pages/ModulesPage.js').then((m) => ({ default: m.ModulesPage })));
const ModuleAddPage = lazy(() => import('./pages/ModuleAddPage.js').then((m) => ({ default: m.ModuleAddPage })));
const ModuleSelectionPage = lazy(() => import('./pages/ModuleSelectionPage.js').then((m) => ({ default: m.ModuleSelectionPage })));
const ResultsPage = lazy(() => import('./pages/ResultsPage.js').then((m) => ({ default: m.ResultsPage })));
const TimetablePage = lazy(() => import('./pages/TimetablePage.js').then((m) => ({ default: m.TimetablePage })));
const ExamPage = lazy(() => import('./pages/ExamPage.js').then((m) => ({ default: m.ExamPage })));
const AdjustmentsPage = lazy(() => import('./pages/AdjustmentsPage.js').then((m) => ({ default: m.AdjustmentsPage })));
const AdjustmentRequestPage = lazy(() => import('./pages/AdjustmentRequestPage.js').then((m) => ({ default: m.AdjustmentRequestPage })));
const AdjustmentCaseDetailPage = lazy(() => import('./pages/AdjustmentCaseDetailPage.js').then((m) => ({ default: m.AdjustmentCaseDetailPage })));
const DisabilityPage = lazy(() => import('./pages/DisabilityPage.js').then((m) => ({ default: m.DisabilityPage })));
const CircumstancesPage = lazy(() => import('./pages/CircumstancesPage.js').then((m) => ({ default: m.CircumstancesPage })));
const NotificationsPage = lazy(() => import('./pages/NotificationsPage.js').then((m) => ({ default: m.NotificationsPage })));
const DocumentsPage = lazy(() => import('./pages/DocumentsPage.js').then((m) => ({ default: m.DocumentsPage })));
const GraduationPage = lazy(() => import('./pages/GraduationPage.js').then((m) => ({ default: m.GraduationPage })));

function PageLoading() {
  return <p role="status" className="p-6 text-sm text-neutral-600">Loading…</p>;
}

export function App() {
  return (
    <ErrorBoundary>
      <Suspense fallback={<PageLoading />}>
      <Routes>
        {/* Public routes */}
        <Route path="/login"    element={<LoginPage />} />
        <Route path="/callback" element={<CallbackPage />} />
        <Route path="/403"      element={<ForbiddenPage />} />

        {/* Protected routes inside Layout */}
        <Route
          element={
            <RequireAuth>
              <Layout />
            </RequireAuth>
          }
        >
          <Route path="/dashboard"             element={<DashboardPage />} />
          <Route path="/profile"               element={<ProfilePage />} />
          <Route path="/profile/edit"          element={<ProfileEditPage />} />
          <Route path="/profile/addresses/new" element={<AddAddressPage />} />
          <Route path="/profile/addresses/:addressId/edit" element={<AddAddressPage />} />
          <Route path="/enrolments"            element={<EnrolmentsPage />} />
          <Route path="/enrolments/:enrolmentId" element={<EnrolmentDetailPage />} />
          <Route path="/modules"               element={<ModulesPage />} />
          <Route path="/modules/add"           element={<ModuleAddPage />} />
          <Route path="/modules/select"        element={<ModuleSelectionPage />} />
          <Route path="/results"               element={<ResultsPage />} />
          <Route path="/timetable"             element={<TimetablePage />} />
          <Route path="/exams"                 element={<ExamPage />} />
          <Route path="/adjustments"           element={<AdjustmentsPage />} />
          <Route path="/adjustments/request"   element={<AdjustmentRequestPage />} />
          <Route path="/adjustments/requests/:caseId" element={<AdjustmentCaseDetailPage />} />
          <Route path="/disability"            element={<DisabilityPage />} />
          <Route path="/circumstances"         element={<CircumstancesPage />} />
          <Route path="/notifications"         element={<NotificationsPage />} />
          <Route path="/documents"             element={<DocumentsPage />} />
          <Route path="/graduation"            element={<GraduationPage />} />
        </Route>

        {/* Public accessibility statement — no auth required */}
        <Route path="/accessibility-statement" element={<AccessibilityStatementPage />} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
      </Suspense>
    </ErrorBoundary>
  );
}
