import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL?.trim()

if (!databaseUrl) {
  throw new Error("DATABASE_URL is required for Drizzle Kit.")
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/database/schema/index.ts",
  out: "./migrations",
  dbCredentials: {
    url: databaseUrl,
  },
  migrations: {
    prefix: "timestamp",
    schema: "drizzle",
    table: "migrations",
  },
  strict: true,
  verbose: true,
})
