import type {
  NewPerson,
  NewPersonIdentity,
  NewStudentAddress,
  NewStudentContactMethod,
} from '@revelation-srs/db';

import { deterministicId } from './ids.js';

// ─── Fictional data namespace ─────────────────────────────────────────────────
// Bounded sets of non-real names. 20 × 20 = 400 unique combinations; sequences
// beyond 400 are made unique by a numeric suffix on the family name.

const DEMO_FIRST_NAMES = [
  'Aldren', 'Bryven', 'Caslow', 'Dorath', 'Elvan',
  'Fravel', 'Gerith', 'Hovan',  'Idran',  'Jorven',
  'Kaleth', 'Lyrath', 'Miveth', 'Norack', 'Orveth',
  'Pravan', 'Quelby', 'Ryven',  'Suleth', 'Tavan',
] as const;

const DEMO_FAMILY_NAMES = [
  'Ashwick', 'Bexford', 'Cralton', 'Draveth', 'Elwick',
  'Fenton',  'Gralick', 'Harwick', 'Ixford',  'Jaxwick',
  'Kelveth', 'Lavick',  'Morden',  'Norwick', 'Orvick',
  'Pendwick', 'Quelton', 'Ranwick', 'Stavick', 'Tunwick',
] as const;

const DEMO_CITIES = [
  'Demo City', 'Synthetic Town', 'Fictional Borough',
  'Test Village', 'Sample Heath', 'Specimen Grove',
  'Mock Haven',   'Dummy Vale',   'Placeholder Bay',
  'Surrogate End',
] as const;

const SOURCE_SYSTEMS = ['ucas', 'direct', 'direct', 'agent', 'international', 'international', 'clearing'] as const;
const NATIONALITIES  = ['GB', 'GB', 'GB', 'GB', 'GB', 'GB', 'GB', 'GB', 'IE', 'DE', 'FR', 'IN', 'CN', 'NG'] as const;
const DOMICILES      = ['GB', 'GB', 'GB', 'GB', 'GB', 'IE', 'DE', 'FR', 'IN', 'CN'] as const;
const GENDERS        = ['M', 'F', 'F', 'M', 'F', 'M', 'X'] as const;

// ─── ID helpers ───────────────────────────────────────────────────────────────

export function personId(tenantId: string, seq: number): string {
  return deterministicId('person', tenantId, String(seq));
}

export function personIdentityId(tenantId: string, seq: number): string {
  return deterministicId('person-identity', tenantId, String(seq));
}

export function homeAddressId(tenantId: string, seq: number): string {
  return deterministicId('address-home', tenantId, String(seq));
}

export function termAddressId(tenantId: string, seq: number): string {
  return deterministicId('address-term', tenantId, String(seq));
}

export function contactMethodId(tenantId: string, seq: number, typeCode: string): string {
  return deterministicId('contact-method', tenantId, String(seq), typeCode);
}

export function ucasPersonalId(seq: number): string {
  return `DEMO-UCAS-${String(seq).padStart(8, '0')}`;
}

/** Institution-issued student number. SN-prefixed, out-of-range for real identifiers. */
export function studentNumber(seq: number): string {
  return `SN${String(seq).padStart(7, '0')}`;
}

// ─── Name derivation ──────────────────────────────────────────────────────────

export function firstName(seq: number): string {
  return DEMO_FIRST_NAMES[seq % DEMO_FIRST_NAMES.length]!;
}

export function familyName(seq: number): string {
  const base  = DEMO_FAMILY_NAMES[Math.floor(seq / DEMO_FIRST_NAMES.length) % DEMO_FAMILY_NAMES.length]!;
  const cycle = Math.floor(seq / (DEMO_FIRST_NAMES.length * DEMO_FAMILY_NAMES.length));
  return cycle === 0 ? base : `${base}${cycle + 1}`;
}

