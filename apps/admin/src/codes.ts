import { type ReactNode, createElement } from 'react';
import { useTranslation } from 'react-i18next';
import { CodeSetProvider, type CodeLoader, localeForLanguage } from '@revelation-srs/ui';

import { getFieldValueSet } from './api/valueSets.js';

/** Every value of a field's value set (retired and hidden too), so any code a record holds has a label. */
export const loadCodes: CodeLoader = (entity, field, locale) => getFieldValueSet(entity, field, 'all', locale);

/** The code provider in the reader's language: value sets follow i18n. */
export function Codes({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  return createElement(CodeSetProvider, { load: loadCodes, locale: localeForLanguage(i18n.language), children });
}
