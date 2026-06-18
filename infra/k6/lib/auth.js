/**
 * k6 authentication helpers.
 *
 * Obtains a short-lived JWT from Keycloak using the Resource Owner Password
 * Credentials (ROPC) grant — suitable for load testing only, not production flows.
 *
 * Required environment variables:
 *   BASE_URL        e.g. http://localhost:3000
 *   KEYCLOAK_URL    e.g. http://localhost:8080
 *   REALM           e.g. revelation-srs
 *   CLIENT_ID       e.g. srs-api
 *   STAFF_USER      staff username
 *   STAFF_PASS      staff password
 *   STUDENT_USER    student portal username
 *   STUDENT_PASS    student portal password
 */

import http from 'k6/http';

const BASE_URL     = __ENV.BASE_URL     || 'http://localhost:3000';
const KC_URL       = __ENV.KEYCLOAK_URL || 'http://localhost:8080';
const REALM        = __ENV.REALM        || 'revelation-srs';
const CLIENT_ID    = __ENV.CLIENT_ID    || 'srs-api';
const STAFF_USER   = __ENV.STAFF_USER   || 'admin@demo.test';
const STAFF_PASS   = __ENV.STAFF_PASS   || 'demo-password';
const STUDENT_USER = __ENV.STUDENT_USER || 'student@demo.test';
const STUDENT_PASS = __ENV.STUDENT_PASS || 'demo-password';
const TENANT_ID    = __ENV.TENANT_ID    || '';

const TOKEN_URL = `${KC_URL}/realms/${REALM}/protocol/openid-connect/token`;

function fetchToken(username, password) {
  const res = http.post(TOKEN_URL, {
    grant_type:  'password',
    client_id:   CLIENT_ID,
    username,
    password,
  }, { tags: { name: 'keycloak-token' } });

  if (res.status !== 200) {
    throw new Error(`Token fetch failed: ${res.status} ${res.body}`);
  }
  return JSON.parse(res.body).access_token;
}

export function staffHeaders() {
  const token = fetchToken(STAFF_USER, STAFF_PASS);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(TENANT_ID ? { 'X-Tenant-ID': TENANT_ID } : {}),
  };
}

export function studentHeaders() {
  const token = fetchToken(STUDENT_USER, STUDENT_PASS);
  return {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
    ...(TENANT_ID ? { 'X-Tenant-ID': TENANT_ID } : {}),
  };
}

export { BASE_URL };
