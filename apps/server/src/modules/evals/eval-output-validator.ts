import { createHash } from "node:crypto"
import {
  lstat,
  readFile,
  realpath,
  writeFile,
} from "node:fs/promises"
import path from "node:path"

import { DomainError } from "../../core/errors/domain-error.js"
import type {
  StoredEvalCase,
  StoredEvalFile,
} from "../../infrastructure/database/index.js"
import { assertEvalRelativePath, EvalStorage } from "./eval-storage.js"

interface RawEvalCase {
  readonly id?: unknown
  readonly name?: unknown
  readonly prompt?: unknown
  readonly expected_output?: unknown
  readonly files?: unknown
  readonly assertions?: unknown
  readonly expectations?: unknown
}

interface RawEvalDocument {
  readonly evals?: unknown
}

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

function validationError(
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): DomainError {
  return new DomainError({
    code,
    message,
    kind: "validation",
    ...(details ? { details } : {}),
  })
}

function sha256(content: Buffer | string): string {
  return createHash("sha256").update(content).digest("hex")
}

function readBoundedString(
  value: unknown,
  field: string,
  maxLength: number,
  caseId: number,
): string {
  if (typeof value !== "string") {
    throw validationError(
      "EVAL_OUTPUT_SCHEMA_INVALID",
      `Eval ${caseId} has an invalid ${field} field.`,
      { caseId, field },
    )
  }
  const normalized = value.trim()
  if (!normalized || normalized.length > maxLength) {
    throw validationError(
      "EVAL_OUTPUT_SCHEMA_INVALID",
      `Eval ${caseId} has an invalid ${field} length.`,
      { caseId, field, maxLength },
    )
  }
  return normalized
}

function readStringArray(
  value: unknown,
  field: string,
  caseId: number,
  allowEmpty: boolean,
): string[] {
  if (!Array.isArray(value) || (!allowEmpty && value.length === 0)) {
    throw validationError(
      "EVAL_OUTPUT_SCHEMA_INVALID",
      `Eval ${caseId} has an invalid ${field} field.`,
      { caseId, field },
    )
  }
  const values = value.map((item) => {
    if (typeof item !== "string") {
      throw validationError(
        "EVAL_OUTPUT_SCHEMA_INVALID",
        `Eval ${caseId} contains a non-text ${field} entry.`,
        { caseId, field },
      )
    }
    const normalized = item.trim()
    if (!normalized || normalized.length > 2000) {
      throw validationError(
        "EVAL_OUTPUT_SCHEMA_INVALID",
        `Eval ${caseId} contains an invalid ${field} entry.`,
        { caseId, field },
      )
    }
    return normalized
  })
  if (new Set(values).size !== values.length) {
    throw validationError(
      "EVAL_OUTPUT_SCHEMA_INVALID",
      `Eval ${caseId} contains duplicate ${field} entries.`,
      { caseId, field },
    )
  }
  return values
}

function normalizeAssertions(
  raw: RawEvalCase,
  caseId: number,
): {
  readonly assertions: readonly string[]
  readonly variant: "assertions" | "expectations" | "mixed"
} {
  const hasAssertions = raw.assertions !== undefined
  const hasExpectations = raw.expectations !== undefined
  if (!hasAssertions && !hasExpectations) {
    throw validationError(
      "EVAL_OUTPUT_SCHEMA_INVALID",
      `Eval ${caseId} has no assertions or expectations.`,
      { caseId },
    )
  }
  const assertions = hasAssertions
    ? readStringArray(raw.assertions, "assertions", caseId, false)
    : null
  const expectations = hasExpectations
    ? readStringArray(raw.expectations, "expectations", caseId, false)
    : null
  if (
    assertions &&
    expectations &&
    JSON.stringify(assertions) !== JSON.stringify(expectations)
  ) {
    throw validationError(
      "EVAL_OUTPUT_SCHEMA_AMBIGUOUS",
      `Eval ${caseId} has conflicting assertions and expectations.`,
      { caseId },
    )
  }
  return {
    assertions: assertions ?? expectations ?? [],
    variant:
      hasAssertions && hasExpectations
        ? "mixed"
        : hasAssertions
          ? "assertions"
          : "expectations",
  }
}

