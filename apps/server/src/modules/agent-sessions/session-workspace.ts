import path from "node:path"
import { createHash } from "node:crypto"
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
  private readonly evalGenerationsRoot: string
  private readonly testRunsRoot: string

  constructor(
    private readonly dataRoot: string,
    private readonly claudeSettingsPath: string,
  ) {
    this.sessionsRoot = path.resolve(dataRoot, "agent-sessions")
    this.evalGenerationsRoot = path.resolve(dataRoot, "eval-generations")
    this.testRunsRoot = path.resolve(dataRoot, "test-runs")
  }

  getLocator(sessionId: string): string {
    return path.posix.join("agent-sessions", sessionId, "workspace")
  }

  resolve(locator: string): string {
    const segments = locator.split("/")
    const isSessionWorkspace =
      segments.length === 3 &&
      segments[0] === "agent-sessions" &&
      segments[2] === "workspace"
    const isEvalWorkspace =
      segments.length === 3 &&
      segments[0] === "eval-generations" &&
      segments[2] === "workspace"
    const isTestRunWorkspace =
      segments.length === 5 &&
      segments[0] === "test-runs" &&
      segments[2] === "cases" &&
      (segments[4] === "workspace" || segments[4] === "grading")
    const internalIdPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (
      (!isSessionWorkspace &&
        !isEvalWorkspace &&
        !isTestRunWorkspace) ||
      !internalIdPattern.test(segments[1] ?? "") ||
      (isTestRunWorkspace &&
        !internalIdPattern.test(segments[3] ?? ""))
    ) {
      throw new Error("Agent session workspace locator is invalid.")
    }

    const absolutePath = path.resolve(
      this.dataRoot,
      ...segments,
    )
    const controlledRoot = isSessionWorkspace
      ? this.sessionsRoot
      : isEvalWorkspace
        ? this.evalGenerationsRoot
        : this.testRunsRoot
    const relativeToRoot = path.relative(controlledRoot, absolutePath)

    if (
      relativeToRoot === "" ||
      relativeToRoot === ".." ||
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
    return this.readSettingsRedactedValues(
      this.getWorkspaceSettingsPath(absoluteWorkspacePath),
    )
  }

  async readSourceRedactedValues(): Promise<readonly string[]> {
    return this.readSettingsRedactedValues(this.claudeSettingsPath)
  }

  private async readSettingsRedactedValues(
    settingsPath: string,
  ): Promise<readonly string[]> {
    try {
      const rawSettings = await readFile(settingsPath, "utf8")
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

  async assertSettingsFingerprint(
    absoluteWorkspacePath: string,
    expectedFingerprint: string,
  ): Promise<void> {
    try {
      const content = await readFile(
        this.getWorkspaceSettingsPath(absoluteWorkspacePath),
      )
      const actualFingerprint = createHash("sha256")
        .update(content)
        .digest("hex")
      if (actualFingerprint !== expectedFingerprint) {
        throw new Error("Claude settings changed during task preparation.")
      }
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
  }

  async assertSourceSettingsFingerprint(
    expectedFingerprint: string,
  ): Promise<void> {
    try {
      const content = await readFile(this.claudeSettingsPath)
      const actualFingerprint = createHash("sha256")
        .update(content)
        .digest("hex")
      if (actualFingerprint !== expectedFingerprint) {
        throw new Error("Claude settings changed during task preparation.")
      }
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
  }

  private getWorkspaceSettingsPath(absoluteWorkspacePath: string): string {
    return path.join(absoluteWorkspacePath, ".claude", "settings.json")
  }
}
