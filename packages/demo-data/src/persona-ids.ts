// Stable sub-claim UUIDs for demo personas, provisioned into Keycloak in Stage 4.
// These are stored as the `persona_id` user attribute and exposed via a protocol mapper.
export const PERSONA_IDS = {
  // Students (portal journeys)
  STUDENT_STANDARD:     'persona-01-0000-4000-8000-000000000001', // alice.demo@demo.srs
  STUDENT_INTERMITTING: 'persona-01-0000-4000-8000-000000000002', // bob.demo@demo.srs
  STUDENT_GRADUATED:    'persona-01-0000-4000-8000-000000000003', // carol.demo@demo.srs
  // Staff (admin journeys)
  STAFF_REGISTRY:       'persona-02-0000-4000-8000-000000000001', // registry@demo.srs
  STAFF_EXAMBOARD:      'persona-02-0000-4000-8000-000000000002', // chair@demo.srs
  STAFF_WELLBEING:      'persona-02-0000-4000-8000-000000000003', // wellbeing@demo.srs
  STAFF_DPO:            'persona-02-0000-4000-8000-000000000004', // dpo@demo.srs
  STAFF_EXAMINER:       'persona-02-0000-4000-8000-000000000005', // examiner@demo.srs
  STAFF_OPS:            'persona-02-0000-4000-8000-000000000006', // ops@demo.srs
  // Tenant/system admin
  ADMIN_SRS:            'persona-03-0000-4000-8000-000000000001', // sysadmin@demo.srs
} as const;

export type PersonaId = typeof PERSONA_IDS[keyof typeof PERSONA_IDS];
