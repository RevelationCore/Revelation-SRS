import { canonicalJson } from '@revelation-srs/domain';
import { describe, expect, it } from 'vitest';

import { canonicalHash } from '../src/platform/canonical-hash.js';

/** RFC 8785 test vectors (sections 3.2.2, 3.2.3 and appendix B). */
describe('canonicalJson (RFC 8785)', () => {
  it('serialises the RFC 3.2.2 example', () => {
    const input = JSON.parse('{"numbers":[333333333.33333329,1E30,4.50,2e-3,0.000000000000000000000000001],"string":"\\u20ac$\\u000F\\u000aA\'\\u0042\\u0022\\u005c\\\\\\"\\/","literals":[null,true,false]}') as unknown;
    expect(canonicalJson(input)).toBe('{"literals":[null,true,false],"numbers":[333333333.3333333,1e+30,4.5,0.002,1e-27],"string":"€$\\u000f\\nA\'B\\"\\\\\\\\\\"/"}');
  });

  it('sorts keys by UTF-16 code unit (RFC 3.2.3)', () => {
    const input: Record<string, string> = {
      '\u20ac': 'Euro Sign', '\r': 'Carriage Return', '\ufb33': 'Hebrew Letter Dalet With Dagesh', '1': 'One',
      '\ud83d\ude00': 'Emoji: Grinning Face', '\u0080': 'Control', '\u00f6': 'Latin Small Letter O With Diaeresis',
    };
    const out = canonicalJson(input);
    const order = ['Carriage Return', 'One', 'Control', 'Latin Small Letter O With Diaeresis', 'Euro Sign', 'Emoji: Grinning Face', 'Hebrew Letter Dalet With Dagesh'];
    const positions = order.map((v) => out.indexOf(`"${v}"`));
    expect(positions.every((p) => p > 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
  });

  it.each([
    [0, '0'], [-0, '0'], [1e21, '1e+21'], [1e-7, '1e-7'], [123456789012345680000, '123456789012345680000'],
    [5e-324, '5e-324'], [1.7976931348623157e308, '1.7976931348623157e+308'], [0.000001, '0.000001'], [-1.5, '-1.5'],
  ])('serialises the number %s as %s (appendix B)', (n, expected) => {
    expect(canonicalJson(n)).toBe(expected);
  });

  it('refuses values JSON cannot represent exactly', () => {
    expect(() => canonicalJson(Number.NaN)).toThrow();
    expect(() => canonicalJson({ a: undefined })).toThrow();
    expect(() => canonicalJson(new Date())).toThrow();
  });

  it('hashes nested objects the same whatever their key order', () => {
    expect(canonicalHash({ b: [1, { y: 2, x: 1 }], a: 'z' })).toBe(canonicalHash({ a: 'z', b: [1, { x: 1, y: 2 }] }));
    expect(canonicalHash({ a: 1 })).toMatch(/^sha256:[0-9a-f]{64}$/);
  });
});