function rejectRunnerInstructions(prompt: string, caseId: number): void {
  const forbiddenPatterns: readonly RegExp[] = [
    /(?:^|[\\/])target-skill(?:[\\/]|$)/i,
    /(?:^|[\\/])output(?:[\\/]|$)/i,
    /\bprovenance\b/i,
    /基线(?:类型|Skill|模式)/,
    /评分(?:方式|报告|规则)/,
  ]
  if (forbiddenPatterns.some((pattern) => pattern.test(prompt))) {
    throw validationError(
      "EVAL_PROMPT_CONTAINS_RUNNER_POLICY",
      `Eval ${caseId} prompt contains runner-owned instructions.`,
      { caseId },
    )
  }
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
      const stat = await lstat(evalsPath)
      if (!stat.isFile() || stat.isSymbolicLink()) throw new Error()
      rawEvals = await readFile(evalsPath)
    } catch (error) {
      if (error instanceof DomainError) throw error
      throw validationError(
        "EVAL_OUTPUT_MISSING",
        "The generation task did not create a regular evals.json file.",
      )
    }
    let parsed: RawEvalDocument
    try {
      const decoded = new TextDecoder("utf-8", { fatal: true }).decode(
        rawEvals,
      )
      parsed = JSON.parse(decoded) as RawEvalDocument
    } catch {
      throw validationError(
        "EVAL_OUTPUT_JSON_INVALID",
        "The generated evals.json is not valid UTF-8 JSON.",
      )
    }
    if (
      !parsed ||
      typeof parsed !== "object" ||
      !Array.isArray(parsed.evals) ||
      parsed.evals.length < 1
    ) {
      throw validationError(
        "EVAL_OUTPUT_ROOT_INVALID",
        "The generated Evals document does not contain any usable test cases.",
      )
    }

    const ids = new Set<number>()
    const referencedFiles = new Set<string>()
    const referencedCasefoldFiles = new Set<string>()
    const variants = new Set<"assertions" | "expectations" | "mixed">()
    const cases: StoredEvalCase[] = parsed.evals.map(
      (unknownCase, index) => {
        if (!unknownCase || typeof unknownCase !== "object") {
          throw validationError(
            "EVAL_OUTPUT_SCHEMA_INVALID",
            `Eval at index ${index} is not an object.`,
            { index },
          )
        }
        const raw = unknownCase as RawEvalCase
        if (
          !Number.isSafeInteger(raw.id) ||
          (raw.id as number) < 1 ||
          ids.has(raw.id as number)
        ) {
          throw validationError(
            "EVAL_OUTPUT_ID_INVALID",
            "Eval IDs must be unique positive integers.",
            { index },
          )
        }
        const id = raw.id as number
        ids.add(id)
        const files = readStringArray(raw.files, "files", id, true)
        for (const relativePath of files) {
          try {
            assertEvalRelativePath(relativePath)
          } catch {
            throw validationError(
              "EVAL_OUTPUT_FILE_PATH_INVALID",
              `Eval ${id} contains an invalid input file path.`,
              { caseId: id, path: relativePath },
            )
          }
          if (!relativePath.startsWith("files/")) {
            throw validationError(
              "EVAL_OUTPUT_FILE_PATH_INVALID",
              `Eval ${id} input files must be under files/.`,
              { caseId: id, path: relativePath },
            )
          }
          const casefoldPath = relativePath.toLocaleLowerCase("en-US")
          if (
            referencedCasefoldFiles.has(casefoldPath) &&
            !referencedFiles.has(relativePath)
          ) {
            throw validationError(
              "EVAL_OUTPUT_FILE_PATH_COLLISION",
              "Generated Evals contain file paths that differ only by letter case.",
              { path: relativePath },
            )
          }
          referencedCasefoldFiles.add(casefoldPath)
          referencedFiles.add(relativePath)
        }
        const prompt = readBoundedString(raw.prompt, "prompt", 20_000, id)
        rejectRunnerInstructions(prompt, id)
        const normalized = normalizeAssertions(raw, id)
        variants.add(normalized.variant)
        return {
          externalId: id,
          name: readBoundedString(raw.name, "name", 120, id),
          prompt,
          expectedOutput: readBoundedString(
            raw.expected_output,
            "expected_output",
            10_000,
            id,
          ),
          assertions: normalized.assertions,
          files,
        }
      },
    )

    const files: StoredEvalFile[] = []
    const outputRoot =
      this.storage.getGenerationOutputPath(input.generationId)
    const realOutputRoot = await realpath(outputRoot)
    for (const relativePath of [...referencedFiles].sort()) {
      const absolutePath = this.storage.getGenerationFilePath(
        input.generationId,
        relativePath,
      )
      let stat
      try {
        stat = await lstat(absolutePath)
      } catch {
        throw validationError(
          "EVAL_OUTPUT_FILE_MISSING",
          "A referenced Evals input file does not exist.",
          { path: relativePath },
        )
      }
      if (!stat.isFile() || stat.isSymbolicLink()) {
        throw validationError(
          "EVAL_OUTPUT_FILE_INVALID",
          "A referenced Evals input is not a regular file.",
          { path: relativePath },
        )
      }
      const actualPath = await realpath(absolutePath)
      const relativeToOutput = path.relative(realOutputRoot, actualPath)
      if (
        relativeToOutput === ".." ||
        relativeToOutput.startsWith(`..${path.sep}`) ||
        path.isAbsolute(relativeToOutput)
      ) {
        throw validationError(
          "EVAL_OUTPUT_FILE_ESCAPE",
          "A referenced Evals input escaped the controlled output root.",
          { path: relativePath },
        )
      }
      const content = await readFile(absolutePath)
      files.push({
        relativePath,
        sha256: sha256(content),
        byteSize: content.byteLength,
        mediaTypeHint: getMediaType(relativePath),
        contentKind: content.subarray(0, 8 * 1024).includes(0)
          ? "binary"
          : "text",
      })
    }

    const rawEvalsSha256 = sha256(rawEvals)
    const manifestData = {
      schemaVersion: 1,
      ...input.provenance,
      skillName: input.skillName,
      rawEvalsSha256,
      cases,
      files,
    }
    const manifestHash = sha256(JSON.stringify(manifestData))
    await writeFile(
      path.join(outputRoot, "generation-manifest.json"),
      `${JSON.stringify({ ...manifestData, manifestHash }, null, 2)}\n`,
      { encoding: "utf8", flag: "wx" },
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
}