export function institutionalEmail(seq: number): string {
  return `${firstName(seq).toLowerCase()}.${familyName(seq).toLowerCase()}.${seq}@demo.srs`;
}

// ─── Address helpers ──────────────────────────────────────────────────────────

function postcode(seq: number): string {
  const area   = String(Math.floor(seq / 100) % 99 + 1).padStart(2, '0');
  const sector = (seq % 9) + 1;
  const unit   = String.fromCharCode(65 + (seq % 26)) + String.fromCharCode(65 + ((seq + 5) % 26));
  return `ZZ${area} ${sector}${unit}`;
}

// ─── Generators ───────────────────────────────────────────────────────────────

/**
 * Generate a single person root record.
 *
 * `statusCode` defaults to 'prospective' for applicants; callers pass
 * 'enrolled' / 'intermitting' / 'withdrawn' / 'graduated' for enrolment
 * induction scenarios.
 */
export function generatePerson(
  tenantId:     string,
  seq:          number,
  opts: {
    statusCode?:     string;
    sourceSystem?:   string;
    sourceReference?: string;
  } = {},
): NewPerson {
  return {
    id:               personId(tenantId, seq),
    tenantId,
    studentNumber:    studentNumber(seq),
    personStatusCode: opts.statusCode     ?? 'prospective',
    sourceSystem:     opts.sourceSystem   ?? SOURCE_SYSTEMS[seq % SOURCE_SYSTEMS.length]!,
    sourceReference:  opts.sourceReference ?? null,
  };
}

/**
 * Generate the bitemporal personal-data record for a person.
 *
 * All free-text name fields carry `DEMO - ` prefix as per fictional-data rules
 * for special-category data.  The institutional email is under `demo.srs`.
 */
export function generatePersonIdentity(
  tenantId:  string,
  seq:       number,
  personPk:  string,
  validFrom: Date = new Date('2024-08-01T00:00:00Z'),
): NewPersonIdentity {
  const fName = firstName(seq);
  const lName = familyName(seq);

  // DOB: synthetic range 1988–2005 (ages 20–37 at reference 2025-11-14)
  const birthYear  = 1988 + (seq % 18);
  const birthMonth = String((seq % 12) + 1).padStart(2, '0');
  const birthDay   = String((seq % 28) + 1).padStart(2, '0');

  return {
    id:                      personIdentityId(tenantId, seq),
    tenantId,
    personId:                personPk,
    validFrom,
    recordedAt:              validFrom,
    legalFirstName:          `DEMO - ${fName}`,
    legalFamilyName:         lName,
    preferredName:           fName,
    dateOfBirth:             `${birthYear}-${birthMonth}-${birthDay}`,
    genderCode:              GENDERS[seq % GENDERS.length]!,
    nationalityCode:         NATIONALITIES[seq % NATIONALITIES.length]!,
    domicileCode:            DOMICILES[seq % DOMICILES.length]!,
    emailInstitutional:      institutionalEmail(seq),
    emailPersonal:           `${fName.toLowerCase()}.${lName.toLowerCase()}${seq}@example.invalid`,
    communicationLocaleCode: 'en-GB',
    preferredTimeZone:       'Europe/London',
  };
}

/**
 * Generate a home address.
 * Uses `ZZ`-prefix postcodes (reserved, cannot match any real UK address).
 */
export function generateHomeAddress(
  tenantId:  string,
  seq:       number,
  personPk:  string,
  validFrom: Date = new Date('2024-08-01T00:00:00Z'),
): NewStudentAddress {
  return {
    id:              homeAddressId(tenantId, seq),
    tenantId,
    personId:        personPk,
    validFrom,
    recordedAt:      validFrom,
    addressTypeCode: 'home',
    line1:           `DEMO - ${seq} Fictional Road`,
    line2:           null,
    city:            DEMO_CITIES[seq % DEMO_CITIES.length]!,
    postcode:        postcode(seq),
    countryCode:     NATIONALITIES[seq % NATIONALITIES.length] === 'GB' ? 'GB' : 'GB',
  };
}

