import { forwardRef } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';

const FIELD_BASE = [
  'w-full rounded-md border px-3 py-2 text-sm text-neutral-900',
  'placeholder:text-neutral-400',
  'focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-primary-500',
  'disabled:bg-neutral-100 disabled:text-neutral-500',
].join(' ');

function fieldBorder(invalid?: boolean): string {
  return invalid ? 'border-danger-400' : 'border-neutral-300';
}

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  invalid?: boolean;
}

// Every field below forwards its ref. react-hook-form's register() spreads a
// ref onto whatever element it's given to read/reset the field's current
// value; a plain (non-forwardRef) function component silently drops that
// ref, which leaves the field permanently "unregistered" from RHF's
// perspective — it renders correctly but never reports a value, so
// submission fails validation as if the field were always empty.

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ invalid, className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      aria-invalid={invalid ? 'true' : undefined}
      className={`${FIELD_BASE} ${fieldBorder(invalid)} ${className}`}
      {...rest}
    />
  );
});

interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  invalid?: boolean;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ invalid, className = '', children, ...rest }, ref) {
  return (
    <select
      ref={ref}
      aria-invalid={invalid ? 'true' : undefined}
      className={`${FIELD_BASE} ${fieldBorder(invalid)} bg-white ${className}`}
      {...rest}
    >
      {children}
    </select>
  );
});

interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  invalid?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea({ invalid, className = '', ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      aria-invalid={invalid ? 'true' : undefined}
      className={`${FIELD_BASE} ${fieldBorder(invalid)} ${className}`}
      {...rest}
    />
  );
});

export const Checkbox = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Checkbox({ className = '', ...rest }, ref) {
  return (
    <input
      ref={ref}
      type="checkbox"
      className={`h-4 w-4 rounded border-neutral-300 text-primary-600 focus:ring-2 focus:ring-primary-500 ${className}`}
      {...rest}
    />
  );
});

interface LabelledFieldProps {
  label:        string;
  htmlFor:      string;
  required?:    boolean;
  error?:       string;
  hint?:        string;
  children:     ReactNode;
}

/** Label + control + error/hint wrapper for controls not driven by react-hook-form's registration object (see form/Field.tsx for that case). */
export function LabelledField({ label, htmlFor, required, error, hint, children }: LabelledFieldProps) {
  return (
    <div className="space-y-1">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-neutral-700">
        {label}
        {required && <span className="ml-0.5 text-danger-600" aria-hidden="true">*</span>}
      </label>
      {children}
      {error && (
        <p id={`${htmlFor}-error`} role="alert" className="text-xs text-danger-600">
          {error}
        </p>
      )}
      {!error && hint && <p className="text-xs text-neutral-500">{hint}</p>}
    </div>
  );
}
