import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.js';

export function Layout({ children }: { children: React.ReactNode }) {
  const { logout } = useAuth();
  const navigate   = useNavigate();

  function handleLogout() {
    logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-200 px-6 py-3 flex items-center gap-6">
        <Link to="/" className="text-sm font-semibold text-indigo-700 tracking-tight">
          Revelation SRS
        </Link>
        <NavLink
          to="/students"
          className={({ isActive }) =>
            `text-sm ${isActive ? 'text-indigo-600 font-medium' : 'text-gray-600 hover:text-gray-900'}`
          }
        >
          Students
        </NavLink>
        <div className="ml-auto">
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-800"
          >
            Sign out
          </button>
        </div>
      </nav>
      <main className="max-w-6xl mx-auto px-6 py-8">
        {children}
      </main>
    </div>
  );
}
