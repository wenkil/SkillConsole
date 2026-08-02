import path from "node:path"

import type {
  AgentRuntimeToolPermissionHandler,
  AgentRuntimeToolPermissionResult,
} from "../agent-sessions/agent-session.domain.js"

const readOnlyTools = new Set(["Read", "Glob", "Grep", "Skill"])
const fileWriteTools = new Set(["Write", "Edit", "NotebookEdit"])
const blockedShellCommands =
  /\b(?:rm|rmdir|del|erase|sudo|su|chmod|chown|mkfs|kill|curl|wget|git|npm|pnpm|yarn|powershell|pwsh|bash|zsh|fish)\b/i
const mutatingShellCommands = /\b(?:python3?|node|pandoc|mkdir|touch|tee)\b/i
const absolutePathPattern =
  /(?:^|[\s("'=])((?:\/|[A-Za-z]:[\\/])[^\s;&|"'<>]+)/g
const redirectTargetPattern = />>?\s*(?:"([^"]+)"|'([^']+)'|([^\s;&|]+))/g

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
    if (
      candidate.startsWith("/usr/") ||
      candidate.startsWith("/bin/") ||
      candidate.startsWith("/lib/") ||
      candidate.startsWith("/dev/") ||
      candidate.startsWith("/tmp/") ||
      candidate.startsWith("/proc/") ||
      candidate.startsWith("/sys/")
    ) {
      continue
    }
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
): AgentRuntimeToolPermissionHandler {
  const root = path.resolve(workspacePath)
  const outputsRoot = path.join(root, "outputs")

  return async (toolName, input, context) => {
    if (context.blockedPath && hasOutsidePath(root, context.blockedPath)) {
      return deny(
        "The test task may only access files inside its controlled workspace.",
      )
    }

    if (readOnlyTools.has(toolName)) {
      const candidate = pathFromInput(input)
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
      if (blockedShellCommands.test(command)) {
        return deny(
          "This shell command is not allowed in a Skill test workspace.",
        )
      }
      if (command.includes("..") || hasOutsideAbsolutePath(root, command)) {
        return deny("The shell command may not escape the controlled workspace.")
      }
      if (hasOutsideRedirect(root, command)) {
        return deny("Shell redirects are limited to the outputs directory.")
      }
      if (
        mutatingShellCommands.test(command) &&
        !/\boutputs[\\/]/i.test(command)
      ) {
        return deny(
          "Commands that can create files must target the outputs directory.",
        )
      }
      return allow()
    }

    return deny(`The ${toolName} tool is not enabled for Skill test execution.`)
  }
}
