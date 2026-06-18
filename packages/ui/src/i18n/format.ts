/** Intl-based locale-aware formatters. All accept a locale string defaulting to 'en-GB'. */

export function formatDate(
  value:   Date | string | null | undefined,
  locale:  string = 'en-GB',
  options: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' },
): string {
  if (value == null) return '—';
  const d = typeof value === 'string' ? new Date(value) : value;
  if (isNaN(d.getTime())) return '—';
  return new Intl.DateTimeFormat(locale, options).format(d);
}

export function formatDateTime(
  value:  Date | string | null | undefined,
  locale: string = 'en-GB',
): string {
  return formatDate(value, locale, {
    day:    'numeric',
    month:  'short',
    year:   'numeric',
    hour:   '2-digit',
    minute: '2-digit',
  });
}

export function formatNumber(
  value:   number | null | undefined,
  locale:  string = 'en-GB',
  options: Intl.NumberFormatOptions = {},
): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(locale, options).format(value);
}

export function formatCurrency(
  amount:   number | null | undefined,
  currency: string = 'GBP',
  locale:   string = 'en-GB',
): string {
  if (amount == null) return '—';
  return new Intl.NumberFormat(locale, {
    style:                 'currency',
    currency,
    minimumFractionDigits: 2,
  }).format(amount);
}

export function formatPercent(
  value:  number | null | undefined,
  locale: string = 'en-GB',
): string {
  if (value == null) return '—';
  return new Intl.NumberFormat(locale, {
    style:                  'percent',
    minimumFractionDigits:  1,
    maximumFractionDigits:  1,
  }).format(value / 100);
}
