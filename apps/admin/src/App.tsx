import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.js';
import { Layout } from './components/Layout.js';
import { CallbackPage } from './pages/CallbackPage.js';
import { LoginPage } from './pages/LoginPage.js';
import { StudentDetailPage } from './pages/StudentDetailPage.js';
import { StudentsPage } from './pages/StudentsPage.js';

function RequireAuth({ children }: { children: React.ReactNode }) {
  const { token, isReady } = useAuth();
  if (!isReady) return null;
  if (!token)   return <Navigate to="/login" replace />;
  return <>{children}</>;
}

export function App() {
  return (
    <Routes>
      {/* Public routes — no auth required */}
      <Route path="/login"    element={<LoginPage />} />
      <Route path="/callback" element={<CallbackPage />} />

      {/* Protected routes */}
      <Route
        path="/*"
        element={
          <RequireAuth>
            <Layout>
              <Routes>
                <Route index                    element={<Navigate to="/students" replace />} />
                <Route path="students"          element={<StudentsPage />} />
                <Route path="students/:personId" element={<StudentDetailPage />} />
              </Routes>
            </Layout>
          </RequireAuth>
        }
      />
    </Routes>
  );
}
