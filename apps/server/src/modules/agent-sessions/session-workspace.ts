import path from "node:path"
import { createHash } from "node:crypto"
import { constants } from "node:fs"
import {
  chmod,
  cp,
  copyFile,
  mkdir,
  readFile,
} from "node:fs/promises"

import type { PermissionMode } from "@anthropic-ai/claude-agent-sdk"

const sensitiveSettingName =
  /(?:api[_-]?key|auth|authorization|credential|password|secret|token)/i

const permissionModes = new Set<PermissionMode>([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  "dontAsk",
  "auto",
])

export interface InstalledAgentSessionSettings {
  readonly settingsPath: string
  readonly redactedValues: readonly string[]
  readonly defaultPermissionMode?: PermissionMode
}

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
    const isLegacyEvalWorkspace =
      segments.length === 3 &&
      segments[0] === "eval-generations" &&
      segments[2] === "workspace"
    const isAttemptEvalWorkspace =
      segments.length === 5 &&
      segments[0] === "eval-generations" &&
      segments[2] === "attempts" &&
      segments[4] === "workspace"
    const isEvalWorkspace = isLegacyEvalWorkspace || isAttemptEvalWorkspace
    const isTestRunWorkspace =
      segments.length === 5 &&
      segments[0] === "test-runs" &&
      segments[2] === "cases" &&
      (segments[4] === "workspace" || segments[4] === "assertion")
    const isTestRunSkillScoreWorkspace =
      segments.length === 3 &&
      segments[0] === "test-runs" &&
      segments[2] === "skill-score"
    const internalIdPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
    if (
      (!isSessionWorkspace &&
        !isEvalWorkspace &&
        !isTestRunWorkspace &&
        !isTestRunSkillScoreWorkspace) ||
      !internalIdPattern.test(segments[1] ?? "") ||
      (isAttemptEvalWorkspace &&
        !internalIdPattern.test(segments[3] ?? "")) ||
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
  ): Promise<InstalledAgentSessionSettings> {
    const destination = this.getWorkspaceSettingsPath(absoluteWorkspacePath)

    try {
      await mkdir(path.dirname(destination), { recursive: true })
      await copyFile(
        this.claudeSettingsPath,
        destination,
        constants.COPYFILE_EXCL,
      )
      await chmod(destination, 0o600)
      return await this.readInstalledSettings(absoluteWorkspacePath)
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
  }

  async readInstalledSettings(
    absoluteWorkspacePath: string,
  ): Promise<InstalledAgentSessionSettings> {
    const settingsPath = this.getWorkspaceSettingsPath(absoluteWorkspacePath)
    try {
      const rawSettings = await readFile(settingsPath, "utf8")
      const redactedValues = [rawSettings]
      let defaultPermissionMode: PermissionMode | undefined

      let parsed: {
          readonly permissions?: { readonly defaultMode?: unknown }
        } | null = null
      try {
        parsed = JSON.parse(rawSettings) as {
          readonly permissions?: { readonly defaultMode?: unknown }
        }
      } catch {
        // Claude Agent SDK owns validation for settings outside the explicit
        // permission mode that SkillConsole forwards.
      }
      if (parsed) {
        const configuredMode = parsed.permissions?.defaultMode
        if (configuredMode !== undefined) {
          if (
            typeof configuredMode !== "string" ||
            !permissionModes.has(configuredMode as PermissionMode)
          ) {
            throw new Error(
              "Claude permissions.defaultMode is not a supported permission mode.",
            )
          }
          defaultPermissionMode = configuredMode as PermissionMode
        }
        collectSensitiveSettingValues(parsed, redactedValues)
      }

      return {
        settingsPath,
        redactedValues: [
          ...new Set(redactedValues.filter((value) => value.length > 0)),
        ],
        ...(defaultPermissionMode ? { defaultPermissionMode } : {}),
      }
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
  }

  async readRedactedValues(
    absoluteWorkspacePath: string,
  ): Promise<readonly string[]> {
    return (await this.readInstalledSettings(absoluteWorkspacePath)).redactedValues
  }

  async installRuntimeSkills(
    absoluteWorkspacePath: string,
    claudeConfigDir: string,
    skillNames: readonly string[],
  ): Promise<void> {
    const sourceRoot = path.join(absoluteWorkspacePath, ".claude", "skills")
    const destinationRoot = path.join(claudeConfigDir, "skills")

    try {
      for (const skillName of skillNames) {
        if (!/^[a-z0-9][a-z0-9-]*$/u.test(skillName)) {
          throw new Error("Agent runtime Skill name is invalid.")
        }
        const source = path.resolve(sourceRoot, skillName)
        const destination = path.resolve(destinationRoot, skillName)
        if (
          path.relative(sourceRoot, source).startsWith(`..${path.sep}`) ||
          path.relative(destinationRoot, destination).startsWith(`..${path.sep}`)
        ) {
          throw new Error("Agent runtime Skill path escaped its controlled root.")
        }
        await mkdir(destinationRoot, { recursive: true, mode: 0o700 })
        await cp(source, destination, {
          recursive: true,
          force: false,
          errorOnExist: true,
        })
      }
    } catch (error) {
      throw new AgentSessionWorkspaceConfigurationError({ cause: error })
    }
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
