import { fileURLToPath } from "node:url"

import { migrate } from "drizzle-orm/node-postgres/migrator"

import { closeDatabaseClient, createDatabaseClient } from "./client.js"

const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required to run database migrations.")
}

const migrationsFolder = fileURLToPath(
  new URL("../../../migrations", import.meta.url),
)
const client = createDatabaseClient(databaseUrl, {
  applicationName: "skillconsole-migrator",
  maxConnections: 1,
})

try {
  await migrate(client.database, {
    migrationsFolder,
    migrationsSchema: "drizzle",
    migrationsTable: "migrations",
  })
  console.info("SkillConsole database migrations completed.")
} finally {
  await closeDatabaseClient(client)
}
