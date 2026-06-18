/**
 * Canonical import contract — programme and module catalogue.
 */

export interface ImportProgramme {
  externalId:             string;
  code:                   string;
  title:                  string;
  qualificationTypeCode?: string | undefined;
  fheqLevel?:             number | undefined;
  creditTotal?:           number | undefined;
  durationYears?:         number | undefined;
  modeOfStudyCode?:       string | undefined;
  owningSchool?:          string | undefined;
  creditFrameworkCode?:   string | undefined;
}

export interface ImportModule {
  externalId:   string;
  code:         string;
  title:        string;
  creditValue?: number | undefined;
  fheqLevel?:   number | undefined;
}

export interface ImportModuleOffering {
  externalId:         string;
  moduleExternalId:   string;
  academicPeriodCode: string;    // e.g. '2024-25:sem1'
  deliveryModeCode?:  string | undefined;
  capacity?:          number | undefined;
}
