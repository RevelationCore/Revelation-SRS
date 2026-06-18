import { randomUUID } from 'node:crypto';

/** In-memory state for the stub VLE simulator. */

export interface StubCourse {
  moduleId:    string;
  vleCourseId: string;
  code:        string;
  title:       string;
  creditValue: number;
  createdAt:   string;
  updatedAt:   string;
}

export interface StubEnrolment {
  moduleRegistrationId: string;
  moduleId:             string;
  personId:             string;
  enrolmentId:          string;
  vleEnrolmentId:       string;
  statusCode:           string; // active | suspended | withdrawn | completed
  enrolledAt:           string;
  updatedAt:            string;
}

export interface StubAdjustment {
  adjustmentId:       string;
  distributionId:     string;
  personId:           string;
  enrolmentId:        string;
  adjustmentTypeCode: string;
  scopeCode:          string;
  validFrom:          string;
  validTo:            string | null;
  appliedAt:          string;
}

export interface StubMark {
  markId:               string;
  moduleRegistrationId: string;
  assessmentComponentId: string;
  rawMark:              number;
  sourceReference:      string;
  submittedAt:          string;
}

export interface StubResult {
  moduleRegistrationId: string;
  aggregateMark:        number;
  resultCode:           string;
  ratifiedAt:           string;
}

export class StubVleStore {
  courses     = new Map<string, StubCourse>();     // moduleId → course
  enrolments  = new Map<string, StubEnrolment>(); // moduleRegistrationId → enrolment
  adjustments = new Map<string, StubAdjustment>(); // distributionId → adjustment
  marks       = new Map<string, StubMark>();       // markId → mark
  results     = new Map<string, StubResult>();     // moduleRegistrationId → result

  reset(): void {
    this.courses.clear();
    this.enrolments.clear();
    this.adjustments.clear();
    this.marks.clear();
    this.results.clear();
  }

  upsertCourse(course: Omit<StubCourse, 'createdAt' | 'updatedAt'>): StubCourse {
    const now      = new Date().toISOString();
    const existing = this.courses.get(course.moduleId);
    const record: StubCourse = { ...course, createdAt: existing?.createdAt ?? now, updatedAt: now };
    this.courses.set(course.moduleId, record);
    return record;
  }

  upsertEnrolment(enrolment: Omit<StubEnrolment, 'enrolledAt' | 'updatedAt'>): StubEnrolment {
    const now      = new Date().toISOString();
    const existing = this.enrolments.get(enrolment.moduleRegistrationId);
    const record: StubEnrolment = { ...enrolment, enrolledAt: existing?.enrolledAt ?? now, updatedAt: now };
    this.enrolments.set(enrolment.moduleRegistrationId, record);
    return record;
  }

  updateEnrolmentStatus(moduleRegistrationId: string, statusCode: string): StubEnrolment | null {
    const existing = this.enrolments.get(moduleRegistrationId);
    if (!existing) return null;
    const updated = { ...existing, statusCode, updatedAt: new Date().toISOString() };
    this.enrolments.set(moduleRegistrationId, updated);
    return updated;
  }

  addAdjustment(adjustment: Omit<StubAdjustment, 'appliedAt'>): StubAdjustment {
    const record: StubAdjustment = { ...adjustment, appliedAt: new Date().toISOString() };
    this.adjustments.set(adjustment.distributionId, record);
    return record;
  }

  addMark(mark: Omit<StubMark, 'markId' | 'submittedAt'>): StubMark {
    const record: StubMark = { ...mark, markId: randomUUID(), submittedAt: new Date().toISOString() };
    this.marks.set(record.markId, record);
    return record;
  }

  setResult(result: StubResult): void {
    this.results.set(result.moduleRegistrationId, result);
  }

  enrolmentsForModule(moduleId: string): StubEnrolment[] {
    return [...this.enrolments.values()].filter(e => e.moduleId === moduleId);
  }
}
