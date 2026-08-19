import { createHash } from "node:crypto"
import path from "node:path"
import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises"

import type { StructuredTestReportV1 } from "./test-report.domain.js"

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu

function sha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex")
}

interface PreparedInputFile {
  readonly absolutePath: string
  readonly sha256: string
}

export interface PreparedTestReportAnalysisWorkspace {
  readonly locator: string
  readonly absolutePath: string
  readonly taskPath: string
  readonly reportPath: string
  readonly selectedCasesPath: string
  readonly contextPath: string
  readonly outputPath: string
  readonly inputFiles: readonly PreparedInputFile[]
}

export class TestReportAnalysisWorkspace {
  private readonly root: string

  constructor(dataRoot: string) {
    this.root = path.resolve(dataRoot, "test-report-analyses")
  }

  async prepare(
    analysisId: string,
    input: {
      readonly inputFingerprint: string
      readonly promptVersion: string
      readonly configuredModelId: string
      readonly report: StructuredTestReportV1
      readonly selectedEvalRevisionCaseIds: readonly string[]
    },
  ): Promise<PreparedTestReportAnalysisWorkspace> {
    const locator = path.posix.join(
      "test-report-analyses",
      analysisId,
      "workspace",
    )
    const absolutePath = this.resolve(analysisId)
    await rm(path.dirname(absolutePath), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
    const inputsRoot = path.join(absolutePath, "inputs")
    const outputPath = path.join(absolutePath, "outputs", "analysis.json")
    await Promise.all([
      mkdir(inputsRoot, { recursive: true }),
      mkdir(path.join(absolutePath, ".claude"), { recursive: true }),
      mkdir(path.join(absolutePath, "outputs", ".tmp"), {
        recursive: true,
      }),
    ])

    const reportPath = path.join(inputsRoot, "fact-report.json")
    const selectedCasesPath = path.join(inputsRoot, "selected-cases.json")
    const contextPath = path.join(inputsRoot, "analysis-context.json")
    const taskPath = path.join(inputsRoot, "task.json")
    const documents = new Map<string, string>([
      [reportPath, `${JSON.stringify(input.report, null, 2)}\n`],
      [
        selectedCasesPath,
        `${JSON.stringify(
          {
            selectedEvalRevisionCaseIds: input.selectedEvalRevisionCaseIds,
          },
          null,
          2,
        )}\n`,
      ],
      [
        contextPath,
        `${JSON.stringify(
          {
            schemaVersion: "test-report-analysis-context.v1",
            analysisId,
            reportId: input.report.reportId,
            reportRevisionId: input.report.reportRevisionId,
            configuredModelId: input.configuredModelId,
            promptVersion: input.promptVersion,
            inputFingerprint: input.inputFingerprint,
          },
          null,
          2,
        )}\n`,
      ],
      [
        taskPath,
        `${JSON.stringify(
          {
            schemaVersion: "test-report-analysis-task.v1",
            reportPath,
            selectedCasesPath,
            contextPath,
            outputPath,
          },
          null,
          2,
        )}\n`,
      ],
    ])
    for (const [filePath, content] of documents) {
      await writeFile(filePath, content, { encoding: "utf8", flag: "wx" })
    }

    return {
      locator,
      absolutePath,
      taskPath,
      reportPath,
      selectedCasesPath,
      contextPath,
      outputPath,
      inputFiles: [...documents].map(([absolutePath, content]) => ({
        absolutePath,
        sha256: sha256(content),
      })),
    }
  }

  async verifyInputs(
    prepared: PreparedTestReportAnalysisWorkspace,
  ): Promise<void> {
    for (const input of prepared.inputFiles) {
      if (sha256(await readFile(input.absolutePath)) !== input.sha256) {
        throw new Error("A frozen Analyzer input changed during execution.")
      }
    }
  }

  readOutput(prepared: PreparedTestReportAnalysisWorkspace): Promise<string> {
    return readFile(prepared.outputPath, "utf8")
  }

  async remove(analysisId: string): Promise<void> {
    await rm(path.dirname(this.resolve(analysisId)), {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    })
  }

  async cleanupStale(): Promise<void> {
    await mkdir(this.root, { recursive: true })
    for (const entry of await readdir(this.root, { withFileTypes: true })) {
      if (!entry.isDirectory() || !uuidPattern.test(entry.name)) continue
      await rm(path.join(this.root, entry.name), {
        recursive: true,
        force: true,
        maxRetries: 3,
        retryDelay: 100,
      })
    }
  }

  private resolve(analysisId: string): string {
    if (!uuidPattern.test(analysisId)) {
      throw new Error("Analysis workspace identity is invalid.")
    }
    const absolutePath = path.resolve(
      this.root,
      analysisId,
      "workspace",
    )
    const relative = path.relative(this.root, absolutePath)
    if (
      relative === "" ||
      relative === ".." ||
      relative.startsWith(`..${path.sep}`) ||
      path.isAbsolute(relative)
    ) {
      throw new Error("Analysis workspace escaped the controlled root.")
    }
    return absolutePath
  }
}
