-- Revelation SRS — Phase 6 Value Sets and Field Mappings
-- Migration: 0007_seed_phase6_field_mappings
--
-- Adds new value sets and field mappings for regulatory compliance,
-- statutory reporting, FOI, UKVI, SLC, UCAS, and exam scheduling exchange.

INSERT INTO "value_set" ("set_code", "display_name", "source", "source_version", "description", "is_extensible")
VALUES
  ('ucas-application-status-code', 'UCAS Application Status',       'srs-internal', NULL, 'Lifecycle status for staged UCAS applications',                false),
  ('hesa-return-status-code',      'HESA Return Status',            'srs-internal', NULL, 'Lifecycle status for HESA student returns',                    false),
  ('hesa-validation-severity-code','HESA Validation Severity',      'srs-internal', NULL, 'Severity for HESA validation report issues',                  false),
  ('slc-notification-type-code',   'SLC Notification Type',         'srs-internal', NULL, 'Inbound Student Loans Company notification types',             false),
  ('cas-status-code',              'UKVI CAS Status',               'srs-internal', NULL, 'Lifecycle status for UKVI CAS requests',                       false),
  ('ukvi-visa-status-code',        'UKVI Visa Status',              'srs-internal', NULL, 'Inbound UKVI visa status outcomes',                            false),
  ('ukvi-alert-type-code',         'UKVI Compliance Alert Type',    'srs-internal', NULL, 'Compliance alert categories for sponsored students',           false),
  ('ofs-extract-type-code',        'OfS Extract Type',              'srs-internal', NULL, 'OfS and regulatory extract categories',                        false),
  ('regulatory-report-status-code','Regulatory Report Status',      'srs-internal', NULL, 'Lifecycle status for generated regulatory report artefacts',   false),
  ('foi-request-status-code',      'FOI Request Status',            'srs-internal', NULL, 'Freedom of Information request workflow status',               false),
  ('exam-entry-status-code',       'Exam Entry Status',             'srs-internal', NULL, 'Exam scheduling entry lifecycle status',                       false)
ON CONFLICT ("set_code") DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('received',       'Received',       10),
  ('offer-made',     'Offer Made',     20),
  ('offer-accepted', 'Offer Accepted', 30),
  ('confirmed',      'Confirmed',      40),
  ('deferred',       'Deferred',       50),
  ('withdrawn',      'Withdrawn',      60),
  ('not-registered', 'Not Registered', 70),
  ('clearing',       'Clearing',       80)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ucas-application-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('draft',                      'Draft',                      10),
  ('validated',                  'Validated',                  20),
  ('submitted',                  'Submitted',                  30),
  ('validation-report-received', 'Validation Report Received', 40),
  ('amendment-required',         'Amendment Required',         50),
  ('final',                      'Final',                      60)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-return-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('error',   'Error',   10),
  ('warning', 'Warning', 20)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'hesa-validation-severity-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('entitlement-confirmed', 'Entitlement Confirmed', 10),
  ('payment-received',      'Payment Received',      20),
  ('overpayment-notified',  'Overpayment Notified',  30),
  ('recovery-initiated',    'Recovery Initiated',    40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'slc-notification-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pending',   'Pending',   10),
  ('assigned',  'Assigned',  20),
  ('used',      'Used',      30),
  ('withdrawn', 'Withdrawn', 40),
  ('expired',   'Expired',   50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'cas-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('granted',        'Granted',        10),
  ('refused',        'Refused',        20),
  ('curtailed',      'Curtailed',      30),
  ('expired',        'Expired',        40),
  ('lapse-of-leave', 'Lapse of Leave', 50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ukvi-visa-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('attendance-threshold-breach', 'Attendance Threshold Breach', 10),
  ('visa-curtailed',              'Visa Curtailed',              20),
  ('sponsor-compliance-breach',   'Sponsor Compliance Breach',   30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ukvi-alert-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('b3-student-outcomes',          'B3 Student Outcomes',          10),
  ('access-participation-progress','Access Participation Progress',20),
  ('prevent-duty',                 'Prevent Duty',                 30)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'ofs-extract-type-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('draft',     'Draft',     10),
  ('generated', 'Generated', 20),
  ('submitted', 'Submitted', 30),
  ('accepted',  'Accepted',  40),
  ('rejected',  'Rejected',  50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'regulatory-report-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('received',    'Received',    10),
  ('in-progress', 'In Progress', 20),
  ('extended',    'Extended',    30),
  ('responded',   'Responded',   40),
  ('refused',     'Refused',     50)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'foi-request-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "value_set_member" ("value_set_id", "code", "display_label", "sort_order")
SELECT vs."id", v.code, v.display_label, v.sort_order
FROM "value_set" vs,
(VALUES
  ('pending',                 'Pending',                 10),
  ('submitted-to-scheduling', 'Submitted to Scheduling', 20),
  ('scheduled',               'Scheduled',               30),
  ('cancelled',               'Cancelled',               40)
) AS v(code, display_label, sort_order)
WHERE vs."set_code" = 'exam-entry-status-code'
ON CONFLICT DO NOTHING;

INSERT INTO "field_value_set" ("entity_name", "field_name", "value_set_code", "description")
VALUES
  ('ucas_application',        'status_code',             'ucas-application-status-code', NULL),
  ('hesa_student_return',     'status_code',             'hesa-return-status-code',      NULL),
  ('hesa_validation_issue',   'severity_code',           'hesa-validation-severity-code',NULL),
  ('slc_notification',        'notification_type_code',  'slc-notification-type-code',   NULL),
  ('ukvi_cas_request',        'status_code',             'cas-status-code',              NULL),
  ('ukvi_visa_status',        'status_code',             'ukvi-visa-status-code',        NULL),
  ('ukvi_compliance_alert',   'alert_type_code',         'ukvi-alert-type-code',         NULL),
  ('ofs_extract',             'extract_type_code',       'ofs-extract-type-code',        NULL),
  ('ofs_extract',             'status_code',             'regulatory-report-status-code',NULL),
  ('foi_request',             'status_code',             'foi-request-status-code',      NULL),
  ('exam_entry',              'status_code',             'exam-entry-status-code',       NULL)
ON CONFLICT ("entity_name", "field_name") DO NOTHING;
