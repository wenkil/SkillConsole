import { DomainError } from "../../core/errors/domain-error.js"
import type { TestRunEvent } from "../test-runs/test-run.domain.js"
import type { TestRunService } from "../test-runs/test-run.service.js"
import type {
  TestReportCaseQuery,
  TestReportListQuery,
} from "./test-report.domain.js"
import {
  testReportGeneratorVersion,
  testReportSchemaVersion,
} from "./test-report.domain.js"
import {
  buildStructuredTestReport,
  createReportRevisionIdentity,
} from "./test-report-generator.js"
import {
  getTestReportDocumentFilename,
  renderTestReportHtml,
  renderTestReportMarkdown,
  type TestReportDocumentFormat,
  type TestReportDocumentLocale,
} from "./test-report-renderer.js"
import { TestReportRepository } from "./test-report.repository.js"

interface TestReportLogger {
  error(
    bindings: Readonly<Record<string, unknown>>,
    message: string,
  ): void
}

export interface TestReportServiceOptions {
  readonly repository: TestReportRepository
  readonly testRuns: TestRunService
  readonly logger: TestReportLogger
}

const terminalEventTypes = new Set([
  "run.completed",
  "run.failed",
  "run.canceled",
  "run.interrupted",
])

export class TestReportService {
  private readonly workers = new Map<string, Promise<void>>()
  private unsubscribeRunEvents: (() => void) | null = null
  private shuttingDown = false

  constructor(private readonly options: TestReportServiceOptions) {}

  async initialize(): Promise<void> {
    await this.options.repository.releasePendingGenerationLeases()
    this.unsubscribeRunEvents = this.options.testRuns.subscribeAll(
      (event) => this.handleRunEvent(event),
    )
    try {
      await this.options.repository.ensurePendingReports()
      for (const reportId of await this.options.repository.listPendingOrExpired()) {
        this.launch(reportId)
      }
    } catch (error) {
      this.unsubscribeRunEvents()
      this.unsubscribeRunEvents = null
      throw error
    }
  }

  async list(workspaceId: string, query: TestReportListQuery) {
    const inserted = await this.options.repository.ensurePendingReports(
      workspaceId,
    )
    for (const reportId of inserted) this.launch(reportId)
    for (const reportId of await this.options.repository.listPendingOrExpired(
      50,
      workspaceId,
    )) {
      this.launch(reportId)
    }
    return this.options.repository.list(workspaceId, query)
  }

  async get(reportId: string) {
    const report = await this.options.repository.getRow(reportId)
    if (report.status === "GENERATION_PENDING") {
      try {
        await this.generate(reportId)
      } catch (error) {
        this.options.logger.error(
          { reportId, error },
          "Test report generation failed during detail read",
        )
      }
    }
    return this.options.repository.getDetail(reportId)
  }

  async getByRun(runId: string) {
    const report = await this.options.repository.ensureForRun(runId)
    if (report.status === "GENERATION_PENDING") {
      try {
        await this.generate(report.id)
      } catch (error) {
        this.options.logger.error(
          { reportId: report.id, runId, error },
          "Test report generation failed during Run lookup",
        )
      }
    }
    return this.options.repository.getDetail(report.id)
  }

  async getRevision(reportId: string, revisionId: string) {
    return this.options.repository.getRevisionSnapshot(reportId, revisionId)
  }

  async getDocument(
    reportId: string,
    revisionId: string,
    locale: TestReportDocumentLocale,
    format: TestReportDocumentFormat,
  ) {
    const report = await this.getRevision(reportId, revisionId)
    return {
      content:
        format === "html"
          ? renderTestReportHtml(report, locale)
          : renderTestReportMarkdown(report, locale),
      filename: getTestReportDocumentFilename(report, format),
    }
  }

  async listCases(reportId: string, query: TestReportCaseQuery) {
    const detail = await this.get(reportId)
    if (!detail.currentRevisionId) {
      return {
        items: [],
        pagination: {
          page: query.page,
          pageSize: query.pageSize,
          total: 0,
          pageCount: 0,
        },
      }
    }
    return this.options.repository.listCases(reportId, query)
  }

