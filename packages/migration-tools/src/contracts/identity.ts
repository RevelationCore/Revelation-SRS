/**
 * Canonical import contract — student identity and contact data.
 *
 * Optional fields use `T | undefined` to be compatible with exactOptionalPropertyTypes:
 * mapping templates assign source values that may be undefined.
 */

export interface ImportAddress {
  addressTypeCode: string;
  line1:           string;
  line2?:          string | undefined;
  city?:           string | undefined;
  postcode?:       string | undefined;
  countryCode?:    string | undefined;    // ISO 3166-1 alpha-2
}

export interface ImportPerson {
  externalId:          string;
  studentNumber?:      string | undefined;
  hesaId?:             string | undefined;
  legalFirstName:      string;
  legalFamilyName:     string;
  preferredName?:      string | undefined;
  dateOfBirth?:        string | undefined;   // ISO date YYYY-MM-DD
  genderCode?:         string | undefined;   // 'M' | 'F' | 'X'
  nationalityCode?:    string | undefined;   // ISO 3166-1 alpha-2
  domicileCode?:       string | undefined;
  ethnicityCode?:      string | undefined;   // SPECIAL CATEGORY DATA
  emailInstitutional?: string | undefined;
  emailPersonal?:      string | undefined;
  phoneMobile?:        string | undefined;
  addresses?:          ImportAddress[] | undefined;
}
