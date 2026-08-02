/**
 * Shared design tokens — "cool professional" direction: slate neutrals,
 * indigo accent, semantic status colours, Inter typeface.
 *
 * These are the plain-JS values behind the Tailwind preset
 * (../../tailwind-preset.js) so anything that needs raw colour values
 * outside Tailwind classes (charts, inline SVG, canvas) stays in sync with
 * the same palette instead of hand-picking hex codes.
 */

export const colors = {
  primary: {
    50:  '#eef2ff',
    100: '#e0e7ff',
    200: '#c7d2fe',
    300: '#a5b4fc',
    400: '#818cf8',
    500: '#6366f1',
    600: '#4f46e5',
    700: '#4338ca',
    800: '#3730a3',
    900: '#312e81',
  },
  neutral: {
    50:  '#f8fafc',
    100: '#f1f5f9',
    200: '#e2e8f0',
    300: '#cbd5e1',
    400: '#94a3b8',
    500: '#64748b',
    600: '#475569',
    700: '#334155',
    800: '#1e293b',
    900: '#0f172a',
  },
  success: {
    50:  '#ecfdf5',
    100: '#d1fae5',
    200: '#a7f3d0',
    300: '#6ee7b7',
    400: '#34d399',
    500: '#10b981',
    600: '#059669',
    700: '#047857',
    800: '#065f46',
    900: '#064e3b',
  },
  warning: {
    50:  '#fffbeb',
    100: '#fef3c7',
    200: '#fde68a',
    300: '#fcd34d',
    400: '#fbbf24',
    500: '#f59e0b',
    600: '#d97706',
    700: '#b45309',
    800: '#92400e',
    900: '#78350f',
  },
  danger: {
    50:  '#fff1f2',
    100: '#ffe4e6',
    200: '#fecdd3',
    300: '#fda4af',
    400: '#fb7185',
    500: '#f43f5e',
    600: '#e11d48',
    700: '#be123c',
    800: '#9f1239',
    900: '#881337',
  },
} as const;

export const fontFamily = {
  sans: ['InterVariable', 'Inter', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
} as const;

export const radius = {
  sm: '0.25rem',
  md: '0.375rem',
  lg: '0.5rem',
  xl: '0.75rem',
} as const;

export const shadow = {
  card:      '0 1px 2px 0 rgb(15 23 42 / 0.05)',
  cardHover: '0 4px 12px 0 rgb(15 23 42 / 0.08)',
  popover:   '0 10px 30px -5px rgb(15 23 42 / 0.15)',
} as const;

/** Status-value → semantic colour, for badges/pills/chips reading a code from the domain. */
export const statusTone: Record<string, 'success' | 'warning' | 'danger' | 'neutral' | 'primary'> = {
  enrolled: 'success', active: 'success', approved: 'success', completed: 'success',
  processed: 'success', upheld: 'success', granted: 'success', published: 'success',
  applied: 'success', reconciled: 'success', signed_off: 'success', 'signed-off': 'success',
  registered: 'success', student: 'success',
  submitted: 'primary', graduated: 'primary',
  pending: 'warning', 'under-review': 'warning', 'in-progress': 'warning',
  intermitting: 'warning', draft: 'warning', flagged: 'warning', suspended: 'warning',
  withdrawn: 'danger', failed: 'danger', rejected: 'danger', refused: 'danger',
  'not-upheld': 'danger', dismissed: 'danger', blocking: 'danger', 'tamper-suspected': 'danger',
  deceased: 'danger',
  alumnus: 'neutral', prospective: 'neutral', inactive: 'neutral', skipped: 'neutral', merged: 'neutral',
};
