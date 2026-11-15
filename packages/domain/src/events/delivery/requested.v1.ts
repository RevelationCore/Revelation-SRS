/**
 * Payload for srs.delivery.requested v1.0.0
 *
 * An instruction to ONE adjacent system for an outbound reference-model flow
 * (e.g. F-SIS-LIB-01: enrolment status and access rights to the library),
 * published once per delivery_item whose flow is 'connected'. The NATS
 * subject carries the flow as a final token
 * (srs.delivery.requested.f-sis-lib-01) so each connector subscribes to, and
 * is authorised for, only its own flows; the envelope type omits it.
 *
 * At-least-once, with a stable envelope id per item; consumers must be
 * idempotent on deliveryItemId and reply through the SRS API (acknowledge,
 * or report a failure). For state-sync flows a later item for the same
 * subject supersedes an undelivered earlier one: apply the latest.
 */
export interface DeliveryRequestedV1Payload {
  deliveryItemId: string;
  flowCode:       string;
  targetSystem:   string;
  subjectType:    string;
  subjectId:      string;
  personId?:      string;
  /** Flow-specific minimal data; see the flow's contract. */
  payload:        Record<string, unknown>;
  requestedAt:    string;
}
