import { describe, it, expect } from 'vitest';

import {
  familyName,
  firstName,
  flattenBundles,
  generateContactMethod,
  generateHomeAddress,
  generatePerson,
  generatePersonBundle,
  generatePersonIdentity,
  generateTermAddress,
  homeAddressId,
  institutionalEmail,
  personId,
  personIdentityId,
  studentNumber,
  termAddressId,
  ucasPersonalId,
} from '../src/generators/persons.js';
import { DEMO_PERSONAS } from '../src/generators/keycloak.js';
import { PERSONA_IDS } from '../src/persona-ids.js';
import { STORY_MARKERS } from '../src/story-markers.js';

const TENANT = 'demo-tenant-00000000-0000-4000-8000-000000000001';

// ─── Student numbers ──────────────────────────────────────────────────────────

describe('studentNumber', () => {
  it('starts with SN', () => {
    expect(studentNumber(1)).toMatch(/^SN/);
  });

  it('is zero-padded to 9 characters total', () => {
    expect(studentNumber(1)).toBe('SN0000001');
    expect(studentNumber(9999999)).toBe('SN9999999');
  });

  it('is unique across different sequences', () => {
    const nums = [1, 2, 3, 100, 1000].map(studentNumber);
    expect(new Set(nums).size).toBe(5);
  });
});

// ─── UCAS personal IDs ────────────────────────────────────────────────────────

describe('ucasPersonalId', () => {
  it('starts with DEMO-UCAS-', () => {
    expect(ucasPersonalId(1)).toMatch(/^DEMO-UCAS-/);
  });

  it('is stable across calls', () => {
    expect(ucasPersonalId(42)).toBe(ucasPersonalId(42));
  });

  it('is unique per sequence', () => {
    expect(ucasPersonalId(1)).not.toBe(ucasPersonalId(2));
  });
});

// ─── Names ────────────────────────────────────────────────────────────────────

describe('firstName', () => {
  it('returns a non-empty string', () => {
    expect(firstName(0).length).toBeGreaterThan(0);
  });

  it('cycles through exactly 20 values', () => {
    const names = new Set(Array.from({ length: 20 }, (_, i) => firstName(i)));
    expect(names.size).toBe(20);
  });

  it('is stable', () => {
    expect(firstName(7)).toBe(firstName(7));
  });
});

describe('familyName', () => {
  it('returns a non-empty string', () => {
    expect(familyName(0).length).toBeGreaterThan(0);
  });

  it('produces 400 unique combinations before cycling', () => {
    const names = new Set(Array.from({ length: 400 }, (_, i) => `${firstName(i)} ${familyName(i)}`));
    expect(names.size).toBe(400);
  });

  it('adds numeric suffix beyond 400 to stay unique', () => {
    const name400 = familyName(0);
    const name401 = familyName(400);
    // Same family name base but different cycle
    expect(name400).not.toBe(name401);
  });
});

describe('institutionalEmail', () => {
  it('ends with @demo.srs', () => {
    expect(institutionalEmail(1)).toMatch(/@demo\.srs$/);
  });

  it('is unique per sequence', () => {
    const emails = Array.from({ length: 100 }, (_, i) => institutionalEmail(i + 1));
    expect(new Set(emails).size).toBe(100);
  });

  it('is lowercase', () => {
    const email = institutionalEmail(5);
    expect(email).toBe(email.toLowerCase());
  });
});

// ─── Address postcodes ────────────────────────────────────────────────────────

describe('generateHomeAddress', () => {
  const pid  = personId(TENANT, 1);
  const addr = generateHomeAddress(TENANT, 1, pid);

  it('postcode starts with ZZ', () => {
    expect(addr.postcode).toMatch(/^ZZ/);
  });

  it('address type is home', () => {
    expect(addr.addressTypeCode).toBe('home');
  });

  it('line1 starts with DEMO -', () => {
    expect(addr.line1).toMatch(/^DEMO - /);
  });

  it('ID is stable', () => {
    expect(addr.id).toBe(homeAddressId(TENANT, 1));
  });

  it('tenantId is set correctly', () => {
    expect(addr.tenantId).toBe(TENANT);
  });
});

describe('generateTermAddress', () => {
  const pid  = personId(TENANT, 1);
  const addr = generateTermAddress(TENANT, 1, pid);

  it('postcode starts with ZZ', () => {
    expect(addr.postcode).toMatch(/^ZZ/);
  });

  it('address type is term', () => {
    expect(addr.addressTypeCode).toBe('term');
  });

  it('ID differs from home address ID', () => {
    const homeId = homeAddressId(TENANT, 1);
    const termId = termAddressId(TENANT, 1);
    expect(termId).not.toBe(homeId);
  });
});

// ─── Contact method ───────────────────────────────────────────────────────────

describe('generateContactMethod', () => {
  const pid    = personId(TENANT, 1);
  const method = generateContactMethod(TENANT, 1, pid);

  it('starts with +447', () => {
    expect(method.contactValue).toMatch(/^\+447/);
  });

  it('is marked as primary', () => {
    expect(method.isPrimary).toBe(true);
  });

  it('type is mobile', () => {
    expect(method.contactTypeCode).toBe('mobile');
  });
});

// ─── Person identity ──────────────────────────────────────────────────────────

