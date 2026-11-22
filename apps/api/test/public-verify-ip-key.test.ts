/**
 * BL-184: the public verification log hashes the caller's IP with a secret
 * HMAC key. A known key can be reversed by hashing every IPv4 address, so
 * outside development and test there is no fallback and the API refuses to
 * start without one.
 */
import { describe, expect, it } from 'vitest';

import { DEV_PUBLIC_VERIFY_IP_KEY, assertPublicVerifyIpKey, publicVerifyIpKey } from '../src/config.js';

const SECRET = 'a'.repeat(32);

describe('public verification IP key (BL-184)', () => {
  it('has no fallback outside development and test', () => {
    for (const env of ['production', 'staging', 'uat']) {
      expect(publicVerifyIpKey(env, undefined)).toBeNull();
      expect(publicVerifyIpKey(env, 'srs-public-verify')).toBeNull(); // the old published default
      expect(publicVerifyIpKey(env, 'a'.repeat(31))).toBeNull();
      expect(publicVerifyIpKey(env, SECRET)).toBe(SECRET);
    }
  });

  it('refuses to start without a secret key', () => {
    expect(() => assertPublicVerifyIpKey('srs-api', 'production', undefined)).toThrow(/Refusing to start srs-api in 'production'.*PUBLIC_VERIFY_IP_KEY/);
    expect(() => assertPublicVerifyIpKey('srs-api', 'production', 'short')).toThrow(/at least 32 characters/);
    expect(() => assertPublicVerifyIpKey('srs-api', 'production', SECRET)).not.toThrow();
  });

  it('uses a fixed key in development and test', () => {
    expect(publicVerifyIpKey('test', undefined)).toBe(DEV_PUBLIC_VERIFY_IP_KEY);
    expect(publicVerifyIpKey('development', 'local')).toBe('local');
    expect(() => assertPublicVerifyIpKey('srs-api', 'development', undefined)).not.toThrow();
  });
});
