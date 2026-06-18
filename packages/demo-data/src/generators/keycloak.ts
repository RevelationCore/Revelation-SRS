import { PERSONA_IDS } from '../persona-ids.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PersonaSpec {
  email:     string;
  username:  string;
  firstName: string;
  lastName:  string;
  roles:     string[];
  personaId: string;
}

export interface KeycloakConfig {
  adminUrl:        string;  // e.g. 'http://localhost:8080'
  realm:           string;  // target realm
  adminUsername:   string;
  adminPassword:   string;
  personaPassword: string;  // shared demo password
}

// ─── Persona catalogue ────────────────────────────────────────────────────────

export const DEMO_PERSONAS: readonly PersonaSpec[] = [
  { email: 'registry@demo.srs',   username: 'registry',   firstName: 'DEMO Registry',  lastName: 'Administrator', roles: ['registry-administrator'],                         personaId: PERSONA_IDS.STAFF_REGISTRY       },
  { email: 'sysadmin@demo.srs',   username: 'sysadmin',   firstName: 'DEMO System',    lastName: 'Administrator', roles: ['system-administrator', 'tenant-administrator'],   personaId: PERSONA_IDS.ADMIN_SRS            },
  { email: 'chair@demo.srs',      username: 'chair',      firstName: 'DEMO Board',     lastName: 'Chair',         roles: ['exam-board-chair', 'registry-administrator'],     personaId: PERSONA_IDS.STAFF_EXAMBOARD      },
  { email: 'wellbeing@demo.srs',  username: 'wellbeing',  firstName: 'DEMO Wellbeing', lastName: 'Advisor',       roles: ['wellbeing-advisor'],                              personaId: PERSONA_IDS.STAFF_WELLBEING      },
  { email: 'dpo@demo.srs',        username: 'dpo',        firstName: 'DEMO DPO',       lastName: 'Auditor',       roles: ['dpo', 'wellbeing-auditor'],                       personaId: PERSONA_IDS.STAFF_DPO            },
  { email: 'alice.demo@demo.srs', username: 'alice.demo', firstName: 'DEMO Alice',     lastName: 'Demo',          roles: ['student'],                                        personaId: PERSONA_IDS.STUDENT_STANDARD     },
  { email: 'bob.demo@demo.srs',   username: 'bob.demo',   firstName: 'DEMO Bob',       lastName: 'Demo',          roles: ['student'],                                        personaId: PERSONA_IDS.STUDENT_INTERMITTING },
  { email: 'carol.demo@demo.srs', username: 'carol.demo', firstName: 'DEMO Carol',     lastName: 'Demo',          roles: ['student'],                                        personaId: PERSONA_IDS.STUDENT_GRADUATED    },
  { email: 'examiner@demo.srs',   username: 'examiner',   firstName: 'DEMO External',  lastName: 'Examiner',      roles: ['external-examiner'],                              personaId: PERSONA_IDS.STAFF_EXAMINER       },
  { email: 'ops@demo.srs',        username: 'ops',        firstName: 'DEMO Ops',       lastName: 'Operator',      roles: ['registry-administrator', 'tenant-administrator'], personaId: PERSONA_IDS.STAFF_OPS            },
];

// ─── Keycloak Admin REST client (minimal) ─────────────────────────────────────

async function getAdminToken(cfg: KeycloakConfig): Promise<string> {
  const res = await fetch(
    `${cfg.adminUrl}/realms/master/protocol/openid-connect/token`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'password',
        client_id:  'admin-cli',
        username:   cfg.adminUsername,
        password:   cfg.adminPassword,
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Keycloak token request failed: ${res.status} ${await res.text()}`);
  }
  const json = await res.json() as { access_token: string };
  return json.access_token;
}

async function findUser(cfg: KeycloakConfig, token: string, username: string): Promise<string | null> {
  const res = await fetch(
    `${cfg.adminUrl}/admin/realms/${cfg.realm}/users?username=${encodeURIComponent(username)}&exact=true`,
    { headers: { Authorization: `Bearer ${token}` } },
  );
  if (!res.ok) {
    throw new Error(`Keycloak user search failed: ${res.status}`);
  }
  const users = await res.json() as Array<{ id: string }>;
  return users.length > 0 ? (users[0]?.id ?? null) : null;
}

async function createUser(cfg: KeycloakConfig, token: string, spec: PersonaSpec): Promise<string> {
  const res = await fetch(
    `${cfg.adminUrl}/admin/realms/${cfg.realm}/users`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({
        username:      spec.username,
        email:         spec.email,
        firstName:     spec.firstName,
        lastName:      spec.lastName,
        enabled:       true,
        emailVerified: true,
        attributes:    { personaId: [spec.personaId] },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Keycloak create user failed (${spec.username}): ${res.status} ${await res.text()}`);
  }
  const location = res.headers.get('Location') ?? '';
  const userId   = location.split('/').at(-1);
  if (!userId) throw new Error(`Keycloak did not return a user ID for ${spec.username}`);
  return userId;
}

