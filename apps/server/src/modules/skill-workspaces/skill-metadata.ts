import { readFile } from "node:fs/promises"

import { DomainError } from "../../core/errors/domain-error.js"

const skillNamePattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function unquoteYamlScalar(value: string): string {
  if (value.length < 2) return value
  const first = value[0]
  const last = value.at(-1)
  if (
    (first === '"' && last === '"') ||
    (first === "'" && last === "'")
  ) {
    return value.slice(1, -1)
  }
  return value
}

export function parseSkillName(markdown: string): string {
  const normalized = markdown.replace(/^\uFEFF/, "")
  const lines = normalized.split(/\r?\n/)
  if (lines[0]?.trim() !== "---") {
    throw new DomainError({
      code: "EVAL_TARGET_SKILL_METADATA_INVALID",
      message: "The target SKILL.md does not contain YAML frontmatter.",
      kind: "validation",
    })
  }

  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  )
  if (closingIndex < 0) {
    throw new DomainError({
      code: "EVAL_TARGET_SKILL_METADATA_INVALID",
      message: "The target SKILL.md frontmatter is not closed.",
      kind: "validation",
    })
  }

  const nameLines = lines
    .slice(1, closingIndex)
    .map((line) => /^name:\s*(.*?)\s*$/.exec(line))
    .filter((match): match is RegExpExecArray => Boolean(match))
  if (nameLines.length !== 1) {
    throw new DomainError({
      code: "EVAL_TARGET_SKILL_METADATA_INVALID",
      message: "The target SKILL.md must define one frontmatter name.",
      kind: "validation",
    })
  }

  const rawName = nameLines[0]?.[1]
  const name = unquoteYamlScalar(rawName?.trim() ?? "")
  if (
    name.length < 1 ||
    name.length > 64 ||
    !skillNamePattern.test(name)
  ) {
    throw new DomainError({
      code: "EVAL_TARGET_SKILL_NAME_INVALID",
      message:
        "The target Skill name must use 1 to 64 lowercase letters, digits, or hyphens.",
      kind: "validation",
    })
  }
  return name
}

export async function readSkillName(skillFilePath: string): Promise<string> {
  let content: Buffer
  try {
    content = await readFile(skillFilePath)
  } catch (error) {
    throw new DomainError({
      code: "EVAL_TARGET_SKILL_FILE_MISSING",
      message: "The target Snapshot does not contain a root SKILL.md.",
      kind: "validation",
      cause: error,
    })
  }

  let markdown: string
  try {
    markdown = new TextDecoder("utf-8", { fatal: true }).decode(content)
  } catch (error) {
    throw new DomainError({
      code: "EVAL_TARGET_SKILL_ENCODING_INVALID",
      message: "The target SKILL.md is not valid UTF-8.",
      kind: "validation",
      cause: error,
    })
  }
  return parseSkillName(markdown)
}
