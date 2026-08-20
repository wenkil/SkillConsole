import { randomUUID } from "node:crypto"

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
  isNull,
  ne,
  lte,
  max,
  or,
  sql,
} from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  skillSnapshotFiles,
  skillTestReportAnalyses,
  skillTestReportAssertionRows,
  skillTestReportCaseRows,
  skillTestReportRevisions,
  skillTestReports,
  skillTestRunEvents,
  skillTestRuns,
  evalRevisionCases,
  evalRevisions,
  type Database,
  type SkillTestReportAnalysisRow,
  type SkillTestReportRow,
  type TestReportStatus,
} from "../../infrastructure/database/index.js"
import type {
  CreateTestReportAnalysisInput,
  ReportCaseSummary,
  StructuredTestReportV1,
  TestReportAnalysisV1,
  TestReportAnalysisRevisionView,
  TestReportAnalysisUsage,
  TestReportCasePage,
  TestReportCaseQuery,
  TestReportDetailView,
  TestReportListItem,
  TestReportListQuery,
  TestReportPage,
} from "./test-report.domain.js"
import { sanitizeTestRunPublicValue } from "../test-runs/test-run-public-safety.js"

const terminalRunStatuses = [
  "COMPLETED",
  "FAILED",
  "CANCELED",
  "INTERRUPTED",
] as const

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

interface ReportDisplayRecord {
  readonly report: SkillTestReportRow
  readonly runStatus: (typeof terminalRunStatuses)[number]
  readonly targetVersionName: string | null
  readonly targetVersionNumber: number | null
  readonly baselineVersionName: string | null
  readonly baselineVersionNumber: number | null
  readonly evalRevisionId: string
  readonly evalRevisionNumber: number
  readonly evalCount: number
  readonly completedAt: Date | null
}

function reportNotFound(reportId: string): DomainError {
  return new DomainError({
    code: "TEST_REPORT_NOT_FOUND",
    message: "The requested test report does not exist.",
    kind: "not_found",
    details: { reportId },
  })
}

function runReportNotFound(runId: string): DomainError {
  return new DomainError({
    code: "TEST_REPORT_RUN_NOT_FOUND",
    message: "The requested terminal test Run does not exist.",
    kind: "not_found",
    details: { runId },
  })
}

function mapListItem(record: ReportDisplayRecord): TestReportListItem {
  const targetLabel = record.targetVersionName
    ? `${record.targetVersionName} R${record.targetVersionNumber}`
    : "Frozen working copy"
  const baselineLabel =
    record.report.reportType === "skill_effect"
      ? "No-Skill Baseline"
      : record.baselineVersionName
        ? `${record.baselineVersionName} R${record.baselineVersionNumber}`
        : "Baseline version"
  return {
    id: record.report.id,
    workspaceId: record.report.workspaceId,
    runId: record.report.runId,
    reportType: record.report.reportType,
    status: record.report.status,
    runStatus: record.runStatus,
    comparabilityStatus: record.report.comparabilityStatus,
    analysisStatus: record.report.analysisStatus,
    targetLabel,
    baselineLabel,
    evalRevisionId: record.evalRevisionId,
    evalRevisionNumber: record.evalRevisionNumber,
    evalCount: record.evalCount,
    issueCount: record.report.issueCount,
    negativeTransitionCount: record.report.negativeTransitionCount,
    positiveTransitionCount: record.report.positiveTransitionCount,
    primaryPassRate: record.report.primaryPassRate,
    assessmentCoverageRate: record.report.assessmentCoverageRate,
    executionCostUsd: record.report.executionCostUsd,
    gradingCostUsd: record.report.gradingCostUsd,
    totalCostUsd: record.report.totalCostUsd,
    wallClockDurationMs: record.report.wallClockDurationMs,
    completedAt: record.completedAt?.toISOString() ?? null,
    createdAt: record.report.createdAt.toISOString(),
    updatedAt: record.report.updatedAt.toISOString(),
  }
}

function mapStoredCase(
  value: Readonly<Record<string, unknown>>,
): ReportCaseSummary {
  return value as unknown as ReportCaseSummary
}

function analysisNotFound(analysisId: string): DomainError {
  return new DomainError({
    code: "TEST_REPORT_ANALYSIS_NOT_FOUND",
    message: "The requested test report Analysis Revision does not exist.",
    kind: "not_found",
    details: { analysisId },
  })
}

