export const applicationEnvironments = [
  "development",
  "test",
  "production",
] as const

export const logLevels = [
  "fatal",
  "error",
  "warn",
  "info",
  "debug",
  "trace",
  "silent",
] as const

export type ApplicationEnvironment = (typeof applicationEnvironments)[number]
export type LogLevel = (typeof logLevels)[number]

export interface ApplicationConfig {
  readonly nodeEnvironment: ApplicationEnvironment
  readonly host: string
  readonly port: number
  readonly databaseUrl: string
  readonly logLevel: LogLevel
  readonly openApiEnabled: boolean
  readonly staticRoot?: string
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>

export class ConfigurationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[]) {
    super(`Application configuration is invalid: ${issues.join("; ")}`)
    this.name = "ConfigurationError"
    this.issues = issues
  }
}

function isOneOf<const Values extends readonly string[]>(
  value: string,
  values: Values,
): value is Values[number] {
  return values.includes(value)
}

function parseBoolean(
  value: string | undefined,
  fallback: boolean,
  key: string,
  issues: string[],
): boolean {
  if (value === undefined || value.trim() === "") return fallback
  if (value === "true") return true
  if (value === "false") return false

  issues.push(`${key} must be either "true" or "false"`)
  return fallback
}

function parsePort(value: string | undefined, issues: string[]): number {
  const rawPort = value?.trim() || "3000"
  const port = Number(rawPort)

  if (
    !/^\d+$/.test(rawPort) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    issues.push("PORT must be an integer between 1 and 65535")
    return 3000
  }

  return port
}

function parseDatabaseUrl(
  value: string | undefined,
  issues: string[],
): string {
  const databaseUrl = value?.trim()

  if (!databaseUrl) {
    issues.push("DATABASE_URL is required")
    return ""
  }

  try {
    const parsedUrl = new URL(databaseUrl)

    if (parsedUrl.protocol !== "postgres:" && parsedUrl.protocol !== "postgresql:") {
      issues.push("DATABASE_URL must use the postgres or postgresql protocol")
    }
  } catch {
    issues.push("DATABASE_URL must be a valid URL")
  }

  return databaseUrl
}

export function parseApplicationConfig(
  environment: EnvironmentSource,
): ApplicationConfig {
  const issues: string[] = []
  const nodeEnvironmentValue = environment.NODE_ENV?.trim() || "development"
  const logLevelValue = environment.LOG_LEVEL?.trim() || "info"

  const nodeEnvironment = isOneOf(
    nodeEnvironmentValue,
    applicationEnvironments,
  )
    ? nodeEnvironmentValue
    : "development"

  if (nodeEnvironment !== nodeEnvironmentValue) {
    issues.push(
      `NODE_ENV must be one of: ${applicationEnvironments.join(", ")}`,
    )
  }

  const logLevel = isOneOf(logLevelValue, logLevels) ? logLevelValue : "info"

  if (logLevel !== logLevelValue) {
    issues.push(`LOG_LEVEL must be one of: ${logLevels.join(", ")}`)
  }

  const staticRoot = environment.STATIC_ROOT?.trim()
  const config: ApplicationConfig = {
    nodeEnvironment,
    host: environment.HOST?.trim() || "0.0.0.0",
    port: parsePort(environment.PORT, issues),
    databaseUrl: parseDatabaseUrl(environment.DATABASE_URL, issues),
    logLevel,
    openApiEnabled: parseBoolean(
      environment.OPENAPI_ENABLED,
      nodeEnvironment !== "production",
      "OPENAPI_ENABLED",
      issues,
    ),
    ...(staticRoot ? { staticRoot } : {}),
  }

  if (issues.length > 0) {
    throw new ConfigurationError(issues)
  }

  return config
}
