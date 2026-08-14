import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"

import { sanitizeTestRunPublicValue } from "../test-runs/test-run-public-safety.js"

export interface TestReportAnalysisDiagnosticEntry {
  readonly schemaVersion: "test-report-analyzer-diagnostic.v1"
  readonly analysisId: string
  readonly occurredAt: string
  readonly type: string
  readonly payload: Readonly<Record<string, unknown>>
}

export class TestReportAnalysisDiagnostics {
  private readonly root: string
  private readonly writes = new Map<string, Promise<void>>()

  constructor(dataRoot: string) {
    this.root = path.resolve(
      dataRoot,
      "diagnostics",
      "test-report-analyzer",
    )
  }

  filePath(analysisId: string): string {
    return path.join(this.root, `${analysisId}.jsonl`)
  }

  append(
    analysisId: string,
    type: string,
    payload: Readonly<Record<string, unknown>> = {},
  ): Promise<void> {
    const previous = this.writes.get(analysisId) ?? Promise.resolve()
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await mkdir(this.root, { recursive: true })
        const entry: TestReportAnalysisDiagnosticEntry = {
          schemaVersion: "test-report-analyzer-diagnostic.v1",
          analysisId,
          occurredAt: new Date().toISOString(),
          type,
          payload: sanitizeTestRunPublicValue(payload) as Readonly<
            Record<string, unknown>
          >,
        }
        await appendFile(
          this.filePath(analysisId),
          `${JSON.stringify(entry)}\n`,
          "utf8",
        )
      })
      .finally(() => {
        if (this.writes.get(analysisId) === next) {
          this.writes.delete(analysisId)
        }
      })
    this.writes.set(analysisId, next)
    return next
  }

  async flush(analysisId?: string): Promise<void> {
    if (analysisId) {
      const pending = this.writes.get(analysisId)
      if (pending) await pending.catch(() => undefined)
      return
    }
    await Promise.allSettled(this.writes.values())
  }
}