function mapAnalysisRow(
  row: SkillTestReportAnalysisRow,
): TestReportAnalysisRevisionView {
  const safeErrorMessage =
    row.errorMessage === null
      ? null
      : String(sanitizeTestRunPublicValue(row.errorMessage))
  return {
    id: row.id,
    reportId: row.reportId,
    reportRevisionId: row.reportRevisionId,
    revisionNumber: row.revisionNumber,
    status: row.status,
    agentSessionId: row.agentSessionId,
    configuredModelId: row.configuredModelId,
    actualModelId: row.actualModelId,
    modelId: row.actualModelId ?? row.configuredModelId,
    configurationFingerprint: row.configurationFingerprint,
    semanticConfigurationFingerprint: row.semanticConfigurationFingerprint,
    runtimePolicy: row.runtimePolicy as unknown as TestReportAnalysisRevisionView["runtimePolicy"],
    runtimePolicyFingerprint: row.runtimePolicyFingerprint,
    promptVersion: row.promptVersion,
    inputFingerprint: row.inputFingerprint,
    selectedEvalRevisionCaseIds: row.selectedEvalRevisionCaseIds,
    analysis:
      row.analysisSnapshot as unknown as TestReportAnalysisRevisionView["analysis"],
    usage: row.usage,
    error:
      row.errorCode && safeErrorMessage
        ? {
            code: row.errorCode,
            message: safeErrorMessage,
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

export class TestReportRepository {
  constructor(private readonly database: Database) {}

  async createPendingAnalysis(
    input: CreateTestReportAnalysisInput,
  ): Promise<TestReportAnalysisRevisionView> {
    const analysis = await this.database.transaction(async (transaction) => {
      const [report] = await transaction
        .select()
        .from(skillTestReports)
        .where(eq(skillTestReports.id, input.reportId))
        .for("update")
      if (!report) throw reportNotFound(input.reportId)

      const [existing] = await transaction
        .select()
        .from(skillTestReportAnalyses)
        .where(
          and(
            eq(skillTestReportAnalyses.reportId, input.reportId),
            eq(
              skillTestReportAnalyses.idempotencyKey,
              input.idempotencyKey,
            ),
          ),
        )
        .limit(1)
      if (existing) {
        const sameRequest =
          existing.reportRevisionId === input.reportRevisionId &&
          existing.promptVersion === input.promptVersion &&
          existing.inputFingerprint === input.inputFingerprint &&
          JSON.stringify(existing.selectedEvalRevisionCaseIds) ===
            JSON.stringify(input.selectedEvalRevisionCaseIds)
        if (!sameRequest) {
          throw new DomainError({
            code: "TEST_REPORT_ANALYSIS_IDEMPOTENCY_CONFLICT",
            message:
              "The idempotency key was already used for a different Analysis request.",
            kind: "conflict",
          })
        }
        return existing
      }

      if (
        !["AVAILABLE", "PARTIAL"].includes(report.status) ||
        !report.currentRevisionId
      ) {
        throw new DomainError({
          code: "TEST_REPORT_ANALYSIS_UNAVAILABLE",
          message:
            "Analyzer requires an available structured Report Revision.",
          kind: "conflict",
          details: { reportId: input.reportId, status: report.status },
        })
      }
      if (report.currentRevisionId !== input.reportRevisionId) {
        throw new DomainError({
          code: "TEST_REPORT_ANALYSIS_REVISION_CONFLICT",
          message:
            "Analyzer requests must bind to the current structured Report Revision.",
          kind: "conflict",
          details: {
            reportId: input.reportId,
            currentRevisionId: report.currentRevisionId,
            requestedRevisionId: input.reportRevisionId,
          },
        })
      }

      const [active] = await transaction
        .select({ id: skillTestReportAnalyses.id })
        .from(skillTestReportAnalyses)
        .where(
          and(
            eq(skillTestReportAnalyses.reportId, input.reportId),
            inArray(skillTestReportAnalyses.status, ["PENDING", "RUNNING"]),
          ),
        )
        .limit(1)
      if (active) {
        throw new DomainError({
          code: "TEST_REPORT_ANALYSIS_ALREADY_ACTIVE",
          message: "This Report already has an active Analyzer Revision.",
          kind: "conflict",
          details: { reportId: input.reportId },
        })
      }

      const [latest] = await transaction
        .select({ revisionNumber: skillTestReportAnalyses.revisionNumber })
        .from(skillTestReportAnalyses)
        .where(eq(skillTestReportAnalyses.reportId, input.reportId))
        .orderBy(desc(skillTestReportAnalyses.revisionNumber))
        .limit(1)
      const [created] = await transaction
        .insert(skillTestReportAnalyses)
        .values({
          id: randomUUID(),
          reportId: input.reportId,
          reportRevisionId: input.reportRevisionId,
          revisionNumber: (latest?.revisionNumber ?? 0) + 1,
          status: "PENDING",
          configuredModelId: input.configuredModelId,
          actualModelId: null,
          configurationFingerprint: input.configurationFingerprint,
          semanticConfigurationFingerprint:
            input.semanticConfigurationFingerprint,
          runtimePolicy: input.runtimePolicy as unknown as Readonly<
            Record<string, unknown>
          >,
          runtimePolicyFingerprint: input.runtimePolicyFingerprint,
          promptVersion: input.promptVersion,
          inputFingerprint: input.inputFingerprint,
          selectedEvalRevisionCaseIds: [
            ...input.selectedEvalRevisionCaseIds,
          ],
          idempotencyKey: input.idempotencyKey,
        })
        .returning()
      if (!created) {
        throw new Error("Analysis creation returned no database row.")
      }
      await this.syncAnalysisStatus(transaction, input.reportId)
      return created
    })
    return mapAnalysisRow(analysis)
  }

  async claimAnalysis(
    analysisId: string,
    agentSessionId: string,
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const now = new Date()
      const [claimed] = await transaction
        .update(skillTestReportAnalyses)
        .set({
          status: "RUNNING",
          agentSessionId,
          startedAt: now,
        })
        .where(
          and(
            eq(skillTestReportAnalyses.id, analysisId),
            eq(skillTestReportAnalyses.status, "PENDING"),
          ),
        )
        .returning({ reportId: skillTestReportAnalyses.reportId })
      if (!claimed) {
        await this.getAnalysisRow(transaction, analysisId)
        return false
      }
      await this.syncAnalysisStatus(transaction, claimed.reportId)
      return true
    })
  }

  async completeAnalysis(
    analysisId: string,
    analysis: TestReportAnalysisV1,
    usage: TestReportAnalysisUsage,
    actualModelId: string,
  ): Promise<TestReportAnalysisRevisionView> {
    const row = await this.database.transaction(async (transaction) => {
      const [completed] = await transaction
        .update(skillTestReportAnalyses)
        .set({
          status: "AVAILABLE",
          analysisSnapshot: analysis as unknown as Readonly<
            Record<string, unknown>
          >,
          actualModelId,
          usage,
          errorCode: null,
          errorMessage: null,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(skillTestReportAnalyses.id, analysisId),
            eq(skillTestReportAnalyses.status, "RUNNING"),
          ),
        )
        .returning()
      if (!completed) {
        const existing = await this.getAnalysisRow(transaction, analysisId)
        throw new DomainError({
          code: "TEST_REPORT_ANALYSIS_NOT_RUNNING",
          message: "Only a running Analysis Revision can be completed.",
          kind: "conflict",
          details: { analysisId, status: existing.status },
        })
      }
      await this.syncAnalysisStatus(transaction, completed.reportId)
      return completed
    })
    return mapAnalysisRow(row)
  }

  async failAnalysis(
    analysisId: string,
    code: string,
    message: string,
    usage: TestReportAnalysisUsage | null = null,
    actualModelId?: string,
  ): Promise<TestReportAnalysisRevisionView> {
    const sanitizedMessage = sanitizeTestRunPublicValue(message)
    const safeMessage =
      typeof sanitizedMessage === "string"
        ? sanitizedMessage
        : "The Analyzer failed without a safe public error message."
    const row = await this.database.transaction(async (transaction) => {
      const [failed] = await transaction
        .update(skillTestReportAnalyses)
        .set({
          status: "FAILED",
          analysisSnapshot: null,
          usage,
          ...(actualModelId ? { actualModelId } : {}),
          errorCode: code,
          errorMessage: safeMessage,
          completedAt: new Date(),
        })
        .where(
          and(
            eq(skillTestReportAnalyses.id, analysisId),
            inArray(skillTestReportAnalyses.status, ["PENDING", "RUNNING"]),
          ),
        )
        .returning()
      if (!failed) {
        const existing = await this.getAnalysisRow(transaction, analysisId)
        if (existing.status === "FAILED") return existing
        throw new DomainError({
          code: "TEST_REPORT_ANALYSIS_NOT_ACTIVE",
          message: "Only an active Analysis Revision can be failed.",
          kind: "conflict",
          details: { analysisId, status: existing.status },
        })
      }
      await this.syncAnalysisStatus(transaction, failed.reportId)
      return failed
    })
    return mapAnalysisRow(row)
  }

  async getAnalysis(
    analysisId: string,
  ): Promise<TestReportAnalysisRevisionView> {
    const row = await this.getAnalysisRow(this.database, analysisId)
    return mapAnalysisRow(row)
  }

  async listAnalyses(
    reportId: string,
  ): Promise<readonly TestReportAnalysisRevisionView[]> {
    await this.getRow(reportId)
    const rows = await this.database
      .select()
      .from(skillTestReportAnalyses)
      .where(eq(skillTestReportAnalyses.reportId, reportId))
      .orderBy(desc(skillTestReportAnalyses.revisionNumber))
    return rows.map(mapAnalysisRow)
  }

  async failInterruptedAnalyses(): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const interrupted = await transaction
        .update(skillTestReportAnalyses)
        .set({
          status: "FAILED",
          analysisSnapshot: null,
          errorCode: "TEST_REPORT_ANALYZER_INTERRUPTED",
          errorMessage:
            "The Analyzer was interrupted by a service restart and was not resumed.",
          completedAt: new Date(),
        })
        .where(
          eq(skillTestReportAnalyses.status, "RUNNING"),
        )
        .returning({ reportId: skillTestReportAnalyses.reportId })
      for (const reportId of new Set(interrupted.map((row) => row.reportId))) {
        await this.syncAnalysisStatus(transaction, reportId)
      }
      return interrupted.length
    })
  }

  async listPendingAnalyses(): Promise<readonly string[]> {
    const rows = await this.database
      .select({ id: skillTestReportAnalyses.id })
      .from(skillTestReportAnalyses)
      .where(eq(skillTestReportAnalyses.status, "PENDING"))
      .orderBy(asc(skillTestReportAnalyses.createdAt))
    return rows.map((row) => row.id)
  }

  async ensurePendingReports(workspaceId?: string): Promise<string[]> {
    const runs = await this.database
      .select({
        id: skillTestRuns.id,
        workspaceId: skillTestRuns.workspaceId,
        mode: skillTestRuns.mode,
      })
      .from(skillTestRuns)
      .leftJoin(
        skillTestReports,
        eq(skillTestReports.runId, skillTestRuns.id),
      )
      .where(
        and(
          inArray(skillTestRuns.status, [...terminalRunStatuses]),
          ne(skillTestRuns.protocolVersion, "skill-test-run-agent-chain-v6"),
          isNull(skillTestReports.id),
          workspaceId
            ? eq(skillTestRuns.workspaceId, workspaceId)
            : undefined,
        ),
      )
    if (runs.length === 0) return []
    const inserted = await this.database
      .insert(skillTestReports)
      .values(
        runs.map((run) => ({
          workspaceId: run.workspaceId,
          runId: run.id,
          reportType:
            run.mode === "version_vs_version"
              ? ("version_comparison" as const)
              : ("skill_effect" as const),
        })),
      )
      .onConflictDoNothing({ target: skillTestReports.runId })
      .returning({ id: skillTestReports.id })
    return inserted.map((row) => row.id)
  }

  async ensureForRun(runId: string): Promise<SkillTestReportRow> {
    const [run] = await this.database
      .select({
        id: skillTestRuns.id,
        workspaceId: skillTestRuns.workspaceId,
        mode: skillTestRuns.mode,
        status: skillTestRuns.status,
        protocolVersion: skillTestRuns.protocolVersion,
      })
      .from(skillTestRuns)
      .where(eq(skillTestRuns.id, runId))
      .limit(1)
    if (!run || !terminalRunStatuses.includes(run.status as never)) {
      throw runReportNotFound(runId)
    }
    if (run.protocolVersion === "skill-test-run-agent-chain-v6") {
      throw new DomainError({
        code: "TEST_REPORT_AGENT_CHAIN_UNAVAILABLE",
        message:
          "Agent-chain test Runs use the Skill score HTML report instead of the legacy deterministic report.",
        kind: "conflict",
        details: { runId },
      })
    }
    await this.database
      .insert(skillTestReports)
      .values({
        workspaceId: run.workspaceId,
        runId: run.id,
        reportType:
          run.mode === "version_vs_version"
            ? "version_comparison"
            : "skill_effect",
      })
      .onConflictDoNothing({ target: skillTestReports.runId })
    return this.getRowByRun(runId)
  }

  async listPendingOrExpired(
    limit = 50,
    workspaceId?: string,
  ): Promise<string[]> {
    const now = new Date()
    return (
      await this.database
        .select({ id: skillTestReports.id })
        .from(skillTestReports)
        .where(
          and(
            eq(skillTestReports.status, "GENERATION_PENDING"),
            or(
              isNull(skillTestReports.generationLeaseExpiresAt),
              lte(skillTestReports.generationLeaseExpiresAt, now),
            ),
            workspaceId
              ? eq(skillTestReports.workspaceId, workspaceId)
              : undefined,
          ),
        )
        .orderBy(asc(skillTestReports.createdAt))
        .limit(limit)
    ).map((row) => row.id)
  }

  async releasePendingGenerationLeases(): Promise<void> {
    await this.database
      .update(skillTestReports)
      .set({
        generationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(skillTestReports.status, "GENERATION_PENDING"))
  }

  async claimGeneration(
    reportId: string,
    allowAvailable = false,
  ): Promise<boolean> {
    const now = new Date()
    const leaseExpiresAt = new Date(now.getTime() + 2 * 60_000)
    const eligibleStatuses: TestReportStatus[] = allowAvailable
      ? [
          "GENERATION_PENDING",
          "GENERATION_FAILED",
          "AVAILABLE",
          "PARTIAL",
        ]
      : ["GENERATION_PENDING", "GENERATION_FAILED"]
    const [claimed] = await this.database
      .update(skillTestReports)
      .set({
        status: "GENERATION_PENDING",
        generationStartedAt: now,
        generationLeaseExpiresAt: leaseExpiresAt,
        generationErrorCode: null,
        generationErrorMessage: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(skillTestReports.id, reportId),
          inArray(skillTestReports.status, eligibleStatuses),
          or(
            isNull(skillTestReports.generationLeaseExpiresAt),
            lte(skillTestReports.generationLeaseExpiresAt, now),
          ),
        ),
      )
      .returning({ id: skillTestReports.id })
    if (claimed) return true
    await this.getRow(reportId)
    return false
  }

  async findCurrentRevision(
    reportId: string,
    schemaVersion: string,
    generatorVersion: string,
  ): Promise<{
    readonly revisionId: string
    readonly sourceFingerprint: string
  } | null> {
    const [revision] = await this.database
      .select({
        revisionId: skillTestReportRevisions.id,
        sourceFingerprint: skillTestReportRevisions.sourceFingerprint,
      })
      .from(skillTestReportRevisions)
      .where(
        and(
          eq(skillTestReportRevisions.reportId, reportId),
          eq(skillTestReportRevisions.schemaVersion, schemaVersion),
          eq(
            skillTestReportRevisions.generatorVersion,
            generatorVersion,
          ),
        ),
      )
      .orderBy(desc(skillTestReportRevisions.revisionNumber))
      .limit(1)
    return revision ?? null
  }

  async restoreGeneratedRevision(
    reportId: string,
    revisionId: string,
  ): Promise<void> {
    const snapshot = await this.getRevisionSnapshotById(revisionId)
    const executionCostUsd =
      snapshot.metrics.target.usage.execution.totalCostUsd +
      snapshot.metrics.baseline.usage.execution.totalCostUsd
    const gradingCostUsd =
      snapshot.metrics.target.usage.grading.totalCostUsd +
      snapshot.metrics.baseline.usage.grading.totalCostUsd
    await this.database
      .update(skillTestReports)
      .set({
        status: snapshot.status,
        comparabilityStatus: snapshot.comparability.status,
        currentRevisionId: revisionId,
        issueCount: snapshot.issues.total,
        negativeTransitionCount: snapshot.transitions.negativeCount,
        positiveTransitionCount: snapshot.transitions.positiveCount,
        primaryPassRate:
          snapshot.metrics.target.assertions.decisivePassRate.value,
        assessmentCoverageRate:
          snapshot.metrics.target.assertions.assessmentCoverageRate.value,
        executionCostUsd,
        gradingCostUsd,
        totalCostUsd: executionCostUsd + gradingCostUsd,
        wallClockDurationMs: snapshot.run.wallClockDurationMs,
        generationErrorCode: null,
        generationErrorMessage: null,
        generationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(skillTestReports.id, reportId))
  }

  async getGenerationFacts(reportId: string): Promise<{
    readonly report: SkillTestReportRow
    readonly revisionNumber: number
    readonly targetBundledScripts: readonly string[]
    readonly baselineBundledScripts: readonly string[]
    readonly lastEventSequence: number | null
    readonly evalCases: readonly {
      readonly id: string
      readonly externalId: number
      readonly name: string
      readonly assertions: readonly string[]
    }[]
  }> {
    const report = await this.getRow(reportId)
    const [run] = await this.database
      .select({
        targetSnapshotId: skillTestRuns.skillSnapshotId,
        baselineSnapshotId: skillTestRuns.baselineSkillSnapshotId,
        evalRevisionId: skillTestRuns.evalRevisionId,
      })
      .from(skillTestRuns)
      .where(eq(skillTestRuns.id, report.runId))
      .limit(1)
    if (!run) throw runReportNotFound(report.runId)
    const snapshotIds = [
      run.targetSnapshotId,
      ...(run.baselineSnapshotId ? [run.baselineSnapshotId] : []),
    ]
    const [files, evalCases, revisionResult, eventResult] = await Promise.all([
      this.database
        .select({
          snapshotId: skillSnapshotFiles.snapshotId,
          relativePath: skillSnapshotFiles.relativePath,
        })
        .from(skillSnapshotFiles)
        .where(inArray(skillSnapshotFiles.snapshotId, snapshotIds)),
      this.database
        .select({
          id: evalRevisionCases.id,
          externalId: evalRevisionCases.externalId,
          name: evalRevisionCases.name,
          assertions: evalRevisionCases.assertions,
        })
        .from(evalRevisionCases)
        .where(eq(evalRevisionCases.revisionId, run.evalRevisionId))
        .orderBy(asc(evalRevisionCases.externalId)),
      this.database
        .select({ value: max(skillTestReportRevisions.revisionNumber) })
        .from(skillTestReportRevisions)
        .where(eq(skillTestReportRevisions.reportId, reportId)),
      this.database
        .select({ value: max(skillTestRunEvents.sequence) })
        .from(skillTestRunEvents)
        .where(eq(skillTestRunEvents.runId, report.runId)),
    ])
    const scriptsFor = (snapshotId: string | null) =>
      snapshotId
        ? files
            .filter(
              (file) =>
                file.snapshotId === snapshotId &&
                file.relativePath.replaceAll("\\", "/").startsWith("scripts/"),
            )
            .map((file) => file.relativePath.replaceAll("\\", "/"))
            .sort()
        : []
    return {
      report,
      revisionNumber: (revisionResult[0]?.value ?? 0) + 1,
      targetBundledScripts: scriptsFor(run.targetSnapshotId),
      baselineBundledScripts: scriptsFor(run.baselineSnapshotId),
      lastEventSequence: eventResult[0]?.value ?? null,
      evalCases,
    }
  }

  async saveGenerated(
    report: StructuredTestReportV1,
  ): Promise<TestReportDetailView> {
    await this.database.transaction(async (transaction) => {
      const [locked] = await transaction
        .select()
        .from(skillTestReports)
        .where(eq(skillTestReports.id, report.reportId))
        .for("update")
      if (!locked) throw reportNotFound(report.reportId)
      const [existing] = await transaction
        .select()
        .from(skillTestReportRevisions)
        .where(
          and(
            eq(skillTestReportRevisions.reportId, report.reportId),
            eq(skillTestReportRevisions.schemaVersion, report.schemaVersion),
            eq(
              skillTestReportRevisions.generatorVersion,
              report.generatorVersion,
            ),
            eq(
              skillTestReportRevisions.sourceFingerprint,
              report.sourceFingerprint,
            ),
          ),
        )
        .limit(1)
      const revisionId = existing?.id ?? report.reportRevisionId
      if (!existing) {
        await transaction.insert(skillTestReportRevisions).values({
          id: revisionId,
          reportId: report.reportId,
          revisionNumber: report.reportRevisionNumber,
          schemaVersion: report.schemaVersion,
          generatorVersion: report.generatorVersion,
          sourceFingerprint: report.sourceFingerprint,
          summarySnapshot: report as unknown as Readonly<Record<string, unknown>>,
          generatedAt: new Date(report.generatedAt),
        })
        await this.insertCaseRows(
          transaction,
          revisionId,
          report.cases,
          report.issues.items,
        )
      }
      const executionCostUsd =
        report.metrics.target.usage.execution.totalCostUsd +
        report.metrics.baseline.usage.execution.totalCostUsd
      const gradingCostUsd =
        report.metrics.target.usage.grading.totalCostUsd +
        report.metrics.baseline.usage.grading.totalCostUsd
      await transaction
        .update(skillTestReports)
        .set({
          status: report.status,
          comparabilityStatus: report.comparability.status,
          currentRevisionId: revisionId,
          issueCount: report.issues.total,
          negativeTransitionCount: report.transitions.negativeCount,
          positiveTransitionCount: report.transitions.positiveCount,
          primaryPassRate:
            report.metrics.target.assertions.decisivePassRate.value,
          assessmentCoverageRate:
            report.metrics.target.assertions.assessmentCoverageRate.value,
          executionCostUsd,
          gradingCostUsd,
          totalCostUsd: executionCostUsd + gradingCostUsd,
          wallClockDurationMs: report.run.wallClockDurationMs,
          generationErrorCode: null,
          generationErrorMessage: null,
          generationLeaseExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(skillTestReports.id, report.reportId))
    })
    return this.getDetail(report.reportId)
  }

  async markGenerationFailed(
    reportId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.database
      .update(skillTestReports)
      .set({
        status: "GENERATION_FAILED",
        generationErrorCode: code,
        generationErrorMessage: message,
        generationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(skillTestReports.id, reportId))
  }

  async markGenerationUnavailable(
    reportId: string,
    code: string,
    message: string,
  ): Promise<void> {
    await this.database
      .update(skillTestReports)
      .set({
        status: "UNAVAILABLE",
        generationErrorCode: code,
        generationErrorMessage: message,
        generationLeaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(eq(skillTestReports.id, reportId))
  }

  async list(
    workspaceId: string,
    query: TestReportListQuery,
  ): Promise<TestReportPage> {
    const offset = (query.page - 1) * query.pageSize
    const where = and(
      eq(skillTestReports.workspaceId, workspaceId),
      query.reportType
        ? eq(skillTestReports.reportType, query.reportType)
        : undefined,
      query.status ? eq(skillTestReports.status, query.status) : undefined,
      query.runStatus ? eq(skillTestRuns.status, query.runStatus) : undefined,
      query.comparability
        ? eq(skillTestReports.comparabilityStatus, query.comparability)
        : undefined,
      query.hasNegativeTransition === undefined
        ? undefined
        : query.hasNegativeTransition
          ? gt(skillTestReports.negativeTransitionCount, 0)
          : eq(skillTestReports.negativeTransitionCount, 0),
      query.evalRevisionId
        ? eq(skillTestRuns.evalRevisionId, query.evalRevisionId)
        : undefined,
      query.versionId
        ? or(
            eq(skillTestRuns.skillVersionId, query.versionId),
            eq(skillTestRuns.baselineSkillVersionId, query.versionId),
          )
        : undefined,
      query.analysisStatus
        ? eq(skillTestReports.analysisStatus, query.analysisStatus)
        : undefined,
      query.completedFrom
        ? sql<boolean>`${skillTestRuns.completedAt} >= ${new Date(query.completedFrom)}`
        : undefined,
      query.completedTo
        ? sql<boolean>`${skillTestRuns.completedAt} <= ${new Date(query.completedTo)}`
        : undefined,
    )
    const orderColumn =
      query.sort === "issueCount"
        ? skillTestReports.issueCount
        : query.sort === "passRate"
          ? skillTestReports.primaryPassRate
          : query.sort === "cost"
            ? skillTestReports.totalCostUsd
            : query.sort === "duration"
              ? skillTestReports.wallClockDurationMs
              : skillTestRuns.completedAt
    const orderBy = query.order === "asc" ? asc(orderColumn) : desc(orderColumn)
    const [records, totals] = await Promise.all([
      this.baseDisplayQuery()
        .where(where)
        .orderBy(orderBy, desc(skillTestReports.id))
        .limit(query.pageSize)
        .offset(offset),
      this.database
        .select({
          total: count(),
          available: sql<number>`count(*) filter (where ${skillTestReports.status} = 'AVAILABLE')::int`,
          partial: sql<number>`count(*) filter (where ${skillTestReports.status} = 'PARTIAL')::int`,
          generationFailed: sql<number>`count(*) filter (where ${skillTestReports.status} = 'GENERATION_FAILED')::int`,
          withNegativeTransitions: sql<number>`count(*) filter (where ${skillTestReports.negativeTransitionCount} > 0)::int`,
          executionCostUsd: sql<number>`coalesce(sum(${skillTestReports.executionCostUsd}), 0)::float8`,
          gradingCostUsd: sql<number>`coalesce(sum(${skillTestReports.gradingCostUsd}), 0)::float8`,
        })
        .from(skillTestReports)
        .innerJoin(skillTestRuns, eq(skillTestRuns.id, skillTestReports.runId))
        .where(where),
    ])
    const summary = totals[0] ?? {
      total: 0,
      available: 0,
      partial: 0,
      generationFailed: 0,
      withNegativeTransitions: 0,
      executionCostUsd: 0,
      gradingCostUsd: 0,
    }
    return {
      items: records.map((record) => mapListItem(record as ReportDisplayRecord)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total: summary.total,
        pageCount:
          summary.total === 0 ? 0 : Math.ceil(summary.total / query.pageSize),
      },
      summary,
    }
  }

  async getDetail(reportId: string): Promise<TestReportDetailView> {
    const record = await this.getDisplayRecord(reportId)
    const revision = record.report.currentRevisionId
      ? await this.getRevisionSnapshotById(record.report.currentRevisionId)
      : null
    return {
      ...mapListItem(record),
      currentRevisionId: record.report.currentRevisionId,
      generationError:
        record.report.generationErrorCode &&
        record.report.generationErrorMessage
          ? {
              code: record.report.generationErrorCode,
              message: String(
                sanitizeTestRunPublicValue(
                  record.report.generationErrorMessage,
                ),
              ),
            }
          : null,
      report: revision,
    }
  }

  async getDetailByRun(runId: string): Promise<TestReportDetailView> {
    const report = await this.getRowByRun(runId)
    return this.getDetail(report.id)
  }

  async getRevisionSnapshot(
    reportId: string,
    revisionId: string,
  ): Promise<StructuredTestReportV1> {
    const [revision] = await this.database
      .select({ snapshot: skillTestReportRevisions.summarySnapshot })
      .from(skillTestReportRevisions)
      .where(
        and(
          eq(skillTestReportRevisions.id, revisionId),
          eq(skillTestReportRevisions.reportId, reportId),
        ),
      )
      .limit(1)
    if (!revision) {
      throw new DomainError({
        code: "TEST_REPORT_REVISION_NOT_FOUND",
        message: "The requested test report Revision does not exist.",
        kind: "not_found",
        details: { reportId, revisionId },
      })
    }
    return revision.snapshot as unknown as StructuredTestReportV1
  }

  async listCases(
    reportId: string,
    query: TestReportCaseQuery,
  ): Promise<TestReportCasePage> {
    const report = await this.getRow(reportId)
    if (!report.currentRevisionId) {
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
    const outcomeCondition = query.outcome
      ? query.side === "BASELINE"
        ? eq(skillTestReportCaseRows.baselineOutcome, query.outcome)
        : query.side === "TARGET"
          ? eq(skillTestReportCaseRows.targetOutcome, query.outcome)
          : or(
              eq(skillTestReportCaseRows.targetOutcome, query.outcome),
              eq(skillTestReportCaseRows.baselineOutcome, query.outcome),
            )
      : undefined
    const where = and(
      eq(skillTestReportCaseRows.reportRevisionId, report.currentRevisionId),
      query.classification
        ? eq(skillTestReportCaseRows.classification, query.classification)
        : undefined,
      outcomeCondition,
      query.issueKind && query.side
        ? sql<boolean>`${skillTestReportCaseRows.issueKeys} @> ${JSON.stringify([`${query.side}:${query.issueKind}`])}::jsonb`
        : query.issueKind
        ? sql<boolean>`${skillTestReportCaseRows.issueKinds} @> ${JSON.stringify([query.issueKind])}::jsonb`
        : undefined,
      query.side && !query.outcome
        ? sql<boolean>`${skillTestReportCaseRows.issueSides} @> ${JSON.stringify([query.side])}::jsonb`
        : undefined,
      query.externalId
        ? eq(skillTestReportCaseRows.externalId, query.externalId)
        : undefined,
    )
    const [rows, totals] = await Promise.all([
      this.database
        .select({ snapshot: skillTestReportCaseRows.derivedSnapshot })
        .from(skillTestReportCaseRows)
        .where(where)
        .orderBy(asc(skillTestReportCaseRows.externalId))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.database
        .select({ total: count() })
        .from(skillTestReportCaseRows)
        .where(where),
    ])
    const total = totals[0]?.total ?? 0
    return {
      items: rows.map((row) => mapStoredCase(row.snapshot)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        pageCount: total === 0 ? 0 : Math.ceil(total / query.pageSize),
      },
    }
  }

  async getCase(
    reportId: string,
    evalRevisionCaseId: string,
  ): Promise<ReportCaseSummary> {
    const report = await this.getRow(reportId)
    if (!report.currentRevisionId) {
      throw new DomainError({
        code: "TEST_REPORT_NOT_GENERATED",
        message: "The test report has not been generated yet.",
        kind: "conflict",
      })
    }
    const [row] = await this.database
      .select({ snapshot: skillTestReportCaseRows.derivedSnapshot })
      .from(skillTestReportCaseRows)
      .where(
        and(
          eq(
            skillTestReportCaseRows.reportRevisionId,
            report.currentRevisionId,
          ),
          eq(
            skillTestReportCaseRows.evalRevisionCaseId,
            evalRevisionCaseId,
          ),
        ),
      )
      .limit(1)
    if (!row) {
      throw new DomainError({
        code: "TEST_REPORT_CASE_NOT_FOUND",
        message: "The requested report Case does not exist.",
        kind: "not_found",
        details: { reportId, evalRevisionCaseId },
      })
    }
    return mapStoredCase(row.snapshot)
  }

  async getRow(reportId: string): Promise<SkillTestReportRow> {
    const [report] = await this.database
      .select()
      .from(skillTestReports)
      .where(eq(skillTestReports.id, reportId))
      .limit(1)
    if (!report) throw reportNotFound(reportId)
    return report
  }

  private async getRowByRun(runId: string): Promise<SkillTestReportRow> {
    const [report] = await this.database
      .select()
      .from(skillTestReports)
      .where(eq(skillTestReports.runId, runId))
      .limit(1)
    if (!report) throw runReportNotFound(runId)
    return report
  }

  private baseDisplayQuery() {
    return this.database
      .select({
        report: skillTestReports,
        runStatus: sql<(typeof terminalRunStatuses)[number]>`${skillTestRuns.status}`,
        targetVersionName: sql<string | null>`(
          select target_version.name from skill_versions target_version
          where target_version.id = ${skillTestRuns.skillVersionId}
          limit 1
        )`,
        targetVersionNumber: sql<number | null>`(
          select target_version.version_number from skill_versions target_version
          where target_version.id = ${skillTestRuns.skillVersionId}
          limit 1
        )`,
        baselineVersionName: sql<string | null>`(
          select baseline_version.name from skill_versions baseline_version
          where baseline_version.id = ${skillTestRuns.baselineSkillVersionId}
          limit 1
        )`,
        baselineVersionNumber: sql<number | null>`(
          select baseline_version.version_number from skill_versions baseline_version
          where baseline_version.id = ${skillTestRuns.baselineSkillVersionId}
          limit 1
        )`,
        evalRevisionId: evalRevisions.id,
        evalRevisionNumber: evalRevisions.sequenceNumber,
        evalCount: evalRevisions.evalCount,
        completedAt: skillTestRuns.completedAt,
      })
      .from(skillTestReports)
      .innerJoin(skillTestRuns, eq(skillTestRuns.id, skillTestReports.runId))
      .innerJoin(
        evalRevisions,
        eq(evalRevisions.id, skillTestRuns.evalRevisionId),
      )
  }

  private async getDisplayRecord(
    reportId: string,
  ): Promise<ReportDisplayRecord> {
    const [record] = await this.baseDisplayQuery()
      .where(eq(skillTestReports.id, reportId))
      .limit(1)
    if (!record) throw reportNotFound(reportId)
    return record as ReportDisplayRecord
  }

  private async getRevisionSnapshotById(
    revisionId: string,
  ): Promise<StructuredTestReportV1> {
    const [revision] = await this.database
      .select({ snapshot: skillTestReportRevisions.summarySnapshot })
      .from(skillTestReportRevisions)
      .where(eq(skillTestReportRevisions.id, revisionId))
      .limit(1)
    if (!revision) {
      throw new DomainError({
        code: "TEST_REPORT_REVISION_NOT_FOUND",
        message: "The current test report Revision does not exist.",
        kind: "not_found",
        details: { revisionId },
      })
    }
    return revision.snapshot as unknown as StructuredTestReportV1
  }

  private async getAnalysisRow(
    executor: Database | Transaction,
    analysisId: string,
  ): Promise<SkillTestReportAnalysisRow> {
    const [analysis] = await executor
      .select()
      .from(skillTestReportAnalyses)
      .where(eq(skillTestReportAnalyses.id, analysisId))
      .limit(1)
    if (!analysis) throw analysisNotFound(analysisId)
    return analysis
  }

  private async syncAnalysisStatus(
    transaction: Transaction,
    reportId: string,
  ): Promise<void> {
    const [latest] = await transaction
      .select({ status: skillTestReportAnalyses.status })
      .from(skillTestReportAnalyses)
      .where(eq(skillTestReportAnalyses.reportId, reportId))
      .orderBy(desc(skillTestReportAnalyses.revisionNumber))
      .limit(1)
    await transaction
      .update(skillTestReports)
      .set({
        analysisStatus: latest?.status ?? "NOT_REQUESTED",
        updatedAt: new Date(),
      })
      .where(eq(skillTestReports.id, reportId))
  }

  private async insertCaseRows(
    transaction: Transaction,
    revisionId: string,
    cases: readonly ReportCaseSummary[],
    issues: StructuredTestReportV1["issues"]["items"],
  ): Promise<void> {
    for (const reportCase of cases) {
      const caseRowId = randomUUID()
      await transaction.insert(skillTestReportCaseRows).values({
        id: caseRowId,
        reportRevisionId: revisionId,
        evalRevisionCaseId: reportCase.evalRevisionCaseId,
        externalId: reportCase.externalId,
        name: reportCase.name,
        classification: reportCase.classification,
        pairComparability: reportCase.pairComparability,
        targetCaseId: reportCase.targetCaseId,
        baselineCaseId: reportCase.baselineCaseId,
        targetOutcome: reportCase.targetOutcome,
        baselineOutcome: reportCase.baselineOutcome,
        issueCount: reportCase.issueIds.length,
        issueKinds: [
          ...new Set(
            issues
              .filter(
                (issue) =>
                  issue.evalRevisionCaseId ===
                  reportCase.evalRevisionCaseId,
              )
              .map((issue) => issue.kind),
          ),
        ],
        issueSides: [
          ...new Set(
            issues
              .filter(
                (issue) =>
                  issue.evalRevisionCaseId ===
                    reportCase.evalRevisionCaseId &&
                  issue.side !== null,
              )
              .map((issue) => issue.side as "TARGET" | "BASELINE"),
          ),
        ],
        issueKeys: [
          ...new Set(
            issues
              .filter(
                (issue) =>
                  issue.evalRevisionCaseId ===
                    reportCase.evalRevisionCaseId &&
                  issue.side !== null,
              )
              .map((issue) => `${issue.side}:${issue.kind}`),
          ),
        ],
        derivedSnapshot: reportCase as unknown as Readonly<Record<string, unknown>>,
      })
      if (reportCase.assertionTransitions.length > 0) {
        await transaction.insert(skillTestReportAssertionRows).values(
          reportCase.assertionTransitions.map((assertion) => ({
            reportCaseRowId: caseRowId,
            assertionIndex: assertion.assertionIndex,
            assertion: assertion.assertion,
            baselineStatus: assertion.baselineStatus,
            targetStatus: assertion.targetStatus,
            transition: assertion.transition,
            baselineAssertionResultId:
              assertion.baselineAssertionResultId,
            targetAssertionResultId: assertion.targetAssertionResultId,
            evidenceRefs: assertion.evidenceRefs,
          })),
        )
      }
    }
  }
}
