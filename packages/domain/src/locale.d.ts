/**
 * Shared globalisation types.
 *
 * MonetaryAmount is the canonical wire and service representation for any
 * monetary value in the SRS. All amounts are carried as integer minor units
 * (pence, cents, etc.) plus the ISO 4217 currency code. The minorUnits field
 * records the scale so callers can format without a separate currency lookup.
 *
 * LocaleContext carries the resolved locale, time zone, and functional currency
 * for a request or operation. Services that render labels, format dates, or
 * handle money use this to apply the correct conventions.
 */
export interface MonetaryAmount {
    /** Integer minor units (e.g. pence for GBP, cents for USD, yen for JPY). */
    amount: bigint;
    /** ISO 4217 alpha-3 currency code. */
    currencyCode: string;
    /** Number of decimal places implied by minor units (e.g. 2 for GBP, 0 for JPY). */
    minorUnits: number;
}
export interface LocaleContext {
    /** BCP-47 locale code (e.g. 'en-GB', 'cy-GB'). */
    localeCode: string;
    /** BCP-47 fallback locale code, used when a label is not available in localeCode. */
    fallbackLocale: string;
    /** IANA time zone identifier (e.g. 'Europe/London'). */
    timeZone: string;
    /** ISO 4217 alpha-3 functional currency code for this tenant. */
    currencyCode: string;
}
/**
 * Convert a MonetaryAmount to a plain numeric value for display.
 * Returns a number with the correct decimal precision (not formatted as a string).
 */
export declare function monetaryAmountToNumber(amount: MonetaryAmount): number;
/**
 * Construct a MonetaryAmount from a numeric value and currency metadata.
 * Rounds to the currency's minor unit precision.
 */
export declare function monetaryAmountFromNumber(value: number, currencyCode: string, minorUnits: number): MonetaryAmount;
//# sourceMappingURL=locale.d.ts.map