describe('generatePersonIdentity', () => {
  const pid      = personId(TENANT, 5);
  const identity = generatePersonIdentity(TENANT, 5, pid);

  it('legalFirstName has DEMO - prefix', () => {
    expect(identity.legalFirstName).toMatch(/^DEMO - /);
  });

  it('institutional email ends with @demo.srs', () => {
    expect(identity.emailInstitutional).toMatch(/@demo\.srs$/);
  });

  it('DOB is a valid date string', () => {
    expect(identity.dateOfBirth).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('personId FK matches the person PK', () => {
    expect(identity.personId).toBe(pid);
  });

  it('ID is stable', () => {
    expect(identity.id).toBe(personIdentityId(TENANT, 5));
  });
});

// ─── Person ───────────────────────────────────────────────────────────────────

describe('generatePerson', () => {
  it('defaults to prospective status', () => {
    const p = generatePerson(TENANT, 10);
    expect(p.personStatusCode).toBe('prospective');
  });

  it('respects explicit statusCode', () => {
    const p = generatePerson(TENANT, 10, { statusCode: 'enrolled' });
    expect(p.personStatusCode).toBe('enrolled');
  });

  it('ID is stable', () => {
    expect(generatePerson(TENANT, 42).id).toBe(personId(TENANT, 42));
  });

  it('ID is unique per sequence', () => {
    expect(personId(TENANT, 1)).not.toBe(personId(TENANT, 2));
  });

  it('tenantId is set', () => {
    expect(generatePerson(TENANT, 1).tenantId).toBe(TENANT);
  });
});

// ─── Bundle ───────────────────────────────────────────────────────────────────

describe('generatePersonBundle', () => {
  it('includes person, identity, homeAddress, contactMethod', () => {
    const b = generatePersonBundle(TENANT, 1);
    expect(b.person).toBeDefined();
    expect(b.identity).toBeDefined();
    expect(b.homeAddress).toBeDefined();
    expect(b.contactMethod).toBeDefined();
  });

  it('no termAddress by default', () => {
    const b = generatePersonBundle(TENANT, 1);
    expect(b.termAddress).toBeUndefined();
  });

  it('includes termAddress when requested', () => {
    const b = generatePersonBundle(TENANT, 1, { includeTermAddress: true });
    expect(b.termAddress).toBeDefined();
  });

  it('all IDs reference the same tenantId', () => {
    const b = generatePersonBundle(TENANT, 7);
    expect(b.person.tenantId).toBe(TENANT);
    expect(b.identity.tenantId).toBe(TENANT);
    expect(b.homeAddress.tenantId).toBe(TENANT);
    expect(b.contactMethod.tenantId).toBe(TENANT);
  });
});

describe('flattenBundles', () => {
  it('decomposes 3 bundles into correct flat arrays', () => {
    const bundles = [1, 2, 3].map(seq =>
      generatePersonBundle(TENANT, seq, { includeTermAddress: true }),
    );
    const flat = flattenBundles(bundles);
    expect(flat.persons).toHaveLength(3);
    expect(flat.identities).toHaveLength(3);
    expect(flat.addresses).toHaveLength(6);      // home + term per person
    expect(flat.contactMethods).toHaveLength(3);
  });

  it('omits termAddress when not generated', () => {
    const bundles = [1, 2].map(seq => generatePersonBundle(TENANT, seq));
    const flat = flattenBundles(bundles);
    expect(flat.addresses).toHaveLength(2);
  });
});

// ─── Keycloak persona catalogue ───────────────────────────────────────────────

describe('DEMO_PERSONAS', () => {
  it('has exactly 10 personas', () => {
    expect(DEMO_PERSONAS).toHaveLength(10);
  });

  it('all emails end with @demo.srs', () => {
    for (const p of DEMO_PERSONAS) {
      expect(p.email).toMatch(/@demo\.srs$/);
    }
  });

  it('all persona IDs are unique', () => {
    const ids = DEMO_PERSONAS.map(p => p.personaId);
    expect(new Set(ids).size).toBe(10);
  });

  it('all persona IDs reference known PERSONA_IDS values', () => {
    const known = new Set(Object.values(PERSONA_IDS));
    for (const p of DEMO_PERSONAS) {
      expect(known.has(p.personaId)).toBe(true);
    }
  });

  it('all first names have DEMO prefix', () => {
    for (const p of DEMO_PERSONAS) {
      expect(p.firstName).toMatch(/^DEMO /);
    }
  });

  it('every persona has at least one role', () => {
    for (const p of DEMO_PERSONAS) {
      expect(p.roles.length).toBeGreaterThanOrEqual(1);
    }
  });
});

// ─── PERSONA_IDS completeness ─────────────────────────────────────────────────

describe('PERSONA_IDS', () => {
  it('has exactly 10 entries', () => {
    expect(Object.keys(PERSONA_IDS)).toHaveLength(10);
  });

  it('all values are unique', () => {
    const values = Object.values(PERSONA_IDS);
    expect(new Set(values).size).toBe(values.length);
  });
});

// ─── STORY_MARKERS completeness ───────────────────────────────────────────────

describe('STORY_MARKERS', () => {
  it('includes S1 and S2 markers', () => {
    expect(STORY_MARKERS.S1_ALICE_APPLICANT).toBeDefined();
    expect(STORY_MARKERS.S1_BOB_APPLICANT).toBeDefined();
    expect(STORY_MARKERS.S1_CAROL_APPLICANT).toBeDefined();
    expect(STORY_MARKERS.S2_ALICE_ENROLLED).toBeDefined();
    expect(STORY_MARKERS.S2_BOB_INTERMITTING).toBeDefined();
    expect(STORY_MARKERS.S2_CAROL_GRADUATED).toBeDefined();
  });

  it('all marker values are unique', () => {
    const values = Object.values(STORY_MARKERS);
    expect(new Set(values).size).toBe(values.length);
  });
});
