import path from "node:path"
import { constants } from "node:fs"
import {
  chmod,
  copyFile,
  mkdir,
  readFile,
} from "node:fs/promises"

const sensitiveSettingName =
  /(?:api[_-]?key|auth|authorization|credential|password|secret|token)/i

export class AgentSessionWorkspaceConfigurationError extends Error {
  constructor(options?: ErrorOptions) {
    super("Claude workspace settings could not be prepared.", options)
    this.name = "AgentSessionWorkspaceConfigurationError"
  }
}

function collectSensitiveSettingValues(
  value: unknown,
  values: string[],
  sensitiveContext = false,
): void {
  if (Array.isArray(value)) {
    for (const nestedValue of value) {
      if (typeof nestedValue === "string" && sensitiveContext) {
        values.push(nestedValue)
      } else {
        collectSensitiveSettingValues(
          nestedValue,
          values,
          sensitiveContext,
        )
      }
    }
    return
  }

  if (!value || typeof value !== "object") return

  for (const [key, nestedValue] of Object.entries(value)) {
    const nestedSensitiveContext =
      sensitiveContext || key === "env" || sensitiveSettingName.test(key)
    if (
      nestedSensitiveContext &&
      typeof nestedValue === "string" &&
      nestedValue.length > 0
    ) {
      values.push(nestedValue)
    } else {
      collectSensitiveSettingValues(
        nestedValue,
        values,
        nestedSensitiveContext,
      )
    }
  }
}

export class AgentSessionWorkspaceStore {
  private readonly sessionsRoot: string

  constructor(
    private readonly dataRoot: string,
    private readonly claudeSettingsPath: string,
  ) {
    this.sessionsRoot = path.resolve(dataRoot, "agent-sessions")
  }

  getLocator(sessionId: string): string {
    return path.posix.join("agent-sessions", sessionId, "workspace")
  }

  resolve(locator: string): string {
    const absolutePath = path.resolve(
      this.dataRoot,
      ...locator.split("/"),
    )
    const relativeToRoot = path.relative(this.sessionsRoot, absolutePath)

    if (
      relativeToRoot === "" ||
      relativeToRoot.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relativeToRoot)
    ) {
      throw new Error("Agent session workspace escaped the controlled root.")
    }

    return absolutePath
  }

  async prepare(sessionId: string): Promise<{
    readonly locator: string
    readonly absolutePath: string
  }> {
    const locator = this.getLocator(sessionId)
    const absolutePath = this.resolve(locator)
    await mkdir(path.join(absolutePath, ".claude"), { recursive: true })
    return { locator, absolutePath }
  }

  async installSettings(
    absoluteWorkspacePath: string,
  ): Promise<readonly string[]> {
    const destination = this.getWorkspaceSettingsPath(absoluteWorkspacePath)

    try {
      await copyFile(
        this.claudeSettingsPath,
        destination,
        constants.COPYFILE_EXCL,
      )
      await chmod(destination, 0o600)
      return await this.readRedactedValues(absoluteWorkspacePath)
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
  }

  async readRedactedValues(
    absoluteWorkspacePath: string,
  ): Promise<readonly string[]> {
    try {
      const rawSettings = await readFile(
        this.getWorkspaceSettingsPath(absoluteWorkspacePath),
        "utf8",
      )
      const values = [rawSettings]

      try {
        collectSensitiveSettingValues(JSON.parse(rawSettings), values)
      } catch {
        // Claude Agent SDK owns settings validation. The raw file remains
        // redacted even when it is not valid JSON.
      }

      return [...new Set(values.filter((value) => value.length > 0))]
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
  }

  private getWorkspaceSettingsPath(absoluteWorkspacePath: string): string {
    return path.join(absoluteWorkspacePath, ".claude", "settings.json")
  }
}
