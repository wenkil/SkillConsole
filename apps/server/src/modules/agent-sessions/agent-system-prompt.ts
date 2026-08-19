import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import path from "node:path"

export const agentSystemPromptRoles = [
  "generic-agent",
  "eval-generation",
  "test-run-execution",
  "test-run-execution-required-skill",
  "test-run-execution-no-skill",
  "test-run-grader",
  "test-report-analyzer",
] as const

export type AgentSystemPromptRole =
  (typeof agentSystemPromptRoles)[number]

const promptFileNames: Readonly<Record<AgentSystemPromptRole, string>> = {
  "generic-agent": "generic-agent.system.md",
  "eval-generation": "eval-generation.system.md",
  "test-run-execution": "test-run-execution.system.md",
  "test-run-execution-required-skill":
    "test-run-execution-required-skill.system.md",
  "test-run-execution-no-skill":
    "test-run-execution-no-skill.system.md",
  "test-run-grader": "test-run-grader.system.md",
  "test-report-analyzer": "test-report-analyzer.system.md",
}

export interface AgentSystemPrompt {
  readonly role: AgentSystemPromptRole
  readonly fileName: string
  readonly absolutePath: string
  readonly content: string
  readonly sha256: string
  readonly version: string
}

export class AgentSystemPromptStore {
  private readonly root: string

  constructor(root: string) {
    this.root = path.resolve(root)
  }

  async load(role: AgentSystemPromptRole): Promise<AgentSystemPrompt> {
    const fileName = promptFileNames[role]
    const absolutePath = path.resolve(this.root, fileName)
    const relative = path.relative(this.root, absolutePath)
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Agent System Prompt path escaped its configured root.")
    }

    const content = await readFile(absolutePath, "utf8")
    if (!content.trim()) {
      throw new Error(`Agent System Prompt is empty: ${fileName}`)
    }
    const sha256 = createHash("sha256").update(content, "utf8").digest("hex")
    return {
      role,
      fileName,
      absolutePath,
      content,
      sha256,
      version: `${fileName}@sha256:${sha256}`,
    }
  }
}
