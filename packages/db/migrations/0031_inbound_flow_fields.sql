-- 0031 — Picklists for the remaining per-student inbound flows
--
-- F-PAY-SIS-01 (bursary and stipend payments), F-RP-SIS-01 (funded
-- studentship awards) and F-ITSM-SIS-01 (service request outcomes) are now
-- recordable as external_record rows; their status fields are value-set
-- backed. Inbound flows that are not about one student (estates rooms,
-- survey aggregates, policy notices) or that have a dedicated route
-- (identity verification completion, admissions, catalogue) are not stored
-- here.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('payment-type-code', 'Student Payment Type', 'srs-internal', NULL, 'Kind of payment a payroll or finance system reports to a student', true),
  ('studentship-status-code', 'Studentship Award Status', 'srs-internal', NULL, 'Status of a funded research studentship award', true),
  ('service-request-outcome-code', 'Service Request Outcome', 'srs-internal', NULL, 'Outcome of an IT service request affecting a student account', true)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order", "active_from")
SELECT vs."id", v.code, v.display_label, v.sort_order, '2000-01-01T00:00:00Z'
FROM "value_set" vs,
(VALUES
  ('payment-type-code', 'bursary',  'Bursary',  10),
  ('payment-type-code', 'stipend',  'Stipend',  20),
  ('payment-type-code', 'gta-pay',  'Graduate teaching assistant pay', 30),
  ('studentship-status-code', 'offered',   'Offered',   10),
  ('studentship-status-code', 'accepted',  'Accepted',  20),
  ('studentship-status-code', 'active',    'Active',    30),
  ('studentship-status-code', 'suspended', 'Suspended', 40),
  ('studentship-status-code', 'ended',     'Ended',     50),
  ('service-request-outcome-code', 'resolved',         'Resolved',         10),
  ('service-request-outcome-code', 'account-locked',   'Account locked',   20),
  ('service-request-outcome-code', 'account-unlocked', 'Account unlocked', 30),
  ('service-request-outcome-code', 'access-granted',   'Access granted',   40),
  ('service-request-outcome-code', 'access-removed',   'Access removed',   50)
) AS v(set_code, code, display_label, sort_order)
WHERE vs."set_code" = v.set_code
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('external_record_payroll', 'payment_type', 'payment-type-code', 'F-PAY-SIS-01'),
  ('external_record_research', 'award_status', 'studentship-status-code', 'F-RP-SIS-01'),
  ('external_record_itsm', 'outcome', 'service-request-outcome-code', 'F-ITSM-SIS-01')
ON CONFLICT DO NOTHING;
