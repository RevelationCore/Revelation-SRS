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
