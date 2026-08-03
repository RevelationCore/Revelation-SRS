export type LoadPhase =
  | 'reference-data'
  | 'tenant-config'
  | 'personas'
  | 'persons'
  | 'admissions'
  | 'enrolments'
  | 'registrations'
  | 'diet-groups'
  | 'assessment'
  | 'wellbeing'
  | 'regulatory'
  | 'boards'
  | 'integration'
  | 'progression'
  | 'corrections'
  | 'notifications'
  | 'pgr';

export type ScenarioClass = 'ci-only' | 'standard-demo' | 'performance-hosted';

export interface ScenarioManifest {
  slug:             string;
  name:             string;
  schemaVersion:    string;
  referenceDate:    string; // YYYY-MM-DD
  academicYears:    string[];
  targetVolumes:    Record<string, number>;
  loadTimeBudgetMs: number;
  storyMarkers:     string[];
  phases:           readonly LoadPhase[];
}

export interface ScenarioRegistryEntry {
  manifest: ScenarioManifest;
  class:    ScenarioClass;
}

export interface DemoStatusRow {
  tenantId:      string;
  scenarioSlug:  string;
  scenarioName:  string;
  schemaVersion: string;
  referenceDate: string;
  clockOffsetMs: number;
  loadedAt:      Date;
  nextResetAt:   Date | null;
}

export interface CheckpointRow {
  tenantId:    string;
  scenarioSlug: string;
  phaseName:   string;
  updatedAt:   Date;
}
