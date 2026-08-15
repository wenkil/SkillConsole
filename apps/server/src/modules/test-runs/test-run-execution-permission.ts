import path from "node:path"
import { realpath } from "node:fs/promises"

import type { CanUseTool } from "@anthropic-ai/claude-agent-sdk"

const writableTools = new Set(["Write", "Edit"])

function isWithinWorkspace(workspacePath: string, targetPath: string): boolean {
  const relative = path.relative(workspacePath, targetPath)
  return (
    relative === "" ||
    (!relative.startsWith("../") &&
      !relative.startsWith("..\\") &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  )
}

function denied(message: string) {
  return { behavior: "deny" as const, message }
}

async function nearestExistingPath(targetPath: string): Promise<string | null> {
  let candidate = targetPath
  while (true) {
    try {
      return await realpath(candidate)
    } catch (error) {
      if (
        !error ||
        typeof error !== "object" ||
        !("code" in error) ||
        error.code !== "ENOENT"
      ) {
        return null
      }
      const parent = path.dirname(candidate)
      if (parent === candidate) return null
      candidate = parent
    }
  }
}

/**
 * Allows the execution Agent to create or edit files anywhere in its own
 * prepared Case workspace. Paths outside that Case remain unavailable.
 */
export function createTestRunExecutionPermissionPolicy(
  workspacePath: string,
): CanUseTool {
  const root = path.resolve(workspacePath)

  return async (toolName, input) => {
    if (!writableTools.has(toolName)) {
      return denied("This test execution policy only approves file writes.")
    }

    const filePath = input.file_path
    if (typeof filePath !== "string" || filePath.trim().length === 0) {
      return denied("The file write did not include a valid file path.")
    }

    const target = path.resolve(root, filePath)
    if (!isWithinWorkspace(root, target)) {
      return denied("The file path is outside the current test Case workspace.")
    }
    const [realRoot, realTargetParent] = await Promise.all([
      realpath(root).catch(() => null),
      nearestExistingPath(target),
    ])
    if (
      !realRoot ||
      !realTargetParent ||
      !isWithinWorkspace(realRoot, realTargetParent)
    ) {
      return denied("The file path is outside the current test Case workspace.")
    }

    return { behavior: "allow" }
  }
}
