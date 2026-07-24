import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

import * as schema from "./schema/index.js"

export type Database = NodePgDatabase<typeof schema>

export interface DatabaseClient {
  readonly database: Database
  readonly pool: Pool
}

export interface CreateDatabaseClientOptions {
  readonly applicationName?: string
  readonly maxConnections?: number
}

export function createDatabaseClient(
  databaseUrl: string,
  options: CreateDatabaseClientOptions = {},
): DatabaseClient {
  const pool = new Pool({
    application_name: options.applicationName ?? "skillconsole-server",
    connectionString: databaseUrl,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 20_000,
    max: options.maxConnections ?? 10,
  })

  return {
    database: drizzle({ client: pool, schema }),
    pool,
  }
}

export async function checkDatabaseConnection(
  client: DatabaseClient,
): Promise<void> {
  await client.pool.query("select 1 as connected")
}

export async function closeDatabaseClient(
  client: DatabaseClient,
): Promise<void> {
  await client.pool.end()
}
