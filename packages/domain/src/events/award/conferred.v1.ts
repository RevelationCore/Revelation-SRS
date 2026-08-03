/** Payload for srs.award.conferred v1.0.0 */
export interface AwardConferredV1Payload {
  awardId:             string;
  enrolmentId:         string;
  personId:            string;
  examBoardId?:        string;
  sourceCaseId?:       string;
  qualificationCode:   string;
  classificationCode:  string;
  awardDate:           string;
}
