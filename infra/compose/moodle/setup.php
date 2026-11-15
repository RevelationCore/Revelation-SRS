<?php
// SRS VLE connector — local Moodle test setup (development only).
// Enables REST web services, creates an external service limited to the
// functions the connector's Moodle driver uses, issues a token, and creates a
// test course with one enrolled student whose ID number is an SRS person id.
// Prints a JSON line the test harness reads. Safe to re-run.
define('CLI_SCRIPT', true);
require('/var/www/html/config.php');
require_once($CFG->dirroot . '/course/lib.php');
require_once($CFG->dirroot . '/user/lib.php');
require_once($CFG->dirroot . '/group/lib.php');
require_once($CFG->dirroot . '/webservice/lib.php');

global $DB, $CFG;

set_config('enablewebservices', 1);
set_config('webserviceprotocols', 'rest');

$admin = get_admin();

$shortname = 'srs_vle_connector';
$service = $DB->get_record('external_services', ['shortname' => $shortname]);
if (!$service) {
    $id = $DB->insert_record('external_services', (object) [
        'name' => 'SRS VLE connector', 'shortname' => $shortname, 'enabled' => 1,
        'restrictedusers' => 0, 'downloadfiles' => 0, 'uploadfiles' => 0,
        'timecreated' => time(), 'timemodified' => time(),
    ]);
    $service = $DB->get_record('external_services', ['id' => $id]);
}

// What the driver calls.
$functions = [
    'core_webservice_get_site_info',
    'core_user_get_users_by_field',
    'core_group_get_course_groups',
    'core_group_create_groups',
    'core_group_get_group_members',
    'core_group_add_group_members',
    'core_group_delete_group_members',
];
foreach ($functions as $f) {
    if (!$DB->record_exists('external_functions', ['name' => $f])) {
        fwrite(STDERR, "missing web service function: $f\n");
        exit(1);
    }
    if (!$DB->record_exists('external_services_functions', ['externalserviceid' => $service->id, 'functionname' => $f])) {
        $DB->insert_record('external_services_functions', (object) ['externalserviceid' => $service->id, 'functionname' => $f]);
    }
}

// What we could not confirm from Moodle's published documentation.
$probe = [];
foreach (['mod_quiz_get_overrides', 'mod_quiz_save_overrides', 'mod_quiz_delete_overrides',
          'mod_assign_save_user_extensions', 'mod_quiz_get_quizzes_by_courses'] as $f) {
    $probe[$f] = $DB->record_exists('external_functions', ['name' => $f]);
}

$existing = $DB->get_record('external_tokens', ['externalserviceid' => $service->id, 'userid' => $admin->id]);
if ($existing) {
    $token = $existing->token;
} else if (class_exists('\core_external\util')) {
    $token = \core_external\util::generate_token(EXTERNAL_TOKEN_PERMANENT, $service, $admin->id, context_system::instance());
} else {
    $token = external_generate_token(EXTERNAL_TOKEN_PERMANENT, $service, $admin->id, context_system::instance());
}

$course = $DB->get_record('course', ['shortname' => 'SRS-VLE-TEST']);
if (!$course) {
    $course = create_course((object) ['fullname' => 'SRS VLE connector test', 'shortname' => 'SRS-VLE-TEST', 'category' => 1]);
}

$personId = '11111111-2222-4333-8444-555555555555';
$user = $DB->get_record('user', ['idnumber' => $personId]);
if (!$user) {
    $uid = user_create_user((object) [
        'username' => 'srs.test.student', 'password' => 'Student1!x', 'firstname' => 'Nina', 'lastname' => 'Test',
        'email' => 'nina@example.test', 'idnumber' => $personId, 'auth' => 'manual', 'confirmed' => 1,
        'mnethostid' => $CFG->mnet_localhost_id,
    ]);
    $user = $DB->get_record('user', ['id' => $uid]);
}
$instance = $DB->get_record('enrol', ['courseid' => $course->id, 'enrol' => 'manual'], '*', MUST_EXIST);
$studentRole = $DB->get_field('role', 'id', ['shortname' => 'student'], MUST_EXIST);
enrol_get_plugin('manual')->enrol_user($instance, $user->id, $studentRole);

echo json_encode([
    'release' => $CFG->release,
    'token' => $token,
    'courseId' => (int) $course->id,
    'personId' => $personId,
    'userId' => (int) $user->id,
    'probe' => $probe,
]), "\n";
