export type IssueSeverity = 'error' | 'warning' | 'info';
export type IssueCode =
  | 'MISSING_REQUIRED_FIELD'
  | 'UNRESOLVED_REFERENCE'
  | 'DUPLICATE_EXTERNAL_ID'
  | 'VALUE_SET_MAPPING_FAILURE'
  | 'BITEMPORAL_OVERLAP'
  | 'BITEMPORAL_INVALID_WINDOW'
  | 'SPECIAL_CATEGORY_DATA'
  | 'RECORD_COUNT_MISMATCH'
  | 'REFERENTIAL_INTEGRITY_FAILURE';

export interface ValidationIssue {
  code:       IssueCode;
  severity:   IssueSeverity;
  entity:     string;        // 'person' | 'enrolment' | 'programme' | ...
  externalId?: string;
  field?:     string;
  message:    string;
}

export interface RecordCounts {
  entity:  string;
  source:  number;
  loaded:  number;
  failed:  number;
}

export interface ValidationReport {
  timestamp:   string;
  tenantId:    string;
  sourceSystem: string;
  dryRun:      boolean;
  recordCounts: RecordCounts[];
  issues:      ValidationIssue[];
  summary: {
    hasErrors:    boolean;
    errorCount:   number;
    warningCount: number;
    infoCount:    number;
  };
}
