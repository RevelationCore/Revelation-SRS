import { ValidationError } from '@revelation-srs/domain';

/**
 * Guard for the close-and-replace bitemporal update used across the core
 * services: the current version is closed with `validTo = nextValidFrom` and a
 * successor inserted from that instant. A change dated on or before the
 * current version's own `validFrom` would give the closed version an empty or
 * negative valid period, which every `*_temporal_check_valid` constraint
 * (`valid_to IS NULL OR valid_to > valid_from`) rejects. Checking first turns
 * that database error (a 500) into a 422 the caller can act on.
 */
export function assertChangeAfterCurrentVersion(
  currentValidFrom: Date,
  nextValidFrom: Date,
): void {
  if (nextValidFrom <= currentValidFrom) {
    throw new ValidationError(
      `validFrom must be after the current version's validFrom (${currentValidFrom.toISOString()})`,
      [{ field: 'validFrom', message: `must be after ${currentValidFrom.toISOString()}` }],
    );
  }
}
