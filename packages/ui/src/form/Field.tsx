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
      <label htmlFor={id} className="block text-sm font-medium text-gray-700">
        {label}
        {required && (
          <span className="ml-0.5 text-red-500" aria-hidden="true">
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
          'w-full rounded border px-3 py-2 text-sm',
          'focus:outline-none focus:ring-2 focus:ring-indigo-500',
          error
            ? 'border-red-400 focus:ring-red-500'
            : 'border-gray-300',
        ].join(' ')}
        {...registration}
      />
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-red-600">
          {error.message}
        </p>
      )}
    </div>
  );
}
