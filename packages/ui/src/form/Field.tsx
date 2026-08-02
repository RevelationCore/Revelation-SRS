import type { FieldError, UseFormRegisterReturn } from 'react-hook-form';

interface FieldProps {
  label:        string;
  registration: UseFormRegisterReturn;
  error?:       FieldError;
  type?:        string;
  required?:    boolean;
  placeholder?: string;
}

export function Field({
  label,
  registration,
  error,
  type = 'text',
  required,
  placeholder,
}: FieldProps) {
  const id = registration.name;
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="block text-sm font-medium text-neutral-700">
        {label}
        {required && (
          <span className="ml-0.5 text-danger-600" aria-hidden="true">
            *
          </span>
        )}
      </label>
      <input
        id={id}
        type={type}
        placeholder={placeholder}
        aria-required={required ?? undefined}
        aria-invalid={error ? 'true' : undefined}
        aria-describedby={error ? `${id}-error` : undefined}
        className={[
          'w-full rounded-md border px-3 py-2 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-primary-500',
          error
            ? 'border-danger-400 focus:ring-danger-500'
            : 'border-neutral-300',
        ].join(' ')}
        {...registration}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger-600">
          {error.message}
        </p>
      )}
    </div>
  );
}
