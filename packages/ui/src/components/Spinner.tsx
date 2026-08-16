interface SpinnerProps {
  size?:  'sm' | 'md' | 'lg';
  label?: string;
}

export function Spinner({ size = 'md', label = 'Loading…' }: SpinnerProps) {
  const cls = { sm: 'h-4 w-4', md: 'h-8 w-8', lg: 'h-12 w-12' }[size];
  return (
    <span role="status" aria-label={label}>
      <span
        aria-hidden="true"
        className={`block motion-safe:animate-spin rounded-full border-2 border-neutral-300 border-t-primary-600 ${cls}`}
      />
    </span>
  );
}
