import type { UploadFolderIgnorePolicy } from "./upload-folder-ignore-policy.js"
import { createUploadFolderPathMatcher } from "./upload-folder-ignore-policy.js"

export interface DraftIgnoredPath {
  readonly relativePath: string
  readonly reason: "protected" | "skillconsoleignore" | "custom"
}

interface CompiledRule {
  readonly negated: boolean
  readonly expression: RegExp
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&")
}

function globToRegularExpression(pattern: string): string {
  let result = ""
  for (let index = 0; index < pattern.length; index += 1) {
    const character = pattern[index]
    if (character === "*") {
      if (pattern[index + 1] === "*") {
        result += ".*"
        index += 1
      } else {
        result += "[^/]*"
      }
    } else if (character === "?") {
      result += "[^/]"
    } else {
      result += escapeRegularExpression(character ?? "")
    }
  }
  return result
}

function compileRule(source: string): CompiledRule | null {
  const trimmed = source.trim()
  if (!trimmed || trimmed.startsWith("#")) return null

  const negated = trimmed.startsWith("!")
  let pattern = negated ? trimmed.slice(1) : trimmed
  if (!pattern) return null
  if (pattern.startsWith("\\#") || pattern.startsWith("\\!")) {
    pattern = pattern.slice(1)
  }

  const anchored = pattern.startsWith("/")
  if (anchored) pattern = pattern.slice(1)
  const directoryRule = pattern.endsWith("/")
  if (directoryRule) pattern = pattern.slice(0, -1)
  if (!pattern) return null

  const compiled = globToRegularExpression(pattern)
  const containsSlash = pattern.includes("/")
  const prefix = anchored || containsSlash ? "^" : "(?:^|/)"
  const suffix = directoryRule || !containsSlash ? "(?:/.*)?$" : "$"

  return {
    negated,
    expression: new RegExp(`${prefix}${compiled}${suffix}`),
  }
}

export function parseDraftIgnoreRules(source: string): readonly string[] {
  return source
    .replace(/^\uFEFF/, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"))
}

function evaluateRules(
  relativePath: string,
  sources: readonly string[],
): { readonly ignored: boolean; readonly matched: boolean } {
  let ignored = false
  let matched = false
  for (const source of sources) {
    const rule = compileRule(source)
    if (rule?.expression.test(relativePath)) {
      matched = true
      ignored = !rule.negated
    }
  }
  return { ignored, matched }
}

function isProtectedPath(
  relativePath: string,
  policyMatcher: (path: string) => boolean,
): boolean {
  return (
    relativePath
      .split("/")
      .some((segment) => segment.toLowerCase() === ".git") ||
    policyMatcher(relativePath)
  )
}

export function applyDraftFolderIgnoreRules(
  relativePaths: readonly string[],
  skillconsoleRules: readonly string[],
  customRules: readonly string[],
  policy: UploadFolderIgnorePolicy,
): {
  readonly includedPaths: readonly string[]
  readonly ignoredPaths: readonly DraftIgnoredPath[]
} {
  const includedPaths: string[] = []
  const ignoredPaths: DraftIgnoredPath[] = []
  const policyMatcher = createUploadFolderPathMatcher(policy)

  for (const relativePath of relativePaths) {
    if (isProtectedPath(relativePath, policyMatcher)) {
      ignoredPaths.push({ relativePath, reason: "protected" })
      continue
    }

    const ignoredByFile = evaluateRules(relativePath, skillconsoleRules)
    const ignoredByCombinedRules = evaluateRules(relativePath, [
      ...skillconsoleRules,
      ...customRules,
    ])
    const customEvaluation = evaluateRules(relativePath, customRules)

    if (ignoredByCombinedRules.ignored) {
      ignoredPaths.push({
        relativePath,
        reason:
          customEvaluation.matched && customEvaluation.ignored
            ? "custom"
            : ignoredByFile.ignored
              ? "skillconsoleignore"
              : "custom",
      })
    } else {
      includedPaths.push(relativePath)
    }
  }

  return { includedPaths, ignoredPaths }
}
