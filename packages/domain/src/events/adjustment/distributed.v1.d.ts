/** Payload for srs.adjustment.distributed v1.0.0 */
export interface AdjustmentDistributedV1Payload {
    adjustmentId: string;
    distributionId: string;
    targetSystem: string;
    distributedAt: string;
    personId: string;
    enrolmentId: string;
    adjustmentTypeCode: string;
    scopeCode: string;
    validFrom: string;
    validTo?: string;
}
//# sourceMappingURL=distributed.v1.d.ts.map