import type {
  AssertionResultStatus,
  StoredAssertionEvidence,
} from "../../infrastructure/database/index.js"

export type TestRunGraderProtocolErrorCode =
  | "TEST_RUN_GRADER_JSON_INVALID"
  | "TEST_RUN_GRADER_SCHEMA_INVALID"
  | "TEST_RUN_GRADER_EVIDENCE_INVALID"

export class TestRunGraderProtocolError extends Error {
  readonly code: TestRunGraderProtocolErrorCode

  constructor(
    code: TestRunGraderProtocolErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options)
    this.name = "TestRunGraderProtocolError"
    this.code = code
  }
}

export interface ParsedEvidenceAnchor {
  readonly source: "assistant_output" | "artifact"
  readonly reference: string
  readonly startLine: number
  readonly endLine: number
}

export interface ParsedAssertionResult {
  readonly assertionIndex: number
  readonly status: Exclude<AssertionResultStatus, "NOT_EVALUATED">
  readonly reason: string
  readonly evidence: readonly ParsedEvidenceAnchor[]
}

export interface ResolvedAssertionResult
  extends Omit<ParsedAssertionResult, "evidence"> {
  readonly evidence: readonly StoredAssertionEvidence[]
}

function splitEvidenceLines(content: string): readonly string[] {
  return content.split(/\r\n|\n|\r/)
}

export function formatEvidenceWithLineNumbers(content: string): string {
  return splitEvidenceLines(content)
    .map((line, index) => `L${index + 1}: ${line}`)
    .join("\n")
}

function invalidEvidence(message: string): never {
  throw new TestRunGraderProtocolError(
    "TEST_RUN_GRADER_EVIDENCE_INVALID",
    message,
  )
}

export function resolveEvidenceAnchors(
  results: readonly ParsedAssertionResult[],
  finalOutput: string,
  artifacts: readonly {
    readonly relativePath: string
    readonly content: string | null
  }[],
): readonly ResolvedAssertionResult[] {
  const artifactsByPath = new Map(
    artifacts.map((artifact) => [artifact.relativePath, artifact]),
  )

  return results.map((result) => ({
    ...result,
    evidence: result.evidence.map((anchor) => {
      if (
        !Number.isSafeInteger(anchor.startLine) ||
        !Number.isSafeInteger(anchor.endLine) ||
        anchor.startLine < 1 ||
        anchor.endLine < anchor.startLine
      ) {
        return invalidEvidence(
          "The grader cited an invalid evidence line range.",
        )
      }
      let content: string
      if (anchor.source === "assistant_output") {
        if (anchor.reference !== "final-output") {
          return invalidEvidence(
            "The grader cited an unknown assistant output reference.",
          )
        }
        content = finalOutput
      } else {
        const artifact = artifactsByPath.get(anchor.reference)
        if (!artifact || artifact.content === null) {
          return invalidEvidence(
            "The grader cited an unavailable text Artifact.",
          )
        }
        content = artifact.content
      }

      const lines = splitEvidenceLines(content)
      if (anchor.endLine > lines.length) {
        return invalidEvidence(
          "The grader cited an evidence line range outside the source.",
        )
      }
      const excerpt = lines
        .slice(anchor.startLine - 1, anchor.endLine)
        .join("\n")
      if (excerpt.length > 4_000) {
        return invalidEvidence(
          "The grader cited an evidence line range that is too large.",
        )
      }

      return {
        source: anchor.source,
        reference: `${anchor.reference}#L${anchor.startLine}-L${anchor.endLine}`,
        excerpt,
      }
    }),
  }))
}
