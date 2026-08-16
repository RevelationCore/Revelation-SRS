-- Revelation SRS — Partner Systems Sandbox foundation
-- Migration: 0019_partner_systems_contracts
--
-- Seeds the 19 integration contracts (of the 20 already fully specified in
-- docs/architecture/integration-contract-catalogue.md) for the 10 reference-model
-- systems that previously had zero code and zero backlog entry anywhere in the
-- project: CRM, Library, Accommodation, Estates, Online ID Verification (OIV),
-- Student Evaluation of Teaching Software (SETS), Payroll, Research Proposals
-- (RP), Content Management Systems (CMS), IT Service Management (ITSM).
--
-- research-proposal-eligibility.v1 already exists (seeded in 0014_pgr_foundation
-- for the PGR lifecycle build) and is deliberately not touched here.
--
-- These contracts are exercised by apps/partner-systems-sandbox, a standalone
-- demo app that simulates both directions of each system's integration against
-- SRS's real integration registry/exchange surface. It is explicitly a
-- placeholder — see the sandbox's own README — intended to be replaced by a
-- genuine system integration without requiring any change to these contract
-- rows.

INSERT INTO "integration_contract" ("contract_id", "display_name", "owner_module_code", "direction_code", "pattern_type", "current_contract_version", "data_classification_code")
VALUES
  ('crm-admissions-feed.v1',              'CRM Admissions Feed',                'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'personal'),
  ('crm-student-lifecycle-updates.v1',    'CRM Student Lifecycle Updates',      'partner-systems', 'outbound', 'event-driven', '1.0.0', 'personal'),
  ('library-obligations.v1',              'Library Obligations',                'partner-systems', 'inbound',  'api',          '1.0.0', 'sensitive'),
  ('library-access-entitlement.v1',       'Library Access Entitlement',         'partner-systems', 'outbound', 'event-driven', '1.0.0', 'personal'),
  ('accommodation-eligibility.v1',        'Accommodation Eligibility',          'partner-systems', 'outbound', 'event-and-file', '1.0.0', 'personal'),
  ('accommodation-booking-status.v1',     'Accommodation Booking Status',       'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'personal'),
  ('estates-occupancy-forecast.v1',       'Estates Occupancy Forecast',         'partner-systems', 'outbound', 'event-and-file', '1.0.0', 'aggregate'),
  ('estates-room-availability.v1',        'Estates Room Availability',          'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'standard'),
  ('identity-verification-request.v1',    'Identity Verification Request',      'partner-systems', 'outbound', 'api',          '1.0.0', 'sensitive'),
  ('identity-verification-outcome.v1',    'Identity Verification Outcome',      'partner-systems', 'inbound',  'api',          '1.0.0', 'sensitive'),
  ('sets-survey-roster.v1',               'SETS Survey Roster',                 'partner-systems', 'outbound', 'api-and-file', '1.0.0', 'personal'),
  ('sets-survey-summary.v1',              'SETS Survey Summary',                'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'aggregate'),
  ('payroll-student-pay-authorisation.v1','Payroll Student Pay Authorisation',  'partner-systems', 'outbound', 'api-and-file', '1.0.0', 'sensitive'),
  ('payroll-payment-confirmation.v1',     'Payroll Payment Confirmation',       'partner-systems', 'inbound',  'api-and-file', '1.0.0', 'sensitive'),
  ('research-studentship-award.v1',       'Research Studentship Award',         'partner-systems', 'inbound',  'api',          '1.0.0', 'sensitive'),
  ('cms-cohort-personalisation.v1',       'CMS Cohort Personalisation',         'partner-systems', 'outbound', 'api-and-event', '1.0.0', 'personal'),
  ('cms-policy-publication.v1',           'CMS Policy Publication',             'partner-systems', 'inbound',  'api-and-event', '1.0.0', 'regulatory'),
  ('itsm-student-context.v1',             'ITSM Student Context',               'partner-systems', 'outbound', 'api',          '1.0.0', 'sensitive'),
  ('itsm-account-impact.v1',              'ITSM Account Impact',                'partner-systems', 'inbound',  'api-and-event', '1.0.0', 'sensitive')
ON CONFLICT ("contract_id") DO NOTHING;
