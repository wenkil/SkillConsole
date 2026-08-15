import { lstat, readFile, readdir } from "node:fs/promises"
import path from "node:path"

import { EvalStorage } from "./eval-storage.js"

export interface EvalGenerationFailureSummary {
  readonly evalsJsonState: "MISSING" | "INVALID_JSON" | "ROOT_INVALID" | "VALID"
  readonly evalCount: number | null
  readonly incompleteCaseIndexes: number[]
  readonly ignoredFiles: string[]
}

const requiredCaseFields = [
  "id",
  "name",
  "prompt",
  "expected_output",
  "files",
] as const

function hasMissingRequiredFields(candidate: Record<string, unknown>): boolean {
  return (
    requiredCaseFields.some((field) => candidate[field] === undefined) ||
    (candidate.assertions === undefined && candidate.expectations === undefined)
  )
}

async function listFiles(root: string, current = root): Promise<string[]> {
  let entries
  try {
    entries = await readdir(current, { withFileTypes: true })
  } catch {
    return []
  }
  const files: string[] = []
  for (const entry of entries) {
    const target = path.join(current, entry.name)
    if (entry.isDirectory()) {
      files.push(...(await listFiles(root, target)))
    } else if (entry.isFile()) {
      files.push(path.relative(root, target).split(path.sep).join("/"))
    }
  }
  return files.sort()
}

export class EvalGenerationFailureSummaryReader {
  constructor(private readonly storage: EvalStorage) {}

  async read(generationId: string): Promise<EvalGenerationFailureSummary> {
    const actualFiles = (
      await listFiles(this.storage.getGenerationFilesPath(generationId))
    ).map((relativePath) => `files/${relativePath}`)
    try {
      const evalsPath = this.storage.getGenerationEvalsJsonPath(generationId)
      const stat = await lstat(evalsPath)
      if (!stat.isFile() || stat.isSymbolicLink()) {
        return this.missing(actualFiles)
      }
      const parsed = JSON.parse(await readFile(evalsPath, "utf8")) as unknown
      if (
        !parsed ||
        typeof parsed !== "object" ||
        !Array.isArray((parsed as { evals?: unknown }).evals)
      ) {
        return {
          evalsJsonState: "ROOT_INVALID",
          evalCount: null,
          incompleteCaseIndexes: [],
          ignoredFiles: actualFiles,
        }
      }
      const evals = (parsed as { evals: unknown[] }).evals
      if (evals.length === 0) {
        return {
          evalsJsonState: "ROOT_INVALID",
          evalCount: 0,
          incompleteCaseIndexes: [],
          ignoredFiles: actualFiles,
        }
      }
      const referencedFiles = new Set<string>()
      const incompleteCaseIndexes: number[] = []
      evals.forEach((evalCase, index) => {
        if (!evalCase || typeof evalCase !== "object") {
          incompleteCaseIndexes.push(index + 1)
          return
        }
        const candidate = evalCase as Record<string, unknown>
        if (hasMissingRequiredFields(candidate)) {
          incompleteCaseIndexes.push(index + 1)
        }
        if (Array.isArray(candidate.files)) {
          for (const file of candidate.files) {
            if (typeof file === "string") referencedFiles.add(file)
          }
        }
      })
      return {
        evalsJsonState: "VALID",
        evalCount: evals.length,
        incompleteCaseIndexes,
        ignoredFiles: actualFiles.filter((file) => !referencedFiles.has(file)),
      }
    } catch (error) {
      if (error instanceof SyntaxError) {
        return {
          evalsJsonState: "INVALID_JSON",
          evalCount: null,
          incompleteCaseIndexes: [],
          ignoredFiles: actualFiles,
        }
      }
      return this.missing(actualFiles)
    }
  }

  private missing(
    ignoredFiles: string[],
  ): EvalGenerationFailureSummary {
    return {
      evalsJsonState: "MISSING",
      evalCount: null,
      incompleteCaseIndexes: [],
      ignoredFiles,
    }
  }
}
