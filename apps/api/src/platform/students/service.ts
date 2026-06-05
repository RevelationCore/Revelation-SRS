import { randomUUID } from 'node:crypto';

import { and, eq, isNull, sql } from 'drizzle-orm';
import {
  disabilityDeclarations,
  identityVerificationChecks,
  personIdentities,
  persons,
  studentAddresses,
  type Db,
  withTenantContext,
} from '@revelation-srs/db';
import { NotFoundError, ValidationError } from '@revelation-srs/domain';

import type { ValueSetService } from '../value-sets/service.js';

// ── Input / output types ─────────────────────────────────────────────────────

export interface CreatePersonInput {
  legalFirstName:   string;
  legalFamilyName:  string;
  preferredName?:   string;
  dateOfBirth?:     string;  // ISO date 'YYYY-MM-DD'
  genderCode?:      string;
  nationalityCode?: string;
  domicileCode?:    string;
  emailInstitutional?: string;
  emailPersonal?:   string;
  phoneMobile?:     string;
  sourceSystem?:    string;
  sourceReference?: string;
}

export interface PersonIdentityPatch {
  legalFirstName?:  string;
  legalFamilyName?: string;
  preferredName?:   string;
  dateOfBirth?:     string;
  genderCode?:      string;
  nationalityCode?: string;
  domicileCode?:    string;
  emailInstitutional?: string;
  emailPersonal?:   string;
  phoneMobile?:     string;
}

export interface AddressInput {
  addressTypeCode: string;
  line1:           string;
  line2?:          string;
  city?:           string;
  postcode?:       string;
  countryCode?:    string;
  validFrom?:      Date;
}

export interface DisabilityDeclarationInput {
  disabilityCategoryCode: string;
  declarationStatusCode?: string;
}

export interface IdentityVerificationRequestInput {
  providerReference?: string;
}

export interface IdentityVerificationCompletionInput {
  statusCode:         'verified' | 'failed' | 'fraud-flagged';
  confidenceScore?:   number;
  fraudFlag?:         boolean;
  providerReference?: string;
  completedAt?:       Date;
}

export interface PersonDto {
  personId:       string;
  studentNumber:  string;
  hesaId:         string | null;
  personStatusCode: string;
  sourceSystem:   string | null;
  createdAt:      Date;
  identity:       PersonIdentityDto | null;
}

export interface PersonIdentityDto {
  versionId:          string;
  legalFirstName:     string;
  legalFamilyName:    string;
  preferredName:      string | null;
  dateOfBirth:        string | null;
  genderCode:         string | null;
  nationalityCode:    string | null;
  domicileCode:       string | null;
  emailInstitutional: string | null;
  emailPersonal:      string | null;
  phoneMobile:        string | null;
  validFrom:          Date;
  recordedAt:         Date;
}

export interface PersonSummaryDto {
  personId:      string;
  studentNumber: string;
  legalFirstName: string;
  legalFamilyName: string;
}

export interface DisabilityDeclarationDto {
  declarationId:          string;
  disabilityCategoryCode: string;
  declarationStatusCode:  string;
  declaredAt:             Date;
  validFrom:              Date;
}

export interface IdentityVerificationCheckDto {
  verificationCheckId: string;
  statusCode:          string;
  confidenceScore:     number | null;
  fraudFlag:           boolean;
  providerReference:   string | null;
  requestedAt:         Date;
  completedAt:         Date | null;
  validFrom:           Date;
  recordedAt:          Date;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class StudentService {
  constructor(
    private readonly db: Db,
    private readonly valueSets: ValueSetService,
  ) {}

  async #validateFieldValue(
    tenantId:   string,
    entityName: string,
    fieldName:  string,
    value:      string | null | undefined,
  ): Promise<void> {
    if (value === undefined || value === null || value === '') return;

    const isValid = await this.valueSets.validateFieldValue(entityName, fieldName, value, tenantId);
    if (isValid === false) {
      throw new ValidationError(
        `Invalid value '${value}' for ${entityName}.${fieldName}`,
        [{ field: fieldName, message: `Value '${value}' is not active in the configured value set` }],
      );
    }
  }

