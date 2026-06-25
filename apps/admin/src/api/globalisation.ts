import { api } from './client.js';

export interface LocaleConfig {
  defaultLocale:    string;
  defaultTimeZone:  string;
  supportedLocales: string[];
}

export interface CurrencyConfig {
  defaultCurrencyCode: string;
  acceptedCurrencies:  string[];
}

export interface ValueSetLabels {
  setCode: string;
  labels:  Record<string, string>;
}

export interface Locale {
  localeCode:  string;
  displayName: string;
  isEnabled:   boolean;
}

export function getLocaleConfig(): Promise<LocaleConfig> {
  return api.get<LocaleConfig>('/api/v1/admin/globalisation/locale-config');
}

export function updateLocaleConfig(body: Partial<LocaleConfig>): Promise<void> {
  return api.put('/api/v1/admin/globalisation/locale-config', body);
}

export function listLocales(): Promise<Locale[]> {
  return api.get<Locale[]>('/api/v1/admin/globalisation/locales');
}

export function getCurrencyConfig(): Promise<CurrencyConfig> {
  return api.get<CurrencyConfig>('/api/v1/admin/globalisation/currency-config');
}

export function updateCurrencyConfig(body: Partial<CurrencyConfig>): Promise<void> {
  return api.put('/api/v1/admin/globalisation/currency-config', body);
}

export function listValueSetLabels(): Promise<ValueSetLabels[]> {
  return api
    .get<{ setCode: string }[]>('/api/v1/admin/globalisation/value-set-labels')
    .then((sets) => sets.map((s) => ({ setCode: s.setCode, labels: {} })));
}

export function getValueSetLabels(setCode: string): Promise<ValueSetLabels> {
  return api
    .get<{ code: string; displayLabel: string }[]>(
      `/api/v1/admin/globalisation/value-set-labels/${setCode}`,
    )
    .then((members) => ({
      setCode,
      labels: Object.fromEntries(members.map((m) => [m.code, m.displayLabel])),
    }));
}

export function updateValueSetLabels(setCode: string, labels: Record<string, string>): Promise<void> {
  return api.put(`/api/v1/admin/globalisation/value-set-labels/${setCode}`, { labels });
}
