/** Payload for srs.enrolment.downstream-trigger-created v1.0.0 */
export interface EnrolmentDownstreamTriggerCreatedV1Payload {
  personId:         string;
  enrolmentId:      string;
  triggerId:        string;
  triggerTypeCode:  'ucas-confirmation' | 'slc-confirmation' | 'ukvi-cas';
  sourceReference?: string | undefined;
}