  async #ensurePersonExists(personId: string, tenantId: string): Promise<void> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select({ id: persons.id })
        .from(persons)
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1),
    );

    if (rows.length === 0) {
      throw new NotFoundError('Person', personId);
    }
  }

  /**
   * Create a new person record with an initial person_identity version.
   * Uses the platform student_number_seq for institution-assigned number.
   */
  async createPerson(
    tenantId: string,
    input: CreatePersonInput,
  ): Promise<{ personId: string; studentNumber: string }> {
    await this.#validateFieldValue(tenantId, 'person_identity', 'gender_code', input.genderCode);
    await this.#validateFieldValue(tenantId, 'person_identity', 'nationality_code', input.nationalityCode);
    await this.#validateFieldValue(tenantId, 'person_identity', 'domicile_code', input.domicileCode);

    return withTenantContext(this.db, tenantId, async (tx) => {
      const sequenceRows = await tx.execute(
        sql`SELECT nextval('student_number_seq') AS nextval`,
      ) as unknown as Array<{ nextval: string }>;
      const sequenceRow = sequenceRows[0];
      if (!sequenceRow) {
        throw new Error('Student number sequence did not return a value');
      }

      const studentNumber = String(sequenceRow.nextval);
      const personId      = randomUUID();
      const identityId    = randomUUID();
      const now           = new Date();

      await tx.insert(persons).values({
        id:              personId,
        tenantId:        tenantId as `${string}-${string}-${string}-${string}-${string}`,
        studentNumber,
        personStatusCode: 'prospective',
        sourceSystem:    input.sourceSystem ?? null,
        sourceReference: input.sourceReference ?? null,
      });

      await tx.insert(personIdentities).values({
        versionId:          randomUUID(),
        id:                 identityId,
        tenantId:           tenantId as `${string}-${string}-${string}-${string}-${string}`,
        personId:           personId,
        legalFirstName:     input.legalFirstName,
        legalFamilyName:    input.legalFamilyName,
        preferredName:      input.preferredName ?? null,
        dateOfBirth:        input.dateOfBirth ?? null,
        genderCode:         input.genderCode ?? null,
        nationalityCode:    input.nationalityCode ?? null,
        domicileCode:       input.domicileCode ?? null,
        ethnicityCode:      null,
        emailInstitutional: input.emailInstitutional ?? null,
        emailPersonal:      input.emailPersonal ?? null,
        phoneMobile:        input.phoneMobile ?? null,
        validFrom:          now,
        validTo:            null,
        recordedAt:         now,
        recordedUntil:      null,
      });

      return { personId, studentNumber };
    });
  }

  /**
   * Retrieve a person with their current identity snapshot.
   */
  async getPerson(personId: string, tenantId: string): Promise<PersonDto | null> {
    const results = await withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(persons)
        .leftJoin(
          personIdentities,
          and(
            eq(personIdentities.personId, persons.id),
            isNull(personIdentities.recordedUntil),
          ),
        )
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .limit(1);
    });

    if (results.length === 0) return null;
    const row = results[0]!;

    return {
      personId:        row.person.id,
      studentNumber:   row.person.studentNumber,
      hesaId:          row.person.hesaId,
      personStatusCode: row.person.personStatusCode,
      sourceSystem:    row.person.sourceSystem,
      createdAt:       row.person.createdAt,
      identity: row.person_identity ? {
        versionId:          row.person_identity.versionId,
        legalFirstName:     row.person_identity.legalFirstName,
        legalFamilyName:    row.person_identity.legalFamilyName,
        preferredName:      row.person_identity.preferredName,
        dateOfBirth:        row.person_identity.dateOfBirth,
        genderCode:         row.person_identity.genderCode,
        nationalityCode:    row.person_identity.nationalityCode,
        domicileCode:       row.person_identity.domicileCode,
        emailInstitutional: row.person_identity.emailInstitutional,
        emailPersonal:      row.person_identity.emailPersonal,
        phoneMobile:        row.person_identity.phoneMobile,
        validFrom:          row.person_identity.validFrom,
        recordedAt:         row.person_identity.recordedAt,
      } : null,
    };
  }

  /**
   * List person summaries for a tenant (paginated).
   */
  async listPersons(
    tenantId: string,
    opts: { limit?: number; offset?: number } = {},
  ): Promise<PersonSummaryDto[]> {
    const limit  = opts.limit  ?? 20;
    const offset = opts.offset ?? 0;

    const rows = await withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select({
          personId:       persons.id,
          studentNumber:  persons.studentNumber,
          legalFirstName:  personIdentities.legalFirstName,
          legalFamilyName: personIdentities.legalFamilyName,
        })
        .from(persons)
        .leftJoin(
          personIdentities,
          and(
            eq(personIdentities.personId, persons.id),
            isNull(personIdentities.recordedUntil),
          ),
        )
        .where(eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`))
        .limit(limit)
        .offset(offset);
    });

    return rows.map((r) => ({
      personId:       r.personId,
      studentNumber:  r.studentNumber,
      legalFirstName:  r.legalFirstName  ?? '',
      legalFamilyName: r.legalFamilyName ?? '',
    }));
  }

  /**
   * Update personal identity by closing the current version and inserting
   * a new bitemporal record with patched fields.
   */
  async updatePersonIdentity(
    personId: string,
    tenantId: string,
    patch: PersonIdentityPatch,
    validFrom: Date = new Date(),
  ): Promise<void> {
    await this.#validateFieldValue(tenantId, 'person_identity', 'gender_code', patch.genderCode);
    await this.#validateFieldValue(tenantId, 'person_identity', 'nationality_code', patch.nationalityCode);
    await this.#validateFieldValue(tenantId, 'person_identity', 'domicile_code', patch.domicileCode);

    await withTenantContext(this.db, tenantId, async (tx) => {
      // Find current identity version
      const current = await tx
        .select()
        .from(personIdentities)
        .where(
          and(
            eq(personIdentities.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(personIdentities.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(personIdentities.recordedUntil),
          ),
        )
        .limit(1);

      if (current.length === 0) {
        throw new NotFoundError('PersonIdentity', personId);
      }

      const existing = current[0]!;
      const now = new Date();

      // Close current version (both record-time and valid-time axes)
      await tx
        .update(personIdentities)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(eq(personIdentities.versionId, existing.versionId));

      // Insert new version
      await tx.insert(personIdentities).values({
        versionId:          randomUUID(),
        id:                 existing.id,
        tenantId:           existing.tenantId,
        personId:           existing.personId,
        legalFirstName:     patch.legalFirstName  ?? existing.legalFirstName,
        legalFamilyName:    patch.legalFamilyName ?? existing.legalFamilyName,
        preferredName:      patch.preferredName   ?? existing.preferredName,
        dateOfBirth:        patch.dateOfBirth     ?? existing.dateOfBirth,
        genderCode:         patch.genderCode      ?? existing.genderCode,
        nationalityCode:    patch.nationalityCode ?? existing.nationalityCode,
        domicileCode:       patch.domicileCode    ?? existing.domicileCode,
        ethnicityCode:      existing.ethnicityCode,
        emailInstitutional: patch.emailInstitutional ?? existing.emailInstitutional,
        emailPersonal:      patch.emailPersonal      ?? existing.emailPersonal,
        phoneMobile:        patch.phoneMobile         ?? existing.phoneMobile,
        validFrom,
        validTo:        null,
        recordedAt:     now,
        recordedUntil:  null,
      });
    });
  }

  /**
   * Return all identity versions for a person, ordered by recorded_at.
   */
  async getIdentityHistory(personId: string, tenantId: string): Promise<PersonIdentityDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(personIdentities)
        .where(
          and(
            eq(personIdentities.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(personIdentities.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        )
        .orderBy(personIdentities.recordedAt);
    });

    return rows.map((r) => ({
      versionId:          r.versionId,
      legalFirstName:     r.legalFirstName,
      legalFamilyName:    r.legalFamilyName,
      preferredName:      r.preferredName,
      dateOfBirth:        r.dateOfBirth,
      genderCode:         r.genderCode,
      nationalityCode:    r.nationalityCode,
      domicileCode:       r.domicileCode,
      emailInstitutional: r.emailInstitutional,
      emailPersonal:      r.emailPersonal,
      phoneMobile:        r.phoneMobile,
      validFrom:          r.validFrom,
      recordedAt:         r.recordedAt,
    }));
  }

  /**
   * Add or update an address.  Closes the existing current address of the
   * same type (if any) before inserting the new version.
   */
  async addAddress(
    personId: string,
    tenantId: string,
    input: AddressInput,
  ): Promise<string> {
    await this.#validateFieldValue(tenantId, 'student_address', 'address_type_code', input.addressTypeCode);
    await this.#ensurePersonExists(personId, tenantId);

    return withTenantContext(this.db, tenantId, async (tx) => {
      const now      = new Date();
      const validFrom = input.validFrom ?? now;

      // Close any existing current address of this type
      await tx
        .update(studentAddresses)
        .set({ recordedUntil: now, validTo: validFrom })
        .where(
          and(
            eq(studentAddresses.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(studentAddresses.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            eq(studentAddresses.addressTypeCode, input.addressTypeCode),
            isNull(studentAddresses.recordedUntil),
          ),
        );

      const addressId = randomUUID();

      await tx.insert(studentAddresses).values({
        versionId:       randomUUID(),
        id:              addressId,
        tenantId:        tenantId as `${string}-${string}-${string}-${string}-${string}`,
        personId:        personId as `${string}-${string}-${string}-${string}-${string}`,
        addressTypeCode: input.addressTypeCode,
        line1:           input.line1,
        line2:           input.line2 ?? null,
        city:            input.city  ?? null,
        postcode:        input.postcode    ?? null,
        countryCode:     input.countryCode ?? null,
        validFrom,
        validTo:       null,
        recordedAt:    now,
        recordedUntil: null,
      });

      return addressId;
    });
  }

  /**
   * List current addresses for a person.
   */
  async listAddresses(personId: string, tenantId: string) {
    return withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(studentAddresses)
        .where(
          and(
            eq(studentAddresses.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(studentAddresses.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(studentAddresses.recordedUntil),
          ),
        );
    });
  }

  /**
   * Add a disability declaration.  Each declaration is a new bitemporal record.
   * Returns the logical declaration id.
   */
  async addDisabilityDeclaration(
    personId: string,
    tenantId: string,
    input: DisabilityDeclarationInput,
  ): Promise<string> {
    await this.#validateFieldValue(tenantId, 'disability_declaration', 'disability_category_code', input.disabilityCategoryCode);
    await this.#validateFieldValue(tenantId, 'disability_declaration', 'declaration_status_code', input.declarationStatusCode ?? 'declared');
    await this.#ensurePersonExists(personId, tenantId);

    return withTenantContext(this.db, tenantId, async (tx) => {
      const now           = new Date();
      const declarationId = randomUUID();

      await tx.insert(disabilityDeclarations).values({
        versionId:              randomUUID(),
        id:                     declarationId,
        tenantId:               tenantId as `${string}-${string}-${string}-${string}-${string}`,
        personId:               personId as `${string}-${string}-${string}-${string}-${string}`,
        disabilityCategoryCode: input.disabilityCategoryCode,
        declarationStatusCode:  input.declarationStatusCode ?? 'declared',
        declaredAt:             now,
        validFrom:              now,
        validTo:                null,
        recordedAt:             now,
        recordedUntil:          null,
      });

      return declarationId;
    });
  }

  /**
   * List current disability declarations for a person.
   */
  async listDisabilityDeclarations(
    personId: string,
    tenantId: string,
  ): Promise<DisabilityDeclarationDto[]> {
    const rows = await withTenantContext(this.db, tenantId, async (tx) => {
      return tx
        .select()
        .from(disabilityDeclarations)
        .where(
          and(
            eq(disabilityDeclarations.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(disabilityDeclarations.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(disabilityDeclarations.recordedUntil),
          ),
        );
    });

    return rows.map((r) => ({
      declarationId:          r.id,
      disabilityCategoryCode: r.disabilityCategoryCode,
      declarationStatusCode:  r.declarationStatusCode,
      declaredAt:             r.declaredAt,
      validFrom:              r.validFrom,
    }));
  }

  async updateHesaId(personId: string, tenantId: string, hesaId: string): Promise<void> {
    await this.#ensurePersonExists(personId, tenantId);

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(persons)
        .set({ hesaId })
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        );
    });
  }

  async requestIdentityVerification(
    personId: string,
    tenantId: string,
    input: IdentityVerificationRequestInput = {},
  ): Promise<string> {
    await this.#ensurePersonExists(personId, tenantId);

    return withTenantContext(this.db, tenantId, async (tx) => {
      const now = new Date();
      const verificationCheckId = randomUUID();

      await tx.insert(identityVerificationChecks).values({
        versionId:         randomUUID(),
        id:                verificationCheckId,
        tenantId:          tenantId as `${string}-${string}-${string}-${string}-${string}`,
        personId:          personId as `${string}-${string}-${string}-${string}-${string}`,
        statusCode:        'requested',
        confidenceScore:   null,
        fraudFlag:         false,
        providerReference: input.providerReference ?? null,
        requestedAt:       now,
        completedAt:       null,
        validFrom:         now,
        validTo:           null,
        recordedAt:        now,
        recordedUntil:     null,
      });

      return verificationCheckId;
    });
  }

  async completeIdentityVerification(
    personId: string,
    tenantId: string,
    verificationCheckId: string,
    input: IdentityVerificationCompletionInput,
  ): Promise<void> {
    const currentRows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(identityVerificationChecks)
        .where(
          and(
            eq(identityVerificationChecks.id, verificationCheckId as `${string}-${string}-${string}-${string}-${string}`),
            eq(identityVerificationChecks.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(identityVerificationChecks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(identityVerificationChecks.recordedUntil),
          ),
        )
        .limit(1),
    );

    const current = currentRows[0];
    if (!current) {
      throw new NotFoundError('IdentityVerificationCheck', verificationCheckId);
    }
    if (current.statusCode !== 'requested') {
      throw new ValidationError(`Identity verification check '${verificationCheckId}' has already been completed`);
    }

    const now = new Date();
    const completedAt = input.completedAt ?? now;

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(identityVerificationChecks)
        .set({ recordedUntil: now, validTo: completedAt })
        .where(eq(identityVerificationChecks.versionId, current.versionId));

      await tx.insert(identityVerificationChecks).values({
        versionId:         randomUUID(),
        id:                current.id,
        tenantId:          current.tenantId,
        personId:          current.personId,
        statusCode:        input.statusCode,
        confidenceScore:   input.confidenceScore ?? current.confidenceScore,
        fraudFlag:         input.fraudFlag ?? input.statusCode === 'fraud-flagged',
        providerReference: input.providerReference ?? current.providerReference,
        requestedAt:       current.requestedAt,
        completedAt,
        validFrom:         completedAt,
        validTo:           null,
        recordedAt:        now,
        recordedUntil:     null,
      });
    });
  }

  async updatePersonStatus(
    personId: string,
    tenantId: string,
    statusCode: 'prospective' | 'student' | 'alumnus' | 'deceased' | 'merged',
  ): Promise<void> {
    await this.#ensurePersonExists(personId, tenantId);

    await withTenantContext(this.db, tenantId, async (tx) => {
      await tx
        .update(persons)
        .set({ personStatusCode: statusCode })
        .where(
          and(
            eq(persons.id, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(persons.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
          ),
        );
    });
  }

  async listIdentityVerificationChecks(
    personId: string,
    tenantId: string,
  ): Promise<IdentityVerificationCheckDto[]> {
    await this.#ensurePersonExists(personId, tenantId);

    const rows = await withTenantContext(this.db, tenantId, async (tx) =>
      tx
        .select()
        .from(identityVerificationChecks)
        .where(
          and(
            eq(identityVerificationChecks.personId, personId as `${string}-${string}-${string}-${string}-${string}`),
            eq(identityVerificationChecks.tenantId, tenantId as `${string}-${string}-${string}-${string}-${string}`),
            isNull(identityVerificationChecks.recordedUntil),
          ),
        ),
    );

    return rows.map((r) => ({
      verificationCheckId: r.id,
      statusCode:          r.statusCode,
      confidenceScore:     r.confidenceScore,
      fraudFlag:           r.fraudFlag,
      providerReference:   r.providerReference,
      requestedAt:         r.requestedAt,
      completedAt:         r.completedAt,
      validFrom:           r.validFrom,
      recordedAt:          r.recordedAt,
    }));
  }
}
