/**
 * VleClient — thin HTTP adapter for writing to the VLE.
 *
 * The connector only ever writes to the VLE (courses, enrolments); it never
 * reads back, so the interface is command-only.  All methods are idempotent
 * on the VLE side (upsert semantics), making them safe to retry inside a DB
 * transaction.
 */

export interface VleUpsertCourseParams {
  moduleId:    string;
  code:        string;
  title:       string;
  creditValue: number | null;
}

export interface VleUpsertEnrolmentParams {
  moduleId:             string;
  moduleRegistrationId: string;
  personId:             string;
  enrolmentId:          string;
  statusCode:           'active' | 'suspended' | 'withdrawn' | 'completed';
}

export interface VleUpdateEnrolmentStatusParams {
  moduleId:             string;
  moduleRegistrationId: string;
  statusCode:           'active' | 'suspended' | 'withdrawn' | 'completed';
}

export interface VleApplyAdjustmentParams {
  adjustmentId:       string;
  distributionId:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  validFrom:          string;
  validTo:            string | null;
}

export interface VleSetRatifiedResultParams {
  moduleRegistrationId: string;
  aggregateMark:        number;
  resultCode:           string;
  ratifiedAt:           string;
}

export interface VleClient {
  upsertCourse(params: VleUpsertCourseParams): Promise<{ vleCourseId: string }>;
  upsertEnrolment(params: VleUpsertEnrolmentParams): Promise<{ vleEnrolmentId: string }>;
  updateEnrolmentStatus(params: VleUpdateEnrolmentStatusParams): Promise<void>;
  applyAdjustment(params: VleApplyAdjustmentParams): Promise<void>;
  setRatifiedResult(params: VleSetRatifiedResultParams): Promise<void>;
}

export class VleHttpError extends Error {
  constructor(
    message:              string,
    public readonly url:  string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'VleHttpError';
  }
}

export class HttpVleClient implements VleClient {
  constructor(private readonly baseUrl: string) {}

  async upsertCourse(params: VleUpsertCourseParams): Promise<{ vleCourseId: string }> {
    const url = `${this.baseUrl}/stub/courses`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        moduleId:    params.moduleId,
        code:        params.code,
        title:       params.title,
        creditValue: params.creditValue ?? 0,
      }),
    });

    if (!res.ok && res.status !== 409) {
      throw new VleHttpError(`VLE upsertCourse failed: ${res.statusText}`, url, res.status);
    }

    const body = await res.json() as { vleCourseId: string };
    return { vleCourseId: body.vleCourseId };
  }

  async upsertEnrolment(params: VleUpsertEnrolmentParams): Promise<{ vleEnrolmentId: string }> {
    const url = `${this.baseUrl}/stub/courses/${params.moduleId}/enrolments`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        moduleRegistrationId: params.moduleRegistrationId,
        personId:             params.personId,
        enrolmentId:          params.enrolmentId,
        statusCode:           params.statusCode,
      }),
    });

    if (!res.ok && res.status !== 409) {
      throw new VleHttpError(`VLE upsertEnrolment failed: ${res.statusText}`, url, res.status);
    }

    const body = await res.json() as { vleEnrolmentId: string };
    return { vleEnrolmentId: body.vleEnrolmentId };
  }

  async updateEnrolmentStatus(params: VleUpdateEnrolmentStatusParams): Promise<void> {
    const url = `${this.baseUrl}/stub/courses/${params.moduleId}/enrolments/${params.moduleRegistrationId}`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ statusCode: params.statusCode }),
    });

    if (!res.ok) {
      throw new VleHttpError(`VLE updateEnrolmentStatus failed: ${res.statusText}`, url, res.status);
    }
  }

  async applyAdjustment(params: VleApplyAdjustmentParams): Promise<void> {
    const url = `${this.baseUrl}/stub/adjustments`;
    const res = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify(params),
    });

    if (!res.ok && res.status !== 409) {
      throw new VleHttpError(`VLE applyAdjustment failed: ${res.statusText}`, url, res.status);
    }
  }

  async setRatifiedResult(params: VleSetRatifiedResultParams): Promise<void> {
    const url = `${this.baseUrl}/stub/enrolments/${encodeURIComponent(params.moduleRegistrationId)}/result`;
    const res = await fetch(url, {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        aggregateMark: params.aggregateMark,
        resultCode:    params.resultCode,
        ratifiedAt:    params.ratifiedAt,
      }),
    });

    if (!res.ok) {
      const err = new VleHttpError(
        `VLE setRatifiedResult failed: ${res.statusText}`,
        url,
        res.status,
      );
      throw err;
    }
  }
}
