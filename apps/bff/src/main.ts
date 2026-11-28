// OTel must be bootstrapped before any other import.
import './telemetry.js';

import postgres from 'postgres';

import { buildBff } from './app.js';
import { loadConfig } from './config.js';

const cfg = loadConfig();
const sql = postgres(cfg.databaseUrl, { max: 10, connect_timeout: 10, idle_timeout: 60, connection: { statement_timeout: 10_000 } });
const app = await buildBff(cfg, { sql });
await app.listen({ port: cfg.port, host: '0.0.0.0' });

// Expired sessions are removed every 5 minutes, by one pod at a time.
const sweep = setInterval(() => { void app.sessionStore.sweep().catch((err: unknown) => app.log.warn({ err }, 'Session sweep failed')); }, 5 * 60_000);

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => { clearInterval(sweep); void app.close().then(() => sql.end()).then(() => process.exit(0)); });
}
