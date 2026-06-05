export function Spinner({ size = 'md' }: { size?: 'sm' | 'md' }) {
  const cls = size === 'sm' ? 'h-4 w-4' : 'h-8 w-8';
  return (
    <div className={`animate-spin rounded-full border-2 border-gray-300 border-t-indigo-600 ${cls}`} />
  );
}
