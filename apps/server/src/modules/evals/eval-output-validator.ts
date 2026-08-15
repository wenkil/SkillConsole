import { createHash } from "node:crypto"
import { lstat, readFile, realpath } from "node:fs/promises"
import path from "node:path"

import { DomainError } from "../../core/errors/domain-error.js"
import type {
  StoredEvalCase,
  StoredEvalFile,
} from "../../infrastructure/database/index.js"
import { assertEvalRelativePath, EvalStorage } from "./eval-storage.js"

type RawRecord = Record<string, unknown>

export interface ValidatedEvalOutput {
  readonly sourceSchemaVariant: "assertions" | "expectations" | "mixed"
  readonly rawEvalsSha256: string
  readonly manifestHash: string
  readonly cases: readonly StoredEvalCase[]
  readonly files: readonly StoredEvalFile[]
  readonly totalBytes: number
}

export interface EvalOutputProvenance {
  readonly taskId: string
  readonly targetSnapshotId: string
  readonly promptContractVersion: string
  readonly configurationFingerprint: string
}

function validationError(code: string, message: string): DomainError {
  return new DomainError({ code, message, kind: "validation" })
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

function asRecord(value: unknown): RawRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as RawRecord)
    : null
}

function asText(value: unknown): string | null {
  if (typeof value !== "string") return null
  const normalized = value.trim()
  return normalized || null
}

function asTextArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((item) => {
    const text = asText(item)
    return text ? [text] : []
  })
}

function getMediaType(relativePath: string): string {
  const extension = path.posix.extname(relativePath).toLowerCase()
  return (
    {
      ".csv": "text/csv",
      ".html": "text/html",
      ".json": "application/json",
      ".md": "text/markdown",
      ".pdf": "application/pdf",
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".txt": "text/plain",
      ".yaml": "application/yaml",
      ".yml": "application/yaml",
    }[extension] ?? "application/octet-stream"
  )
}

function normalizeFileReference(value: string): string | null {
  const relativePath = value.startsWith("files/") ? value : `files/${value}`
  try {
    assertEvalRelativePath(relativePath)
    return relativePath
  } catch {
    return null
  }
}

function getAssertions(raw: RawRecord): {
  readonly assertions: readonly string[]
  readonly variant: "assertions" | "expectations" | "mixed"
} {
  const assertions = asTextArray(raw.assertions)
  const expectations = asTextArray(raw.expectations)
  return {
    assertions: assertions.length > 0 ? assertions : expectations,
    variant:
      assertions.length > 0 && expectations.length > 0
        ? "mixed"
        : assertions.length > 0
          ? "assertions"
          : "expectations",
  }
}

export class EvalOutputValidator {
  constructor(private readonly storage: EvalStorage) {}

  async validate(input: {
    readonly generationId: string
    readonly skillName: string
    readonly provenance: EvalOutputProvenance
  }): Promise<ValidatedEvalOutput> {
    const evalsPath = this.storage.getGenerationEvalsJsonPath(
      input.generationId,
    )
    let rawEvals: Buffer
    try {
      rawEvals = await readFile(evalsPath)
    } catch {
      throw validationError(
        "EVAL_OUTPUT_MISSING",
        "The generation task did not create evals.json.",
      )
    }

    let parsed: unknown
    try {
      parsed = JSON.parse(
        new TextDecoder("utf-8", { fatal: true }).decode(rawEvals),
      )
    } catch {
      throw validationError(
        "EVAL_OUTPUT_JSON_INVALID",
        "The generated evals.json is not valid UTF-8 JSON.",
      )
    }

    const root = asRecord(parsed)
    const rawCases = Array.isArray(root?.evals) ? root.evals : []
    const outputRoot = this.storage.getGenerationOutputPath(input.generationId)
    let realOutputRoot: string | null = null
    try {
      realOutputRoot = await realpath(outputRoot)
    } catch {
      // A valid JSON result without an output directory simply has no usable files.
    }

    const filesByPath = new Map<string, StoredEvalFile>()
    const variants = new Set<"assertions" | "expectations" | "mixed">()
    const externalIds = new Set<number>()
    const cases: StoredEvalCase[] = []

    for (const rawCase of rawCases) {
      const candidate = asRecord(rawCase)
      if (!candidate) continue
      const externalId = candidate.id
      const name = asText(candidate.name)
      const prompt = asText(candidate.prompt)
      const expectedOutput = asText(candidate.expected_output)
      if (
        !Number.isSafeInteger(externalId) ||
        (externalId as number) < 1 ||
        externalIds.has(externalId as number) ||
        !name ||
        !prompt ||
        !expectedOutput
      ) {
        continue
      }

      const caseFiles: string[] = []
      for (const declaredFile of asTextArray(candidate.files)) {
        const relativePath = normalizeFileReference(declaredFile)
        if (!relativePath || caseFiles.includes(relativePath)) continue
        const file = await this.readDisplayableFile(
          input.generationId,
          relativePath,
          realOutputRoot,
        )
        if (!file) continue
        filesByPath.set(relativePath, file)
        caseFiles.push(relativePath)
      }

      const normalized = getAssertions(candidate)
      variants.add(normalized.variant)
      externalIds.add(externalId as number)
      cases.push({
        externalId: externalId as number,
        name,
        prompt,
        expectedOutput,
        assertions: normalized.assertions,
        files: caseFiles,
      })
    }

    const files = [...filesByPath.values()].sort((left, right) =>
      left.relativePath.localeCompare(right.relativePath),
    )
    const rawEvalsSha256 = sha256(rawEvals)
    const manifestHash = sha256(
      JSON.stringify({
        schemaVersion: 1,
        ...input.provenance,
        skillName: input.skillName,
        rawEvalsSha256,
        cases,
        files,
      }),
    )
    return {
      sourceSchemaVariant:
        variants.size === 1
          ? ([...variants][0] ?? "mixed")
          : "mixed",
      rawEvalsSha256,
      manifestHash,
      cases,
      files,
      totalBytes:
        rawEvals.byteLength +
        files.reduce((total, file) => total + file.byteSize, 0),
    }
  }

  private async readDisplayableFile(
    generationId: string,
    relativePath: string,
    realOutputRoot: string | null,
  ): Promise<StoredEvalFile | null> {
    if (!realOutputRoot) return null
    try {
      const absolutePath = this.storage.getGenerationFilePath(
        generationId,
        relativePath,
      )
      const stat = await lstat(absolutePath)
      if (!stat.isFile() || stat.isSymbolicLink()) return null
      const actualPath = await realpath(absolutePath)
      const relativeToOutput = path.relative(realOutputRoot, actualPath)
      if (
        relativeToOutput === ".." ||
        relativeToOutput.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToOutput)
      ) {
        return null
      }
      const content = await readFile(absolutePath)
      return {
        relativePath,
        sha256: sha256(content),
        byteSize: content.byteLength,
        mediaTypeHint: getMediaType(relativePath),
        contentKind: content.subarray(0, 8 * 1024).includes(0)
          ? "binary"
          : "text",
      }
    } catch {
      return null
    }
  }
}
