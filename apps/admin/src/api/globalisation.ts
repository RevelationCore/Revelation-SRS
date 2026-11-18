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

export interface Locale {
  localeCode:        string;
  displayName:       string;
  nativeDisplayName: string;
  isRtl:             boolean;
  isPlatformDefault: boolean;
  active:            boolean;
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

