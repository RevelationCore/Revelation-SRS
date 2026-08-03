export const STORY_MARKERS = {
  // S0 CI Golden Dataset — one marker per enrolment state-machine state
  S0_STANDARD_ENROLLED:  'S0:standard-enrolled',
  S0_INTERMITTING:       'S0:intermitting',
  S0_WITHDRAWN:          'S0:withdrawn',
  S0_GRADUATED:          'S0:graduated',

  // S1 Applicant Pipeline — key personas in the admissions funnel
  S1_ALICE_APPLICANT:    'S1:alice-applicant',   // UCAS, conditional offer received
  S1_BOB_APPLICANT:      'S1:bob-applicant',     // Direct applicant, decision pending
  S1_CAROL_APPLICANT:    'S1:carol-applicant',   // International applicant, conditional offer

  // S2 Enrolment Induction — key personas at enrolment
  S2_ALICE_ENROLLED:     'S2:alice-enrolled',    // Standard full-time enrolled student
  S2_BOB_INTERMITTING:   'S2:bob-intermitting',  // Intermitting; wellbeing case in progress
  S2_CAROL_GRADUATED:    'S2:carol-graduated',   // Graduated; transcript visible in portal

  // S3 Module Selection — key personas during registration window
  S3_ALICE_REGISTERED:   'S3:alice-registered',  // All modules confirmed, exam entries created
  S3_BOB_WAITLISTED:     'S3:bob-waitlisted',    // One module waitlisted (capacity constrained)
  S3_CAROL_OVERRIDE:     'S3:carol-override',    // One module on staff override (pre-req waived)

  // S4 Assessment Marks — key personas during marking and wellbeing
  S4_ALICE_MARKED:       'S4:alice-marked',      // All marks submitted, module result calculated
  S4_BOB_EC_CLAIM:       'S4:bob-ec-claim',      // EC claim submitted and upheld; deferred result
  S4_CAROL_ADJUSTMENT:   'S4:carol-adjustment',  // Disability declaration; DSA + reasonable adjustment

  // S5 Exam Board — key personas through board ratification and outcomes
  S5_ALICE_PROGRESSED:   'S5:alice-progressed',  // Progression decision: progress to year 2
  S5_BOB_RESIT:          'S5:bob-resit',          // Progression decision: resit (EC-deferred module result)
  S5_CAROL_PROFILE:      'S5:carol-profile',      // Candidate profile carries adjustment flag

  // S6 Full-Institution Year — six lifecycle archetypes traceable across the full record
  S6_ALEX_STANDARD:      'S6:alex-standard',      // Standard full-time, year 1, 2025/26 entrant
  S6_BEN_INTERCALATED:   'S6:ben-intercalated',   // Intercalated: entered 2022/23, back in year 3 (2025/26)
  S6_CARA_INTERNATIONAL: 'S6:cara-international', // International student with CAS lifecycle
  S6_DAN_WELLBEING:      'S6:dan-wellbeing',      // Wellbeing-supported: disability declaration + active adjustment
  S6_EVA_RESIT:          'S6:eva-resit',          // Resit path: failed module, re-boarded in 2023/24
  S6_FIN_GRADUATED:      'S6:fin-graduated',      // Graduated with first-class distinction, full arc

  // S7 PGR Lifecycle — postgraduate research students across the full BP-03-007–BP-06-006 arc
  S7_PRIYA_SUPERVISION:  'S7:priya-supervision',  // Approved supervisory team, no review/examination yet
  S7_JORDAN_MILESTONE:   'S7:jordan-milestone',   // Satisfactory annual review; confirmation-of-registration published
  S7_AVERY_AWARDED:      'S7:avery-awarded',      // Full lifecycle: ratified pass, completed, research award conferred
} as const;

export type StoryMarker = typeof STORY_MARKERS[keyof typeof STORY_MARKERS];
