/** Payload for srs.assessment.mark-updated v1.0.0 */
export interface AssessmentMarkUpdatedV1Payload {
    markId: string;
    moduleRegistrationId: string;
    previousMark: number;
    newMark: number;
    reason?: string;
    actorId: string;
}
//# sourceMappingURL=mark-updated.v1.d.ts.map