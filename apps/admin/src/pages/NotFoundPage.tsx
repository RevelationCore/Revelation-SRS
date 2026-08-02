import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center py-32 text-center">
      <p className="text-5xl font-bold text-neutral-500" aria-hidden="true">404</p>
      <h1 className="mt-4 text-xl font-semibold text-neutral-800">Page not found</h1>
      <p className="mt-2 text-sm text-neutral-500">
        The page you requested does not exist.
      </p>
      <Link to="/dashboard" className="mt-6 text-sm text-primary-600 hover:underline">
        Back to dashboard
      </Link>
    </div>
  );
}
