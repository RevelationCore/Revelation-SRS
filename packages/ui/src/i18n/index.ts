import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import enGB from './locales/en-GB.json';
import cy   from './locales/cy.json';

export function initI18n(locale = 'en-GB'): void {
  if (i18n.isInitialized) return;
  void i18n.use(initReactI18next).init({
    resources: {
      'en-GB': { translation: enGB },
      'cy':    { translation: cy },
    },
    lng:            locale,
    fallbackLng:    'en-GB',
    interpolation:  { escapeValue: false },
    returnNull:     false,
  });
}

export { i18n };

/**
 * Translates a value-set code to a human-readable label via the active locale.
 *
 * Lookup order:
 *   1. `portal.enrolment.status.<code>`
 *   2. `admin.valueSet.<code>`
 *   3. Raw code with hyphens replaced by spaces, capitalised
 *
 * R-I18N-002: components that display value-set codes (e.g. Badge) should call
 * this to show locale-appropriate labels rather than raw system codes.
 */
export function resolveValueSetLabel(code: string): string {
  if (!i18n.isInitialized) return humaniseCode(code);

  const candidates = [
    `portal.enrolment.status.${code}`,
    `admin.valueSet.${code}`,
  ];

  for (const key of candidates) {
    const val = i18n.t(key);
    if (val !== key) return val; // i18next returns the key itself when not found
  }

  return humaniseCode(code);
}

function humaniseCode(code: string): string {
  return code
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}
