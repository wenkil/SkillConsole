import path from "node:path"
import { fileURLToPath } from "node:url"

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
  readonly dataRoot: string
  readonly claudeSettingsPath: string
  readonly uploadFolderIgnoreConfigPath: string
  readonly uploadLimits: UploadLimits
  readonly staticRoot?: string
}

export interface UploadLimits {
  readonly maxFiles: number
  readonly maxFileBytes: number
  readonly maxTotalBytes: number
  readonly maxDirectoryDepth: number
  readonly maxPathLength: number
  readonly maxZipBytes: number
  readonly maxZipCompressionRatio: number
}

type EnvironmentSource = Readonly<Record<string, string | undefined>>
const defaultDataRoot = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  "var",
)
const defaultClaudeSettingsPath = path.resolve(
  fileURLToPath(new URL("../../../../", import.meta.url)),
  "settings.json",
)
const defaultUploadFolderIgnoreConfigPath = fileURLToPath(
  new URL("../../config/upload-folder-ignore.json", import.meta.url),
)

export class ConfigurationError extends Error {
  readonly issues: readonly string[]

  constructor(issues: readonly string[], options?: ErrorOptions) {
    super(
      `Application configuration is invalid: ${issues.join("; ")}`,
      options,
    )
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

function parsePositiveInteger(
  value: string | undefined,
  fallback: number,
  key: string,
  issues: string[],
): number {
  const rawValue = value?.trim()
  if (!rawValue) return fallback

  const parsedValue = Number(rawValue)
  if (
    !/^\d+$/.test(rawValue) ||
    !Number.isSafeInteger(parsedValue) ||
    parsedValue < 1
  ) {
    issues.push(`${key} must be a positive safe integer`)
    return fallback
  }

  return parsedValue
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
  const configuredDataRoot = environment.SKILLCONSOLE_DATA_ROOT?.trim()
  const configuredClaudeSettingsPath =
    environment.SKILLCONSOLE_CLAUDE_SETTINGS_PATH?.trim()
  const configuredUploadFolderIgnoreConfigPath =
    environment.SKILLCONSOLE_UPLOAD_FOLDER_IGNORE_CONFIG?.trim()
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
    dataRoot: configuredDataRoot
      ? path.resolve(configuredDataRoot)
      : defaultDataRoot,
    claudeSettingsPath: configuredClaudeSettingsPath
      ? path.resolve(configuredClaudeSettingsPath)
      : defaultClaudeSettingsPath,
    uploadFolderIgnoreConfigPath: configuredUploadFolderIgnoreConfigPath
      ? path.resolve(configuredUploadFolderIgnoreConfigPath)
      : defaultUploadFolderIgnoreConfigPath,
    uploadLimits: {
      maxFiles: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_FILES,
        20_000,
        "SKILLCONSOLE_UPLOAD_MAX_FILES",
        issues,
      ),
      maxFileBytes: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_FILE_BYTES,
        20 * 1024 * 1024,
        "SKILLCONSOLE_UPLOAD_MAX_FILE_BYTES",
        issues,
      ),
      maxTotalBytes: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_TOTAL_BYTES,
        200 * 1024 * 1024,
        "SKILLCONSOLE_UPLOAD_MAX_TOTAL_BYTES",
        issues,
      ),
      maxDirectoryDepth: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_DIRECTORY_DEPTH,
        32,
        "SKILLCONSOLE_UPLOAD_MAX_DIRECTORY_DEPTH",
        issues,
      ),
      maxPathLength: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_PATH_LENGTH,
        512,
        "SKILLCONSOLE_UPLOAD_MAX_PATH_LENGTH",
        issues,
      ),
      maxZipBytes: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_ZIP_BYTES,
        100 * 1024 * 1024,
        "SKILLCONSOLE_UPLOAD_MAX_ZIP_BYTES",
        issues,
      ),
      maxZipCompressionRatio: parsePositiveInteger(
        environment.SKILLCONSOLE_UPLOAD_MAX_ZIP_COMPRESSION_RATIO,
        100,
        "SKILLCONSOLE_UPLOAD_MAX_ZIP_COMPRESSION_RATIO",
        issues,
      ),
    },
    ...(staticRoot ? { staticRoot } : {}),
  }

  if (issues.length > 0) {
    throw new ConfigurationError(issues)
  }

  return config
}
