import { Routes, Route, Navigate } from 'react-router-dom';
import { ErrorBoundary } from '@revelation-srs/ui';
import { RequireAuth } from './auth/RequireAuth.js';
import { Layout } from './components/Layout.js';
import { LoginPage } from './pages/LoginPage.js';
import { CallbackPage } from './pages/CallbackPage.js';
import { DashboardPage } from './pages/DashboardPage.js';
import { ProfilePage } from './pages/ProfilePage.js';
import { ProfileEditPage } from './pages/ProfileEditPage.js';
import { AddAddressPage } from './pages/AddAddressPage.js';
import { EnrolmentsPage } from './pages/EnrolmentsPage.js';
import { ModulesPage } from './pages/ModulesPage.js';
import { ModuleAddPage } from './pages/ModuleAddPage.js';
import { ResultsPage } from './pages/ResultsPage.js';
import { TimetablePage } from './pages/TimetablePage.js';
import { ExamPage } from './pages/ExamPage.js';
import { AdjustmentsPage } from './pages/AdjustmentsPage.js';
import { DisabilityPage } from './pages/DisabilityPage.js';
import { CircumstancesPage } from './pages/CircumstancesPage.js';
import { NotificationsPage } from './pages/NotificationsPage.js';
import { AccessibilityStatementPage } from './pages/AccessibilityStatementPage.js';
import { ForbiddenPage } from './pages/ForbiddenPage.js';
import { NotFoundPage } from './pages/NotFoundPage.js';

export function App() {
  return (
    <ErrorBoundary>
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
          <Route path="/enrolments"            element={<EnrolmentsPage />} />
          <Route path="/modules"               element={<ModulesPage />} />
          <Route path="/modules/add"           element={<ModuleAddPage />} />
          <Route path="/results"               element={<ResultsPage />} />
          <Route path="/timetable"             element={<TimetablePage />} />
          <Route path="/exams"                 element={<ExamPage />} />
          <Route path="/adjustments"           element={<AdjustmentsPage />} />
          <Route path="/disability"            element={<DisabilityPage />} />
          <Route path="/circumstances"         element={<CircumstancesPage />} />
          <Route path="/notifications"         element={<NotificationsPage />} />
        </Route>

        {/* Public accessibility statement — no auth required */}
        <Route path="/accessibility" element={<AccessibilityStatementPage />} />

        <Route path="/" element={<Navigate to="/dashboard" replace />} />
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </ErrorBoundary>
  );
}
