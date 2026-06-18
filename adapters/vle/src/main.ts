// OTel must be bootstrapped before any other import.
import './telemetry.js';

import { buildApp } from './app.js';
import { loadConfig } from './config.js';

async function main(): Promise<void> {
  const config = loadConfig();
  const app    = await buildApp(config);

  await app.listen({ port: config.port, host: '0.0.0.0' });
  app.log.info(`VLE connector listening on port ${config.port}`);
  app.log.info(`Endpoint safety class: ${config.endpointSafetyClass}`);
  app.log.info(`VLE endpoint: ${config.vleEndpointUrl}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