  async getCase(reportId: string, evalRevisionCaseId: string) {
    const detail = await this.get(reportId)
    const summary = await this.options.repository.getCase(
      reportId,
      evalRevisionCaseId,
    )
    const run = await this.options.testRuns.getDetail(detail.runId)
    return {
      summary,
      targetCase:
        run.cases.find((runCase) => runCase.id === summary.targetCaseId) ??
        null,
      baselineCase:
        run.cases.find((runCase) => runCase.id === summary.baselineCaseId) ??
        null,
    }
  }

  async regenerate(reportId: string) {
    await this.generate(reportId, true)
    return this.options.repository.getDetail(reportId)
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true
    this.unsubscribeRunEvents?.()
    this.unsubscribeRunEvents = null
    await Promise.allSettled(this.workers.values())
  }

  private handleRunEvent(event: TestRunEvent): void {
    if (!terminalEventTypes.has(event.type) || this.shuttingDown) return
    void this.options.repository
      .ensureForRun(event.runId)
      .then((report) => this.launch(report.id))
      .catch((error: unknown) => {
        this.options.logger.error(
          { runId: event.runId, error },
          "Terminal test Run could not create its report",
        )
      })
  }

  private launch(reportId: string): void {
    if (this.workers.has(reportId) || this.shuttingDown) return
    const worker = this.generateInternal(reportId, false)
      .catch((error: unknown) => {
        this.options.logger.error(
          { reportId, error },
          "Test report generation failed",
        )
      })
      .finally(() => {
        this.workers.delete(reportId)
      })
    this.workers.set(reportId, worker)
  }

  private async generate(
    reportId: string,
    allowAvailable = false,
  ): Promise<void> {
    const active = this.workers.get(reportId)
    if (active) {
      await active
      return
    }
    const worker = this.generateInternal(reportId, allowAvailable).finally(
      () => {
        this.workers.delete(reportId)
      },
    )
    this.workers.set(reportId, worker)
    await worker
  }

  private async generateInternal(
    reportId: string,
    allowAvailable: boolean,
  ): Promise<void> {
    const claimed = await this.options.repository.claimGeneration(
      reportId,
      allowAvailable,
    )
    if (!claimed) return
    try {
      const facts = await this.options.repository.getGenerationFacts(reportId)
      const run = await this.options.testRuns.getDetail(facts.report.runId)
      if (
        !["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
          run.status,
        )
      ) {
        throw new DomainError({
          code: "TEST_REPORT_RUN_NOT_TERMINAL",
          message: "A report can only be generated for a terminal test Run.",
          kind: "conflict",
        })
      }
      const identity = createReportRevisionIdentity()
      const report = buildStructuredTestReport({
        run,
        reportId,
        revisionId: identity.revisionId,
        revisionNumber: facts.revisionNumber,
        generatedAt: identity.generatedAt,
        targetBundledScripts: facts.targetBundledScripts,
        baselineBundledScripts: facts.baselineBundledScripts,
        lastEventSequence: facts.lastEventSequence,
        evalCases: facts.evalCases,
      })
      const currentRevision =
        await this.options.repository.findCurrentRevision(
          reportId,
          testReportSchemaVersion,
          testReportGeneratorVersion,
        )
      if (
        currentRevision &&
        currentRevision.sourceFingerprint === report.sourceFingerprint
      ) {
        await this.options.repository.restoreGeneratedRevision(
          reportId,
          currentRevision.revisionId,
        )
        return
      }
      await this.options.repository.saveGenerated(report)
    } catch (error) {
      const code =
        error instanceof DomainError
          ? error.code
          : "TEST_REPORT_GENERATION_FAILED"
      const message =
        error instanceof DomainError
          ? error.message
          : "The test report could not be generated."
      if (error instanceof DomainError && error.kind === "not_found") {
        await this.options.repository.markGenerationUnavailable(
          reportId,
          code,
          message,
        )
      } else {
        await this.options.repository.markGenerationFailed(
          reportId,
          code,
          message,
        )
      }
      throw error
    }
  }
}
