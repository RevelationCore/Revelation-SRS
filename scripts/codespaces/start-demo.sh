#!/usr/bin/env bash
set -euo pipefail

SCENARIO="${SRS_DEMO_SCENARIO:-assessment-marks}"
LOG_DIR="${CODESPACE_VSCODE_FOLDER:-$PWD}/.codespaces/logs"
COMPOSE_FILE="infra/compose/docker-compose.yml"

mkdir -p "${LOG_DIR}"

if [[ -n "${CODESPACE_NAME:-}" && -n "${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-}" ]]; then
  PUBLIC_API_URL="https://${CODESPACE_NAME}-3000.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  PUBLIC_ADMIN_URL="https://${CODESPACE_NAME}-5173.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  PUBLIC_PORTAL_URL="https://${CODESPACE_NAME}-5174.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
  PUBLIC_KEYCLOAK_URL="https://${CODESPACE_NAME}-8081.${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN}"
else
  PUBLIC_API_URL="http://localhost:3000"
  PUBLIC_ADMIN_URL="http://localhost:5173"
  PUBLIC_PORTAL_URL="http://localhost:5174"
  PUBLIC_KEYCLOAK_URL="http://localhost:8081"
fi

write_env_files() {
  cat > .env <<EOF
DATABASE_URL=postgres://srs:srs@localhost:5432/srs
NATS_URL=nats://localhost:4222
TEMPORAL_ADDRESS=localhost:7233
JWT_SECRET=change-me-demo-only
KEYCLOAK_JWKS_URL=http://localhost:8081/realms/srs/protocol/openid-connect/certs
KEYCLOAK_ADMIN_URL=http://localhost:8081
KEYCLOAK_REALM=srs
KEYCLOAK_ADMIN_USERNAME=admin
KEYCLOAK_ADMIN_PASSWORD=admin
PORT=3000
LOG_LEVEL=info
NODE_ENV=development
CORS_ORIGINS=${PUBLIC_ADMIN_URL},${PUBLIC_PORTAL_URL},http://localhost:5173,http://localhost:5174
OTEL_SERVICE_NAME=srs-api-codespaces-demo
SRS_ENVIRONMENT_CODE=demo
EOF

  cat > apps/admin/.env <<EOF
VITE_API_BASE_URL=${PUBLIC_API_URL}
VITE_DEMO_MODE=true
VITE_KEYCLOAK_URL=${PUBLIC_KEYCLOAK_URL}
VITE_KEYCLOAK_REALM=srs
VITE_KEYCLOAK_CLIENT_ID=srs-admin
VITE_PORTAL_URL=${PUBLIC_PORTAL_URL}
EOF

  cat > apps/portal/.env <<EOF
VITE_API_URL=${PUBLIC_API_URL}
VITE_API_BASE_URL=${PUBLIC_API_URL}
VITE_DEMO_MODE=true
VITE_KEYCLOAK_URL=${PUBLIC_KEYCLOAK_URL}
VITE_KEYCLOAK_REALM=srs
VITE_KEYCLOAK_CLIENT_ID=srs-portal
VITE_ADMIN_URL=${PUBLIC_ADMIN_URL}
EOF
}

wait_for_url() {
  local url="$1"
  local label="$2"
  local max_attempts="${3:-60}"

  echo "Waiting for ${label}..."
  for attempt in $(seq 1 "${max_attempts}"); do
    if curl -fsS "${url}" >/dev/null 2>&1; then
      echo "${label} is ready."
      return 0
    fi
    sleep 2
  done

  echo "Timed out waiting for ${label} at ${url}."
  return 1
}

configure_keycloak_redirects() {
  node --input-type=module <<'NODE'
const adminUrl = 'http://localhost:8081';
const realm = 'srs';
const publicAdmin = process.env.PUBLIC_ADMIN_URL;
const publicPortal = process.env.PUBLIC_PORTAL_URL;

async function keycloak(path, options = {}) {
  const response = await fetch(`${adminUrl}${path}`, options);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${options.method ?? 'GET'} ${path} failed: ${response.status} ${body}`);
  }
  if (response.status === 204) return undefined;
  return response.json();
}

const tokenResponse = await fetch(`${adminUrl}/realms/master/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: 'admin-cli',
    username: 'admin',
    password: 'admin',
  }),
});

