import { statusTone } from '../theme/tokens.js';

const TONE_CLASSES: Record<string, string> = {
  success: 'bg-success-100 text-success-800',
  warning: 'bg-warning-100 text-warning-800',
  danger:  'bg-danger-100 text-danger-800',
  primary: 'bg-primary-100 text-primary-800',
  neutral: 'bg-neutral-100 text-neutral-700',
};

interface BadgeProps {
  value: string;
  label?: string;
}

export function Badge({ value, label }: BadgeProps) {
  const tone        = statusTone[value] ?? 'neutral';
  const displayText = label ?? value;
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${TONE_CLASSES[tone]}`}>
      {displayText}
    </span>
  );
}
