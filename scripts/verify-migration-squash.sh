#!/usr/bin/env bash
# Proves a re-squash of packages/db/migrations changed nothing.
#
# Applies the core migrations at a git ref (default HEAD) to one fresh
# database and the working tree's migrations to another, in journal order,
# then diffs full schema and data dumps. Exits non-zero on any difference.
#
#   scripts/verify-migration-squash.sh [git-ref]
#
# Needs Docker (OrbStack: DOCKER_HOST=unix://$HOME/.orbstack/run/docker.sock).
set -euo pipefail

ref="${1:-HEAD}"
repo="$(cd "$(dirname "$0")/.." && pwd)"
work="$(mktemp -d)"
name="srs-squash-verify-$$"
image="postgres:16-alpine"   # same as the integration tests

cleanup() { docker rm -f "$name" >/dev/null 2>&1 || true; rm -rf "$work"; }
trap cleanup EXIT

mkdir -p "$work/before" "$work/after"
git -C "$repo" archive "$ref" packages/db/migrations | tar -x -C "$work/before"
mkdir -p "$work/after/packages/db"
cp -R "$repo/packages/db/migrations" "$work/after/packages/db/"

docker run -d --name "$name" -e POSTGRES_PASSWORD=verify "$image" >/dev/null
until docker exec "$name" pg_isready -U postgres >/dev/null 2>&1; do sleep 0.5; done
sleep 1

apply() { # side db
  local side="$1" db="$2" dir="$work/$1/packages/db/migrations"
  docker exec "$name" createdb -U postgres "$db"
  local tags
  tags="$(node -e 'for (const e of JSON.parse(require("fs").readFileSync(process.argv[1],"utf8")).entries) console.log(e.tag)' "$dir/meta/_journal.json")"
  local count=0
  for tag in $tags; do
    docker exec -i "$name" psql -q -v ON_ERROR_STOP=1 -U postgres -d "$db" <"$dir/$tag.sql" >/dev/null
    count=$((count + 1))
  done
  echo "$side: applied $count migrations"
}

apply before srs_before
apply after srs_after

dump() { # db kind
  # Data is dumped as one INSERT per row, sorted, so row order can't differ.
  if [ "$2" = schema ]; then
    docker exec "$name" pg_dump -U postgres -d "$1" --schema-only --no-owner --no-privileges | grep -vE "^\\\\(un)?restrict "
  else
    # Generated ids and now() timestamps differ run to run, so they are masked;
    # every other value in every row is compared.
    docker exec "$name" pg_dump -U postgres -d "$1" --data-only --no-owner --inserts --rows-per-insert=1 2>/dev/null \
      | grep '^INSERT' \
      | sed -E -e 's/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/<uuid>/g' \
               -e 's/[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}(\.[0-9]+)?\+00/<now>/g' \
      | sort
  fi
}

status=0
for kind in schema data; do
  dump srs_before "$kind" >"$work/before.$kind.sql"
  dump srs_after "$kind" >"$work/after.$kind.sql"
  if diff -u "$work/before.$kind.sql" "$work/after.$kind.sql" >"$work/$kind.diff"; then
    echo "$kind: identical ($(wc -l <"$work/after.$kind.sql" | tr -d ' ') lines)"
  else
    echo "$kind: DIFFERENT"; head -60 "$work/$kind.diff"; status=1
  fi
done
exit $status
