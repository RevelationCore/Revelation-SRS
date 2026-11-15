#!/usr/bin/env bash
# Configure the local Moodle (infra/compose/moodle.compose.yml) for the SRS VLE
# connector and print the settings the live driver test needs.
#
#   infra/compose/moodle/setup.sh
#   MOODLE_URL=http://localhost:8090 MOODLE_TOKEN=... MOODLE_COURSE_ID=... MOODLE_PERSON_ID=... \
#     pnpm --filter @revelation-srs/vle-connector test:int -- test/moodle-live.int.test.ts
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
compose=(docker compose -f "$here/../moodle.compose.yml")

"${compose[@]}" cp "$here/setup.php" moodle:/tmp/srs-setup.php
php_bin="$("${compose[@]}" exec -T moodle sh -c 'command -v php || command -v php84')"
out="$("${compose[@]}" exec -T moodle "$php_bin" /tmp/srs-setup.php)"
echo "$out"

json="$(echo "$out" | tail -n 1)"
field() { echo "$json" | sed -E "s/.*\"$1\":\"?([^\",}]*)\"?.*/\1/"; }
cat <<ENV

export MOODLE_URL=http://localhost:8090
export MOODLE_TOKEN=$(field token)
export MOODLE_COURSE_ID=$(field courseId)
export MOODLE_PERSON_ID=$(field personId)
ENV
