import { Type } from '@sinclair/typebox';

/**
 * Shared request-schema pieces for the wellbeing routes (enterprise
 * readiness plan, item 1.7). Record ids are UUIDs; actor ids (assessorId,
 * practitionerId and the like) are identity-provider subjects, so plain
 * strings. Dates are strings the domain parses.
 */

export const Uuid = Type.String({ format: 'uuid' });
export const Text = Type.String({ minLength: 1 });
export const OptionalText = Type.Optional(Type.String());
export const DateText = Type.String({ minLength: 1, description: 'ISO 8601 date or date-time' });

/** Path parameters, all UUIDs. */
export function idParams<K extends string>(...names: K[]) {
  return Type.Object(Object.fromEntries(names.map((n) => [n, Uuid])) as Record<K, typeof Uuid>);
}