/**
 * Generate a term-time address (used in S2 for enrolled students).
 */
export function generateTermAddress(
  tenantId:  string,
  seq:       number,
  personPk:  string,
  validFrom: Date = new Date('2024-08-01T00:00:00Z'),
): NewStudentAddress {
  const termSeq = seq + 500_000; // offset ensures distinct IDs from home addresses
  return {
    id:              termAddressId(tenantId, seq),
    tenantId,
    personId:        personPk,
    validFrom,
    recordedAt:      validFrom,
    addressTypeCode: 'term',
    line1:           `DEMO - ${termSeq % 200 + 1} University Quarter`,
    line2:           `Flat ${(seq % 40) + 1}`,
    city:            'Demo City',
    postcode:        `ZZ01 ${(seq % 9) + 1}UC`,
    countryCode:     'GB',
  };
}

/**
 * Generate a mobile contact method record.
 */
export function generateContactMethod(
  tenantId:  string,
  seq:       number,
  personPk:  string,
  validFrom: Date = new Date('2024-08-01T00:00:00Z'),
): NewStudentContactMethod {
  // Synthetic mobile numbers using 07700 900xxx range (Ofcom-reserved for fiction)
  const suffix = String(seq % 1000).padStart(3, '0');
  return {
    id:              contactMethodId(tenantId, seq, 'mobile'),
    tenantId,
    personId:        personPk,
    validFrom,
    recordedAt:      validFrom,
    contactTypeCode: 'mobile',
    contactValue:    `+4477009${suffix.padStart(5, '0')}`,
    isPrimary:       true,
  };
}

// ─── Bulk generators ──────────────────────────────────────────────────────────

export interface PersonBundle {
  person:        NewPerson;
  identity:      NewPersonIdentity;
  homeAddress:   NewStudentAddress;
  termAddress?:  NewStudentAddress;
  contactMethod: NewStudentContactMethod;
}

/**
 * Generate a full person bundle (person + identity + address(es) + contact)
 * for a single sequence number.
 */
export function generatePersonBundle(
  tenantId: string,
  seq:      number,
  opts: {
    statusCode?:     string;
    sourceSystem?:   string;
    sourceReference?: string;
    includeTermAddress?: boolean;
    validFrom?:      Date;
  } = {},
): PersonBundle {
  const pk        = personId(tenantId, seq);
  const validFrom = opts.validFrom ?? new Date('2024-08-01T00:00:00Z');

  return {
    person:        generatePerson(tenantId, seq, opts),
    identity:      generatePersonIdentity(tenantId, seq, pk, validFrom),
    homeAddress:   generateHomeAddress(tenantId, seq, pk, validFrom),
    ...(opts.includeTermAddress ? { termAddress: generateTermAddress(tenantId, seq, pk, validFrom) } : {}),
    contactMethod: generateContactMethod(tenantId, seq, pk, validFrom),
  };
}

/**
 * Decompose an array of person bundles into flat arrays suitable for batch
 * insertion.  Term addresses are included only when present.
 */
export function flattenBundles(bundles: PersonBundle[]): {
  persons:        NewPerson[];
  identities:     NewPersonIdentity[];
  addresses:      NewStudentAddress[];
  contactMethods: NewStudentContactMethod[];
} {
  const persons:        NewPerson[]               = [];
  const identities:     NewPersonIdentity[]       = [];
  const addresses:      NewStudentAddress[]       = [];
  const contactMethods: NewStudentContactMethod[] = [];

  for (const b of bundles) {
    persons.push(b.person);
    identities.push(b.identity);
    addresses.push(b.homeAddress);
    if (b.termAddress) addresses.push(b.termAddress);
    contactMethods.push(b.contactMethod);
  }

  return { persons, identities, addresses, contactMethods };
}
