import path from "node:path"

import type {
  AgentRuntimeToolPermissionHandler,
  AgentRuntimeToolPermissionResult,
} from "../agent-sessions/agent-session.domain.js"

export const testRunToolPermissionPolicyVersion =
  "skill-test-tool-policy-v2" as const

const readOnlyTools = new Set(["Read", "Glob", "Grep", "Skill"])
const fileWriteTools = new Set(["Write", "Edit", "NotebookEdit"])
const absolutePathPattern =
  /(?:^|[\s("'=])((?:\/(?:[^\s;&|"'<>]*)?|[A-Za-z]:[\\/][^\s;&|"'<>]*))/g
const redirectTargetPattern = />>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g
const shellExpansionOrControlPattern =
  /(?:\r|\n|[;&|`]|\$|%[A-Za-z_][A-Za-z0-9_]*%|(?:^|\s)~(?:[\\/]|\s|$))/u
const unsupportedShellRedirectionPattern = /(?:<|>\s*\()/u
const pandocExternalExecutionPattern =
  /(?:^|\s)(?:--(?:lua-)?filter(?:=|\s)|-(?:F|L)(?:=|\s)|--pdf-engine(?:=|\s))/iu
const pandocOutputPattern =
  /(?:^|\s)(?:-o|--output)(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/giu

export interface TestRunToolPermissionPolicyOptions {
  readonly skillName: string
  readonly bundledScripts: readonly string[]
}

function allow(): AgentRuntimeToolPermissionResult {
  return { behavior: "allow" }
}

function deny(message: string): AgentRuntimeToolPermissionResult {
  return { behavior: "deny", message, interrupt: false }
}

function isWithin(root: string, target: string): boolean {
  const relative = path.relative(root, target)
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
}

function resolveCandidate(root: string, candidate: string): string {
  return path.resolve(root, candidate)
}

function pathFromInput(input: Readonly<Record<string, unknown>>): string | null {
  for (const key of ["file_path", "path"]) {
    const value = input[key]
    if (typeof value === "string" && value.trim().length > 0) {
      return value
    }
  }
  return null
}

function isProtectedWorkspacePath(candidate: string): boolean {
  return candidate
    .replaceAll("\\", "/")
    .replace(/^\.\//u, "")
    .toLowerCase()
    .endsWith(".claude/settings.json")
}

function hasOutsidePath(
  root: string,
  candidate: string | undefined,
): boolean {
  if (!candidate) return false
  return !isWithin(root, resolveCandidate(root, candidate))
}

function hasOutsideAbsolutePath(root: string, command: string): boolean {
  for (const match of command.matchAll(absolutePathPattern)) {
    const candidate = match[1]
    if (!candidate) continue
    if (!isWithin(root, resolveCandidate(root, candidate))) return true
  }
  return false
}

function hasOutsideRedirect(root: string, command: string): boolean {
  for (const match of command.matchAll(redirectTargetPattern)) {
    const candidate = match[1] ?? match[2] ?? match[3]
    if (
      candidate &&
      !isWithin(
        path.join(root, "outputs"),
        resolveCandidate(root, candidate),
      )
    ) {
      return true
    }
  }
  return false
}

export function createTestRunToolPermissionPolicy(
  workspacePath: string,
  options: TestRunToolPermissionPolicyOptions,
): AgentRuntimeToolPermissionHandler {
  const root = path.resolve(workspacePath)
  const outputsRoot = path.join(root, "outputs")
  const installedScripts = new Set(
    options.bundledScripts.map((relativePath) =>
      `.claude/skills/${options.skillName}/${relativePath}`
        .replaceAll("\\", "/")
        .replace(/^\.\//u, ""),
    ),
  )

  return async (toolName, input, context) => {
    if (context.blockedPath && hasOutsidePath(root, context.blockedPath)) {
      return deny(
        "The test task may only access files inside its controlled workspace.",
      )
    }

    if (readOnlyTools.has(toolName)) {
      const candidate = pathFromInput(input)
      if (candidate && isProtectedWorkspacePath(candidate)) {
        return deny("Claude runtime settings are not readable by test tasks.")
      }
      if (hasOutsidePath(root, candidate ?? undefined)) {
        return deny(
          "The test task may only read files inside its controlled workspace.",
        )
      }
      return allow()
    }

    if (fileWriteTools.has(toolName)) {
      const candidate = pathFromInput(input)
      if (!candidate || !isWithin(outputsRoot, resolveCandidate(root, candidate))) {
        return deny("Test task writes are limited to the outputs directory.")
      }
      return allow()
    }

    if (toolName === "Bash") {
      const command = input.command
      if (typeof command !== "string" || command.trim().length === 0) {
        return deny("The test task must provide a non-empty shell command.")
      }
      if (shellExpansionOrControlPattern.test(command)) {
        return deny(
          "Shell expansion, command chaining, and environment access are not allowed in a Skill test workspace.",
        )
      }
      if (unsupportedShellRedirectionPattern.test(command)) {
        return deny(
          "Input and process-substitution redirects are not enabled in Skill test commands.",
        )
      }
      if (command.includes("..") || hasOutsideAbsolutePath(root, command)) {
        return deny("The shell command may not escape the controlled workspace.")
      }
      if (hasOutsideRedirect(root, command)) {
        return deny("Shell redirects are limited to the outputs directory.")
      }
      const executable = command.trimStart().match(/^([^\s]+)/u)?.[1]
      if (!executable || !/^(?:python3?(?:\.exe)?|pandoc(?:\.exe)?)$/iu.test(executable)) {
        return deny(
          "Only declared bundled Python scripts and Pandoc are enabled for test execution.",
        )
      }
      if (/^python3?(?:\.exe)?$/iu.test(executable)) {
        if (/(?:^|\s)-(?:c|m)(?:\s|$)/u.test(command)) {
          return deny("Inline Python and module execution are not enabled.")
        }
        const scriptMatch = command
          .slice(executable.length)
          .trimStart()
          .match(/^(?:(?:-(?:B|u|I|s|S|E))\s+)*(?:"([^"]+)"|'([^']+)'|(\S+))/u)
        const scriptPath = (
          scriptMatch?.[1] ??
          scriptMatch?.[2] ??
          scriptMatch?.[3] ??
          ""
        )
          .replaceAll("\\", "/")
          .replace(/^\.\//u, "")
        if (!installedScripts.has(scriptPath)) {
          return deny(
            "Python may only run a bundled script declared by the tested Skill.",
          )
        }
      } else {
        if (pandocExternalExecutionPattern.test(command)) {
          return deny(
            "Pandoc filters and external engines are not enabled in Skill test commands.",
          )
        }
        for (const match of command.matchAll(pandocOutputPattern)) {
          const outputPath = match[1] ?? match[2] ?? match[3]
          if (
            outputPath &&
            !isWithin(outputsRoot, resolveCandidate(root, outputPath))
          ) {
            return deny(
              "Pandoc output files are limited to the outputs directory.",
            )
          }
        }
      }
      return allow()
    }

    return deny(`The ${toolName} tool is not enabled for Skill test execution.`)
  }
}