if (!tokenResponse.ok) {
  throw new Error(`Failed to obtain Keycloak admin token: ${tokenResponse.status}`);
}

const { access_token: token } = await tokenResponse.json();
const headers = {
  authorization: `Bearer ${token}`,
  'content-type': 'application/json',
};

for (const [clientId, publicUrl] of [
  ['srs-admin', publicAdmin],
  ['srs-portal', publicPortal],
]) {
  const clients = await keycloak(
    `/admin/realms/${realm}/clients?clientId=${encodeURIComponent(clientId)}`,
    { headers },
  );
  const client = clients[0];
  if (!client) throw new Error(`Client ${clientId} not found in realm ${realm}`);

  client.redirectUris = Array.from(new Set([
    ...(client.redirectUris ?? []),
    `${publicUrl}/callback`,
    `${publicUrl}/*`,
  ]));
  client.webOrigins = Array.from(new Set([
    ...(client.webOrigins ?? []),
    publicUrl,
    '+',
  ]));

  await keycloak(`/admin/realms/${realm}/clients/${client.id}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify(client),
  });
}
NODE
}

start_process() {
  local name="$1"
  shift
  if pgrep -f "$*" >/dev/null 2>&1; then
    echo "${name} already appears to be running."
    return 0
  fi

  echo "Starting ${name}..."
  nohup "$@" > "${LOG_DIR}/${name}.log" 2>&1 &
  echo $! > "${LOG_DIR}/${name}.pid"
}

echo "Preparing Revelation SRS Codespaces demo."
echo "Scenario: ${SCENARIO}"

export PUBLIC_ADMIN_URL
export PUBLIC_PORTAL_URL
write_env_files

# Export env vars so child processes (pnpm migrate, demo:reset) inherit DATABASE_URL etc.
set -a
# shellcheck source=.env
source .env
set +a

corepack enable
corepack prepare pnpm@9.15.9 --activate

docker compose -f "${COMPOSE_FILE}" up -d postgres nats temporal temporal-ui keycloak

echo "Waiting for PostgreSQL..."
postgres_ready=false
for attempt in $(seq 1 60); do
  if docker compose -f "${COMPOSE_FILE}" exec -T postgres pg_isready -U srs -d srs >/dev/null 2>&1; then
    echo "PostgreSQL is ready."
    postgres_ready=true
    break
  fi
  sleep 2
done
if [[ "${postgres_ready}" != "true" ]]; then
  echo "Timed out waiting for PostgreSQL."
  exit 1
fi

wait_for_url "http://localhost:8081/health/ready" "Keycloak" 90

echo "Configuring Keycloak redirect URLs for Codespaces."
configure_keycloak_redirects

echo "Running database migrations."
pnpm migrate

echo "Loading demo scenario: ${SCENARIO}"
pnpm demo:reset "${SCENARIO}"

start_process "api" pnpm --filter @revelation-srs/api dev
start_process "admin" pnpm --filter @revelation-srs/admin dev -- --host 0.0.0.0
start_process "portal" pnpm --filter @revelation-srs/portal dev -- --host 0.0.0.0

wait_for_url "http://localhost:3000/health" "SRS API" 60
wait_for_url "http://localhost:5173" "Admin console" 60
wait_for_url "http://localhost:5174" "Student portal" 60

cat <<EOF

Revelation SRS demo is running.

Admin console:  ${PUBLIC_ADMIN_URL}
Student portal: ${PUBLIC_PORTAL_URL}
API health:     ${PUBLIC_API_URL}/health
Keycloak:       ${PUBLIC_KEYCLOAK_URL}

Demo accounts use the password: Demo-2026!
Logs are in: ${LOG_DIR}

EOF
