import { existsSync } from "node:fs"
import path from "node:path"

const transportSettingNames = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_MODEL",
  "CLAUDE_CODE_OAUTH_TOKEN",
])

const redactedTransportSettingNames = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "CLAUDE_CODE_OAUTH_TOKEN",
])

const processRuntimeNames = [
  "PATHEXT",
  "SystemRoot",
  "WINDIR",
  "COMSPEC",
  "LANG",
  "LC_ALL",
  "NODE_EXTRA_CA_CERTS",
] as const

const permittedRuntimeExecutables =
  process.platform === "win32"
    ? ["python.exe", "python3.exe", "pandoc.exe", "cmd.exe"]
    : [
        "python",
        "python3",
        "pandoc",
        "sh",
        "bwrap",
        "socat",
        "sandbox-exec",
      ]

function controlledRuntimePath(
  processEnvironment: NodeJS.ProcessEnv,
): string | null {
  const rawPath = processEnvironment.PATH ?? processEnvironment.Path ?? ""
  const nodeDirectory = path.dirname(process.execPath)
  const candidates = [nodeDirectory, ...rawPath.split(path.delimiter)]
  const directories = candidates
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map((candidate) => path.resolve(candidate))
    .filter((candidate) => path.parse(candidate).root !== candidate)
    .filter(
      (candidate) =>
        candidate === path.resolve(nodeDirectory) ||
        permittedRuntimeExecutables.some((executable) =>
          existsSync(path.join(candidate, executable)),
        ),
    )
  const unique = [...new Set(directories)]
  return unique.length > 0 ? unique.join(path.delimiter) : null
}

export interface TestRunRuntimeEnvironment {
  readonly values: Readonly<Record<string, string | undefined>>
  readonly sensitiveValues: readonly string[]
  readonly protectedNames: readonly string[]
}

export function buildTestRunRuntimeEnvironment(
  settings: Buffer,
  processEnvironment: NodeJS.ProcessEnv = process.env,
): TestRunRuntimeEnvironment {
  const values: Record<string, string | undefined> = {}
  const protectedNames = new Set<string>()
  const runtimePath = controlledRuntimePath(processEnvironment)
  if (runtimePath) values.PATH = runtimePath
  for (const name of processRuntimeNames) {
    const value = processEnvironment[name]
    if (value) values[name] = value
  }

  try {
    const parsed = JSON.parse(settings.toString("utf8")) as {
      readonly model?: unknown
      readonly env?: Readonly<Record<string, unknown>>
    }
    for (const [name, rawValue] of Object.entries(parsed.env ?? {})) {
      protectedNames.add(name)
      if (
        transportSettingNames.has(name) &&
        typeof rawValue === "string" &&
        rawValue.length > 0
      ) {
        values[name] = rawValue
      }
    }
    if (
      values.ANTHROPIC_MODEL === undefined &&
      typeof parsed.model === "string" &&
      parsed.model.trim().length > 0
    ) {
      values.ANTHROPIC_MODEL = parsed.model.trim()
    }
  } catch {
    // Settings validation remains owned by the Agent Session preparation path.
  }

  return {
    values,
    sensitiveValues: [
      ...new Set(
        Object.entries(values)
          .filter(([name]) => redactedTransportSettingNames.has(name))
          .map(([, value]) => value)
          .filter(
            (value): value is string =>
              typeof value === "string" && value.length >= 4,
          ),
      ),
    ],
    protectedNames: [...protectedNames].sort(),
  }
}

export function forTestRunWorkspace(
  environment: TestRunRuntimeEnvironment,
  workspacePath: string,
): TestRunRuntimeEnvironment {
  const temporaryPath = path.join(workspacePath, "outputs", ".tmp")
  const values = {
    ...environment.values,
    HOME: workspacePath,
    USERPROFILE: workspacePath,
    TMP: temporaryPath,
    TEMP: temporaryPath,
    TMPDIR: temporaryPath,
    PYTHONDONTWRITEBYTECODE: "1",
    PYTHONNOUSERSITE: "1",
  }
  return {
    values,
    sensitiveValues: environment.sensitiveValues,
    protectedNames: environment.protectedNames,
  }
}
