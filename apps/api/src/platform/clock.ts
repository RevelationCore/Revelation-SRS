/**
 * Demo-aware clock utility.
 *
 * All record-creation, audit-timestamp, and workflow due-date writes in the
 * API must use clockNow() rather than new Date() or Date.now() directly.
 * When a demo scenario is active (offsetMs != 0), returned timestamps are
 * shifted to the scenario's referenceDate so user-created records are
 * coherent with the pre-loaded scenario data.
 *
 * Pass offsetMs = 0 (the default) for normal, non-demo operation.
 * Pass req.demoClockOffsetMs (set by the demo status decorator) for requests
 * served within a demo tenant context.
 */
export function clockNow(offsetMs = 0): Date {
  return new Date(Date.now() + offsetMs);
}
