import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';

import { createDb, type Db } from '../../../db/src/pool.js';

export interface PostgresTestEnvironment {
  container: StartedPostgreSqlContainer;
  db:        Db;
  connectionString: string;
}

/**
 * Start a throwaway PostgreSQL 16 container for integration tests.
 * The caller is responsible for stopping it (afterAll).
 */
export async function startPostgresContainer(
  options: { database?: string } = {},
): Promise<PostgresTestEnvironment> {
  const container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase(options.database ?? 'srs_test')
    .start();

  const connectionString = container.getConnectionUri();
  const db = createDb(connectionString);

  return { container, db, connectionString };
}
