// Development: both BFFs in one process (ADR-026 item 14) — the admin app's on
// 3010 and the portal's on 3011, each its own Keycloak client, with
// development sessions on. The Vite servers proxy /bff to them.
import postgres from 'postgres';

import { buildBff } from './app.js';
import { loadConfig } from './config.js';

const base = loadConfig({ ...process.env, NODE_ENV: process.env['NODE_ENV'] ?? 'development' });
if (base.nodeEnv !== 'development' && base.nodeEnv !== 'test') throw new Error('src/dev.ts is for development only; run dist/main.js per app instead');
const sql = postgres(base.databaseUrl, { max: 10 });
const upstreams = {
  srs:       process.env['BFF_UPSTREAM_SRS'] ?? 'http://localhost:3000',
  wellbeing: process.env['BFF_UPSTREAM_WELLBEING'] ?? 'http://localhost:3002',
};
const apps = [
  { clientId: 'srs-admin',  clientSecret: process.env['BFF_ADMIN_CLIENT_SECRET'] ?? 'dev-admin-bff-secret',  port: 3010, appOrigin: 'http://localhost:5173' },
  { clientId: 'srs-portal', clientSecret: process.env['BFF_PORTAL_CLIENT_SECRET'] ?? 'dev-portal-bff-secret', port: 3011, appOrigin: 'http://localhost:5174' },
];
for (const a of apps) {
  const app = await buildBff({ ...base, ...a, upstreams, devSessions: true }, { sql });
  await app.listen({ port: a.port, host: '127.0.0.1' });
}
