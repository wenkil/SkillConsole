import { createHash } from "node:crypto"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"

import type {
  AssertionResultStatus,
  StoredAssertionEvidence,
} from "../../infrastructure/database/index.js"

const graderPath = fileURLToPath(
  new URL(
    "../../../resources/skills/skill-creator/agents/grader.md",
    import.meta.url,
  ),
)
const pinnedGraderHash =
  "6ec1c6950fcafa3e00d5e845b2498c5ea3e8f7f012bd9c6abad25425f3ee619c"
const allowedStatuses = new Set<AssertionResultStatus>([
  "PASSED",
  "FAILED",
  "INSUFFICIENT_EVIDENCE",
])
const allowedEvidenceSources = new Set([
  "assistant_output",
  "artifact",
])

export interface ParsedAssertionResult {
  readonly assertionIndex: number
  readonly status: Exclude<AssertionResultStatus, "NOT_EVALUATED">
  readonly reason: string
  readonly evidence: readonly StoredAssertionEvidence[]
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function parseJson(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch (error) {
    throw new Error(
      "The grader response was not exactly one JSON object.",
      { cause: error },
    )
  }
}

export class TestRunScorer {
  private rubric: string | null = null

  async loadRubric(): Promise<string> {
    if (this.rubric) return this.rubric
    const content = await readFile(graderPath)
    const actualHash = createHash("sha256").update(content).digest("hex")
    if (actualHash !== pinnedGraderHash) {
      throw new Error("The pinned grader rubric failed its Hash check.")
    }
    this.rubric = new TextDecoder("utf-8", { fatal: true }).decode(content)
    return this.rubric
  }

  parse(
    response: string,
    assertions: readonly string[],
  ): readonly ParsedAssertionResult[] {
    const parsed = parseJson(response)
    if (!isRecord(parsed) || !Array.isArray(parsed.assertions)) {
      throw new Error("The grader response has an invalid root structure.")
    }
    if (parsed.assertions.length !== assertions.length) {
      throw new Error(
        "The grader response does not contain one result per assertion.",
      )
    }

    const results = parsed.assertions.map((rawResult) => {
      if (!isRecord(rawResult)) {
        throw new Error("A grader assertion result is invalid.")
      }
      const index = rawResult.index
      const status = rawResult.status
      const reason =
        typeof rawResult.reason === "string"
          ? rawResult.reason.trim()
          : ""
      if (
        !Number.isSafeInteger(index) ||
        typeof index !== "number" ||
        index < 0 ||
        index >= assertions.length ||
        typeof status !== "string" ||
        !allowedStatuses.has(status as AssertionResultStatus) ||
        !reason ||
        reason.length > 10_000 ||
        !Array.isArray(rawResult.evidence)
      ) {
        throw new Error("A grader assertion result failed validation.")
      }
      const evidence = rawResult.evidence.map((rawEvidence) => {
        if (!isRecord(rawEvidence)) {
          throw new Error("A grader evidence item is invalid.")
        }
        const source = rawEvidence.source
        const reference =
          typeof rawEvidence.reference === "string"
            ? rawEvidence.reference.trim()
            : ""
        const excerpt =
          typeof rawEvidence.excerpt === "string"
            ? rawEvidence.excerpt
            : rawEvidence.excerpt === null
              ? null
              : undefined
        if (
          typeof source !== "string" ||
          !allowedEvidenceSources.has(source) ||
          !reference ||
          reference.length > 512 ||
          (typeof excerpt === "string" && excerpt.length > 4_000) ||
          excerpt === undefined
        ) {
          throw new Error("A grader evidence item failed validation.")
        }
        return {
          source: source as "assistant_output" | "artifact",
          reference,
          excerpt,
        }
      })
      if (status !== "INSUFFICIENT_EVIDENCE" && evidence.length === 0) {
        throw new Error(
          "A conclusive grader result must cite concrete evidence.",
        )
      }
      return {
        assertionIndex: index,
        status: status as Exclude<
          AssertionResultStatus,
          "NOT_EVALUATED"
        >,
        reason,
        evidence,
      }
    })
    const indexes = new Set(results.map((result) => result.assertionIndex))
    if (
      indexes.size !== assertions.length ||
      assertions.some((_, index) => !indexes.has(index))
    ) {
      throw new Error("The grader response contains duplicate indexes.")
    }
    return [...results].sort(
      (left, right) => left.assertionIndex - right.assertionIndex,
    )
  }
}
