import { defineConfig } from "drizzle-kit"

const databaseUrl = process.env.DATABASE_URL?.trim()

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/infrastructure/database/schema/index.ts",
  out: "./migrations",
  ...(databaseUrl
    ? {
        dbCredentials: {
          url: databaseUrl,
        },
      }
    : {}),
  migrations: {
    prefix: "timestamp",
    schema: "drizzle",
    table: "migrations",
  },
  strict: true,
  verbose: true,
})