async function setPassword(cfg: KeycloakConfig, token: string, userId: string): Promise<void> {
  const res = await fetch(
    `${cfg.adminUrl}/admin/realms/${cfg.realm}/users/${userId}/reset-password`,
    {
      method:  'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ type: 'password', value: cfg.personaPassword, temporary: false }),
    },
  );
  if (!res.ok) {
    throw new Error(`Keycloak reset-password failed (userId=${userId}): ${res.status}`);
  }
}

async function assignRoles(
  cfg:     KeycloakConfig,
  token:   string,
  userId:  string,
  roles:   string[],
): Promise<void> {
  if (roles.length === 0) return;

  // Look up realm role objects
  const roleObjects: Array<{ id: string; name: string }> = [];
  for (const roleName of roles) {
    const res = await fetch(
      `${cfg.adminUrl}/admin/realms/${cfg.realm}/roles/${encodeURIComponent(roleName)}`,
      { headers: { Authorization: `Bearer ${token}` } },
    );
    if (!res.ok) {
      // Role may not exist yet in the realm — log and skip rather than crashing.
      console.warn(`  [personas] Role "${roleName}" not found in realm "${cfg.realm}" — skipping`);
      continue;
    }
    const role = await res.json() as { id: string; name: string };
    roleObjects.push(role);
  }

  if (roleObjects.length === 0) return;

  const assignRes = await fetch(
    `${cfg.adminUrl}/admin/realms/${cfg.realm}/users/${userId}/role-mappings/realm`,
    {
      method:  'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body:    JSON.stringify(roleObjects),
    },
  );
  if (!assignRes.ok) {
    throw new Error(`Keycloak role assignment failed (userId=${userId}): ${assignRes.status}`);
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export interface ProvisionPersonasOpts {
  /** If true, a connection failure is a hard abort. */
  hardFail: boolean;
}

/**
 * Provision all DEMO_PERSONAS into Keycloak.
 *
 * Creates each persona if it does not already exist, sets the demo password,
 * and assigns realm roles.  Existing accounts whose password or roles differ
 * are left unchanged to avoid disrupting in-flight demos.
 *
 * Fallback behaviour (controlled by `opts.hardFail`):
 *   - hardFail=false (dev): KEYCLOAK_ADMIN_URL absent or connection error → warn and continue.
 *   - hardFail=true  (hosted): any failure → re-throw.
 */
export async function provisionPersonas(opts: ProvisionPersonasOpts): Promise<void> {
  const adminUrl = process.env['KEYCLOAK_ADMIN_URL'];
  if (!adminUrl) {
    const msg = '[personas] KEYCLOAK_ADMIN_URL not set — skipping persona provisioning.';
    if (opts.hardFail) throw new Error(msg);
    console.warn(msg);
    return;
  }

  const realm           = process.env['KEYCLOAK_REALM']           ?? 'revelation-srs';
  const adminUsername   = process.env['KEYCLOAK_ADMIN_USERNAME']   ?? 'admin';
  const adminPassword   = process.env['KEYCLOAK_ADMIN_PASSWORD']   ?? '';
  const personaPassword = process.env['DEMO_PERSONA_PASSWORD']     ?? 'Demo-2026!';

  if (!adminPassword) {
    const msg = '[personas] KEYCLOAK_ADMIN_PASSWORD not set — skipping persona provisioning.';
    if (opts.hardFail) throw new Error(msg);
    console.warn(msg);
    return;
  }

  const cfg: KeycloakConfig = { adminUrl, realm, adminUsername, adminPassword, personaPassword };

  try {
    console.log(`  [personas] Connecting to Keycloak at ${adminUrl} (realm: ${realm})`);
    const token = await getAdminToken(cfg);

    for (const spec of DEMO_PERSONAS) {
      let userId = await findUser(cfg, token, spec.username);
      if (userId === null) {
        userId = await createUser(cfg, token, spec);
        await setPassword(cfg, token, userId);
        await assignRoles(cfg, token, userId, spec.roles);
        console.log(`  [personas] Created persona: ${spec.username}`);
      } else {
        console.log(`  [personas] Persona already exists: ${spec.username}`);
      }
    }

    console.log(`  [personas] ${DEMO_PERSONAS.length} personas provisioned.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (opts.hardFail) {
      throw new Error(`Persona provisioning failed: ${message}`);
    }
    console.warn(`  [personas] Keycloak unavailable — continuing without personas. (${message})`);
  }
}
