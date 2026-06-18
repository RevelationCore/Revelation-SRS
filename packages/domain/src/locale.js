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
/**
 * Convert a MonetaryAmount to a plain numeric value for display.
 * Returns a number with the correct decimal precision (not formatted as a string).
 */
export function monetaryAmountToNumber(amount) {
    if (amount.minorUnits === 0)
        return Number(amount.amount);
    const divisor = 10 ** amount.minorUnits;
    return Number(amount.amount) / divisor;
}
/**
 * Construct a MonetaryAmount from a numeric value and currency metadata.
 * Rounds to the currency's minor unit precision.
 */
export function monetaryAmountFromNumber(value, currencyCode, minorUnits) {
    const multiplier = 10 ** minorUnits;
    return {
        amount: BigInt(Math.round(value * multiplier)),
        currencyCode,
        minorUnits,
    };
}
//# sourceMappingURL=locale.js.map