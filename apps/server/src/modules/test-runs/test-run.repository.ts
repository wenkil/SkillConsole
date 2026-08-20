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
  lt,
  or,
  sql,
} from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  assertionResults,
  evalRevisionCases,
  evalRevisionFiles,
  evalRevisions,
  evalSuites,
  runBenchmarks,
  skillDraftRevisions,
  skillDrafts,
  skillSnapshots,
  skillSnapshotFiles,
  skillTestArtifacts,
  skillTestRunScoreReports,
  skillTestRunScoreReportEvents,
  skillTestRunCases,
  skillTestRunEvents,
  skillTestRuns,
  skillVersions,
  type AssertionResultRow,
  type Database,
  type EvalRevisionCaseRow,
  type EvalRevisionFileRow,
  type SkillTestArtifactRow,
  type SkillTestRunScoreReportRow,
  type SkillTestRunScoreReportEventRow,
  type SkillTestRunCaseRow,
  type SkillTestRunEventRow,
  type SkillTestRunRow,
  type StoredAssertionEvidence,
  type StoredBenchmarkSide,
  type StoredTestRunUsage,
  type TestRunStatus,
} from "../../infrastructure/database/index.js"
import type {
  TestRunArtifactView,
  TestRunAssertionResultView,
  TestRunCaseView,
  TestRunDetailView,
  TestRunEvent,
  TestRunEnvironmentSnapshot,
  TestRunLogPage,
  TestRunLogQuery,
  TestRunPage,
  SkillScoreReportEvent,
  SkillScoreReportEventPage,
  SkillScoreReportDetailView,
  SkillScoreMetricsV1,
  SkillScoreReportPage,
  SkillScoreReportView,
  TestRunSkillScoreReportView,
  TestRunTraceability,
  TestRunView,
} from "./test-run.domain.js"
import { sanitizeTestRunPublicValue } from "./test-run-public-safety.js"
import { buildSkillScoreMetrics } from "./test-run-score-metrics.js"

const activeStatuses: readonly TestRunStatus[] = [
  "PREPARING",
  "RUNNING",
  "CANCELING",
]

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

export interface FrozenTestRunSelection {
  readonly workspaceId: string
  readonly skill: {
    readonly draftId: string | null
    readonly draftRevisionId: string | null
    readonly contentRevision: number | null
    readonly version: {
      readonly id: string
      readonly name: string
      readonly sequenceNumber: number
    } | null
    readonly snapshotId: string
    readonly manifestHash: string
    readonly storageLocator: string
    readonly files: readonly (typeof skillSnapshotFiles.$inferSelect)[]
  }
  readonly revision: {
    readonly id: string
    readonly suiteId: string
    readonly sequenceNumber: number
    readonly skillName: string
    readonly manifestHash: string
    readonly storageLocator: string
    readonly evalCount: number
  }
  readonly cases: readonly EvalRevisionCaseRow[]
  readonly files: readonly EvalRevisionFileRow[]
}

interface CreateCaseInput {
  readonly id: string
  readonly evalCase: EvalRevisionCaseRow
  readonly side: "TARGET" | "BASELINE"
  readonly executionOrder: number
  readonly inputFingerprint: string
  readonly participantExecutionFingerprint: string
  readonly skillInvocationObserved:
    | "NOT_APPLICABLE"
    | null
}

interface CreateRunInput {
  readonly id: string
  readonly mode: "target_vs_no_skill" | "version_vs_version"
  readonly executionPolicy:
    | "target_then_no_skill_serial_v1"
    | "paired_serial_alternating_v1"
  readonly targetSelection: FrozenTestRunSelection
  readonly baselineSelection: FrozenTestRunSelection | null
  readonly environment: TestRunEnvironmentSnapshot
  readonly traceability: TestRunTraceability
  readonly idempotencyKey: string
  readonly requestHash: string
  readonly cases: readonly CreateCaseInput[]
}

interface FreezeSelectionInput {
  readonly workspaceId: string
  readonly skillDraftRevisionId: string | null
  readonly skillVersionId: string | null
  readonly evalRevisionId: string
}

export interface CollectedArtifactInput {
  readonly id: string
  readonly relativePath: string
  readonly storageLocator: string
  readonly sha256: string
  readonly byteSize: number
  readonly mediaTypeHint: string
  readonly contentKind: "text" | "binary"
}

interface RunWithDisplay {
  readonly run: SkillTestRunRow
  readonly draftId: string | null
  readonly draftContentRevision: number | null
  readonly versionId: string | null
  readonly versionName: string | null
  readonly versionNumber: number | null
  readonly revisionNumber: number
  readonly evalCount: number
  readonly benchmarkTarget: StoredBenchmarkSide | null
  readonly benchmarkBaseline: StoredBenchmarkSide | null
  readonly baselineVersionName: string | null
  readonly baselineVersionNumber: number | null
}

interface CaseEventContext {
  readonly mode: "target_vs_no_skill" | "version_vs_version"
  readonly side: "TARGET" | "BASELINE"
  readonly subjectKind: "no_skill" | "skill_version" | "draft_snapshot"
  readonly versionId: string | null
  readonly versionNumber: number | null
  readonly evalRevisionCaseId: string
  readonly externalId: number
}

function caseEventPayload(
  context: CaseEventContext,
  phase: "execution" | "assertion" | "orchestration",
  extra: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> {
  return {
    ...extra,
    schemaVersion: 2,
    mode: context.mode,
    side: context.side,
    subjectKind: context.subjectKind,
    versionId: context.versionId,
    versionNumber: context.versionNumber,
    evalRevisionCaseId: context.evalRevisionCaseId,
    externalId: context.externalId,
    phase,
  }
}

function runNotFound(runId: string): DomainError {
  return new DomainError({
    code: "TEST_RUN_NOT_FOUND",
    message: "The requested Skill test run does not exist.",
    kind: "not_found",
    details: { runId },
  })
}

function mapEvent(row: SkillTestRunEventRow): TestRunEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    runId: row.runId,
    caseId: row.caseId,
    occurredAt: row.occurredAt.toISOString(),
    payload: sanitizeTestRunPublicValue(row.payload) as Readonly<
      Record<string, unknown>
    >,
  }
}

function mapRun(record: RunWithDisplay): TestRunView {
  const { run } = record
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    mode: run.mode,
    executionPolicy: run.executionPolicy,
    status: run.status,
    target: {
      draftId: record.draftId,
      draftRevisionId: run.skillDraftRevisionId,
      draftContentRevision: record.draftContentRevision,
      skillVersionId: record.versionId,
      skillVersionName: record.versionName,
      skillVersionNumber: record.versionNumber,
      skillSnapshotId: run.skillSnapshotId,
      evalRevisionId: run.evalRevisionId,
      evalRevisionNumber: record.revisionNumber,
      evalCount: record.evalCount,
    },
    baseline:
      run.mode === "version_vs_version"
        ? {
            kind: "skill_version",
            skillVersionId: run.baselineSkillVersionId!,
            skillVersionName: record.baselineVersionName!,
            skillVersionNumber: record.baselineVersionNumber!,
            skillSnapshotId: run.baselineSkillSnapshotId!,
            skillManifestHash: run.baselineSkillManifestHash!,
          }
        : {
            kind: "no_skill",
            skillVersionId: null,
            skillSnapshotId: null,
          },
    environment: sanitizeTestRunPublicValue(
      run.environmentSnapshot,
    ) as TestRunEnvironmentSnapshot,
    traceability: {
      protocolVersion: run.protocolVersion,
      sdkVersion: run.sdkVersion,
      configurationFingerprint: run.configurationFingerprint,
      semanticConfigurationFingerprint:
        run.semanticConfigurationFingerprint,
      executionSettingsFingerprint: run.configurationFingerprint,
      gradingSettingsFingerprint: run.configurationFingerprint,
      environmentFingerprint: run.environmentFingerprint,
      skillManifestHash: run.skillManifestHash,
      baselineSkillManifestHash: run.baselineSkillManifestHash,
      evalManifestHash: run.evalManifestHash,
      comparabilityFingerprint: run.comparabilityFingerprint,
      runInputFingerprint: run.runInputFingerprint,
      executionPromptVersion: run.executionPromptVersion,
      graderProtocolVersion: run.graderProtocolVersion,
      toolPermissionPolicyVersion: run.toolPermissionPolicyVersion,
    },
    progress: {
      totalCases: run.totalCaseCount,
      completedCases: run.completedCaseCount,
    },
    benchmark:
      record.benchmarkTarget && record.benchmarkBaseline
        ? {
            target: normalizeBenchmarkSide(record.benchmarkTarget),
            baseline: normalizeBenchmarkSide(record.benchmarkBaseline),
          }
        : null,
    error:
      run.errorCode && run.errorMessage
        ? {
            code: run.errorCode,
            message: String(
              sanitizeTestRunPublicValue(run.errorMessage),
            ),
            details: (sanitizeTestRunPublicValue(
              run.errorDetails ?? null,
            ) ?? null) as Readonly<Record<string, unknown>> | null,
          }
        : null,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
    startedAt: run.startedAt?.toISOString() ?? null,
    completedAt: run.completedAt?.toISOString() ?? null,
  }
}

function groupByCaseId<Row extends { readonly caseId: string }>(
  rows: readonly Row[],
): Map<string, Row[]> {
  const grouped = new Map<string, Row[]>()
  for (const row of rows) {
    const group = grouped.get(row.caseId) ?? []
    group.push(row)
    grouped.set(row.caseId, group)
  }
  return grouped
}

function mapArtifact(
  runId: string,
  row: SkillTestArtifactRow,
): TestRunArtifactView {
  return {
    id: row.id,
    relativePath: row.relativePath,
    sha256: row.sha256,
    byteSize: row.byteSize,
    mediaTypeHint: row.mediaTypeHint,
    contentKind: row.contentKind as "text" | "binary",
    downloadUrl: `/api/test-runs/${runId}/artifacts/${row.id}/download`,
  }
}

function normalizeBenchmarkSide(
  side: StoredBenchmarkSide,
): StoredBenchmarkSide {
  return {
    ...side,
    gradingDurationMs: side.gradingDurationMs ?? 0,
    gradingInputTokens: side.gradingInputTokens ?? 0,
    gradingOutputTokens: side.gradingOutputTokens ?? 0,
    gradingTotalCostUsd: side.gradingTotalCostUsd ?? 0,
    gradingNumTurns: side.gradingNumTurns ?? 0,
  }
}

function mapAssertion(
  row: AssertionResultRow,
): TestRunAssertionResultView {
  return {
    id: row.id,
    assertionIndex: row.assertionIndex,
    assertion: row.assertion,
    status: row.status,
    reason: String(sanitizeTestRunPublicValue(row.reason)),
    evidence: sanitizeTestRunPublicValue(
      row.evidence,
    ) as readonly StoredAssertionEvidence[],
  }
}

function mapCase(
  runId: string,
  row: SkillTestRunCaseRow,
  artifacts: readonly SkillTestArtifactRow[],
  assertions: readonly AssertionResultRow[],
): TestRunCaseView {
  return {
    id: row.id,
    evalRevisionCaseId: row.evalRevisionCaseId,
    externalId: row.externalId,
    name: row.name,
    side: row.side,
    executionOrder: row.executionOrder,
    prompt: row.prompt,
    expectedOutput: row.expectedOutput,
    assertions: row.assertions,
    files: row.files,
    inputFingerprint: row.inputFingerprint,
    participantExecutionFingerprint:
      row.participantExecutionFingerprint,
    executionStatus: row.executionStatus,
    assessmentStatus: row.assessmentStatus,
    finalOutput: row.finalOutput,
    assertionAgentSessionId: row.assertionAgentSessionId,
    assertionAgentRawResponse: row.assertionAgentRawResponse,
    assertionAgentJson: row.assertionAgentJson ?? null,
    assertionJsonParseError: row.assertionJsonParseError,
    usage: row.usage,
    gradingUsage: row.gradingUsage,
    skillInvocationObserved: row.skillInvocationObserved,
    skillToolCallCount: row.skillToolCallCount,
    bundledScriptUses: row.bundledScriptUses,
    executionError:
      row.executionErrorCode && row.executionErrorMessage
        ? {
            code: row.executionErrorCode,
            message: String(
              sanitizeTestRunPublicValue(row.executionErrorMessage),
            ),
          }
        : null,
    assessmentError:
      row.assessmentErrorCode && row.assessmentErrorMessage
        ? {
            code: row.assessmentErrorCode,
            message: String(
              sanitizeTestRunPublicValue(row.assessmentErrorMessage),
            ),
          }
        : null,
    assertionResults: assertions.map(mapAssertion),
    artifacts: artifacts.map((artifact) => mapArtifact(runId, artifact)),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    executionCompletedAt:
      row.executionCompletedAt?.toISOString() ?? null,
    assessmentCompletedAt:
      row.assessmentCompletedAt?.toISOString() ?? null,
  }
}

function mapSkillScoreReport(
  row: SkillTestRunScoreReportRow,
): TestRunSkillScoreReportView {
  return {
    id: row.id,
    status: row.status,
    documentUrl:
      row.status === "AVAILABLE"
        ? `/api/skill-score-reports/${row.id}/document.html`
        : null,
    error:
      row.errorCode && row.errorMessage
        ? {
            code: row.errorCode,
            message: String(sanitizeTestRunPublicValue(row.errorMessage)),
          }
        : null,
    createdAt: row.createdAt.toISOString(),
    startedAt: row.startedAt?.toISOString() ?? null,
    completedAt: row.completedAt?.toISOString() ?? null,
  }
}

function mapScoreReportEvent(
  row: SkillTestRunScoreReportEventRow,
): SkillScoreReportEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    reportId: row.reportId,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
  }
}

function mapScoreReport(
  row: SkillTestRunScoreReportRow,
  workspaceId: string,
): SkillScoreReportView {
  return {
    ...mapSkillScoreReport(row),
    runId: row.runId,
    workspaceId,
  }
}

function skillScoreReportNotFound(reportId: string): DomainError {
  return new DomainError({
    code: "TEST_RUN_SKILL_SCORE_NOT_FOUND",
    message: "The requested Skill score report was not found.",
    kind: "not_found",
    details: { reportId },
  })
}

export class TestRunRepository {
  constructor(private readonly database: Database) {}

  async freezeSelection({
    workspaceId,
    skillDraftRevisionId,
    skillVersionId,
    evalRevisionId,
  }: FreezeSelectionInput): Promise<FrozenTestRunSelection> {
    const [skill, revision] = await Promise.all([
      skillDraftRevisionId
        ? this.resolveDraftSkill(
            workspaceId,
            skillDraftRevisionId,
            skillVersionId,
          )
        : this.resolveLegacyVersionSkill(workspaceId, skillVersionId),
      this.resolveEvalRevision(workspaceId, evalRevisionId),
    ])

    if (!skill || !revision) {
      throw new DomainError({
        code: "TEST_RUN_SELECTION_NOT_FOUND",
        message:
          "The frozen Skill working copy and Evals revision must both belong to this workbench.",
        kind: "not_found",
        details: {
          workspaceId,
          skillDraftRevisionId,
          skillVersionId,
          evalRevisionId,
        },
      })
    }
    if (skill.snapshotState !== "READY") {
      throw new DomainError({
        code: "TEST_RUN_SKILL_SNAPSHOT_NOT_READY",
        message: "The frozen Skill working-copy Snapshot is not ready.",
        kind: "conflict",
        details: {
          skillDraftRevisionId,
          snapshotState: skill.snapshotState,
        },
      })
    }

    const [cases, files, skillFiles] = await Promise.all([
      this.database
        .select()
        .from(evalRevisionCases)
        .where(eq(evalRevisionCases.revisionId, evalRevisionId))
        .orderBy(asc(evalRevisionCases.externalId)),
      this.database
        .select()
        .from(evalRevisionFiles)
        .where(eq(evalRevisionFiles.revisionId, evalRevisionId))
        .orderBy(asc(evalRevisionFiles.relativePath)),
      this.database
        .select()
        .from(skillSnapshotFiles)
        .where(eq(skillSnapshotFiles.snapshotId, skill.snapshotId))
        .orderBy(asc(skillSnapshotFiles.relativePath)),
    ])

    if (
      cases.length === 0 ||
      cases.length !== revision.evalCount ||
      skillFiles.length === 0
    ) {
      throw new DomainError({
        code: "TEST_RUN_EVAL_REVISION_INCOMPLETE",
        message:
          "The selected Evals revision cannot be reconstructed from its immutable cases.",
        kind: "conflict",
        details: {
          evalRevisionId,
          expectedCases: revision.evalCount,
          actualCases: cases.length,
          skillFileCount: skillFiles.length,
        },
      })
    }

    return {
      workspaceId,
      skill: {
        draftId: skill.draftId,
        draftRevisionId: skill.draftRevisionId,
        contentRevision: skill.contentRevision,
        version: skill.versionId
          ? {
              id: skill.versionId,
              name: skill.versionName!,
              sequenceNumber: skill.versionNumber!,
            }
          : null,
        snapshotId: skill.snapshotId,
        manifestHash: skill.snapshotManifestHash,
        storageLocator: skill.snapshotStorageLocator,
        files: skillFiles,
      },
      revision: {
        id: revision.id,
        suiteId: revision.suiteId,
        sequenceNumber: revision.sequenceNumber,
        skillName: revision.skillName,
        manifestHash: revision.manifestHash,
        storageLocator: revision.storageLocator,
        evalCount: revision.evalCount,
      },
      cases,
      files,
    }
  }

  private async resolveDraftSkill(
    workspaceId: string,
    draftRevisionId: string,
    resolvedVersionId: string | null,
  ) {
    const [draft] = await this.database
      .select({
        draftId: skillDrafts.id,
        draftRevisionId: skillDraftRevisions.id,
        contentRevision: skillDraftRevisions.sourceContentRevision,
        snapshotId: skillSnapshots.id,
        snapshotState: skillSnapshots.state,
        snapshotManifestHash: skillSnapshots.manifestHash,
        snapshotStorageLocator: skillSnapshots.storageLocator,
      })
      .from(skillDraftRevisions)
      .innerJoin(
        skillDrafts,
        eq(skillDrafts.id, skillDraftRevisions.draftId),
      )
      .innerJoin(
        skillSnapshots,
        eq(skillSnapshots.id, skillDraftRevisions.snapshotId),
      )
      .where(
        and(
          eq(skillDraftRevisions.id, draftRevisionId),
          eq(skillDrafts.workspaceId, workspaceId),
        ),
      )
      .limit(1)
    if (!draft) return null

    const [version] = await this.database
      .select({
        id: skillVersions.id,
        name: skillVersions.name,
        sequenceNumber: skillVersions.sequenceNumber,
      })
      .from(skillVersions)
      .innerJoin(
        skillSnapshots,
        eq(skillSnapshots.id, skillVersions.snapshotId),
      )
      .where(
        resolvedVersionId
          ? and(
              eq(skillVersions.id, resolvedVersionId),
              eq(skillVersions.workspaceId, workspaceId),
              eq(skillVersions.sourceDraftId, draft.draftId),
              eq(
                skillVersions.sourceContentRevision,
                draft.contentRevision,
              ),
              eq(
                skillSnapshots.manifestHash,
                draft.snapshotManifestHash,
              ),
            )
          : and(
              eq(skillVersions.workspaceId, workspaceId),
              eq(skillVersions.sourceDraftId, draft.draftId),
              eq(
                skillVersions.sourceContentRevision,
                draft.contentRevision,
              ),
              eq(
                skillSnapshots.manifestHash,
                draft.snapshotManifestHash,
              ),
            ),
      )
      .orderBy(
        asc(skillVersions.frozenAt),
        asc(skillVersions.sequenceNumber),
      )
      .limit(1)

    return {
      ...draft,
      versionId: version?.id ?? null,
      versionName: version?.name ?? null,
      versionNumber: version?.sequenceNumber ?? null,
    }
  }

  private async resolveLegacyVersionSkill(
    workspaceId: string,
    skillVersionId: string | null,
  ) {
    if (!skillVersionId) return null
    const [record] = await this.database
      .select({
        draftId: skillVersions.sourceDraftId,
        draftRevisionId: sql<string | null>`null`,
        contentRevision: skillVersions.sourceContentRevision,
        versionId: skillVersions.id,
        versionName: skillVersions.name,
        versionNumber: skillVersions.sequenceNumber,
        snapshotId: skillSnapshots.id,
        snapshotState: skillSnapshots.state,
        snapshotManifestHash: skillSnapshots.manifestHash,
        snapshotStorageLocator: skillSnapshots.storageLocator,
      })
      .from(skillVersions)
      .innerJoin(
        skillSnapshots,
        eq(skillSnapshots.id, skillVersions.snapshotId),
      )
      .where(
        and(
          eq(skillVersions.id, skillVersionId),
          eq(skillVersions.workspaceId, workspaceId),
        ),
      )
      .limit(1)
    return record ?? null
  }

  private async resolveEvalRevision(
    workspaceId: string,
    evalRevisionId: string,
  ) {
    const [revision] = await this.database
      .select({
        id: evalRevisions.id,
        suiteId: evalRevisions.suiteId,
        sequenceNumber: evalRevisions.sequenceNumber,
        skillName: evalRevisions.skillName,
        manifestHash: evalRevisions.manifestHash,
        storageLocator: evalRevisions.storageLocator,
        evalCount: evalRevisions.evalCount,
      })
      .from(evalRevisions)
      .innerJoin(evalSuites, eq(evalSuites.id, evalRevisions.suiteId))
      .where(
        and(
          eq(evalRevisions.id, evalRevisionId),
          eq(evalSuites.workspaceId, workspaceId),
        ),
      )
      .limit(1)
    return revision ?? null
  }

  async findByIdempotencyKey(
    workspaceId: string,
    idempotencyKey: string,
  ): Promise<SkillTestRunRow | null> {
    const [run] = await this.database
      .select()
      .from(skillTestRuns)
      .where(
        and(
          eq(skillTestRuns.workspaceId, workspaceId),
          eq(skillTestRuns.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1)
    return run ?? null
  }

  async create(input: CreateRunInput): Promise<TestRunDetailView> {
    try {
      await this.database.transaction(async (transaction) => {
        const target = input.targetSelection
        const baseline = input.baselineSelection
        await transaction.insert(skillTestRuns).values({
          id: input.id,
          workspaceId: target.workspaceId,
          skillVersionId: target.skill.version?.id ?? null,
          skillDraftRevisionId: target.skill.draftRevisionId,
          skillSnapshotId: target.skill.snapshotId,
          baselineSkillVersionId: baseline?.skill.version?.id ?? null,
          baselineSkillSnapshotId: baseline?.skill.snapshotId ?? null,
          evalRevisionId: target.revision.id,
          mode: input.mode,
          executionPolicy: input.executionPolicy,
          status: "PREPARING",
          protocolVersion: input.traceability.protocolVersion,
          sdkVersion: input.traceability.sdkVersion,
          configurationFingerprint:
            input.traceability.configurationFingerprint,
          semanticConfigurationFingerprint:
            input.traceability.semanticConfigurationFingerprint,
          environmentFingerprint:
            input.traceability.environmentFingerprint,
          environmentSnapshot: input.environment,
          skillManifestHash: input.traceability.skillManifestHash,
          baselineSkillManifestHash:
            input.traceability.baselineSkillManifestHash,
          evalManifestHash: input.traceability.evalManifestHash,
          comparabilityFingerprint:
            input.traceability.comparabilityFingerprint,
          runInputFingerprint:
            input.traceability.runInputFingerprint,
          executionPromptVersion:
            input.traceability.executionPromptVersion,
          graderProtocolVersion:
            input.traceability.graderProtocolVersion,
          toolPermissionPolicyVersion:
            input.traceability.toolPermissionPolicyVersion,
          idempotencyKey: input.idempotencyKey,
          requestHash: input.requestHash,
          totalCaseCount: input.cases.length,
        })
        await transaction.insert(skillTestRunCases).values(
          input.cases.map((runCase) => ({
            id: runCase.id,
            runId: input.id,
            evalRevisionCaseId: runCase.evalCase.id,
            side: runCase.side,
            executionOrder: runCase.executionOrder,
            externalId: runCase.evalCase.externalId,
            name: runCase.evalCase.name,
            prompt: runCase.evalCase.prompt,
            expectedOutput: runCase.evalCase.expectedOutput,
            assertions: runCase.evalCase.assertions,
            files: runCase.evalCase.files,
            inputFingerprint: runCase.inputFingerprint,
            participantExecutionFingerprint:
              runCase.participantExecutionFingerprint,
            skillInvocationObserved:
              runCase.skillInvocationObserved,
            executionStatus: "PENDING" as const,
            assessmentStatus: "PENDING" as const,
          })),
        )
        await this.appendEvent(transaction, input.id, null, "run.created", {
          schemaVersion: 2,
          mode: input.mode,
          executionPolicy: input.executionPolicy,
          draftRevisionId: target.skill.draftRevisionId,
          draftContentRevision: target.skill.contentRevision,
          skillVersionId: target.skill.version?.id ?? null,
          baselineSkillVersionId: baseline?.skill.version?.id ?? null,
          evalRevisionId: target.revision.id,
          totalCases: input.cases.length,
          comparabilityFingerprint:
            input.traceability.comparabilityFingerprint,
        })
        for (const runCase of input.cases) {
          await this.appendEvent(
            transaction,
            input.id,
            runCase.id,
            "case.queued",
            {
              schemaVersion: 2,
              mode: input.mode,
              side: runCase.side,
              subjectKind:
                input.mode === "target_vs_no_skill" &&
                runCase.side === "BASELINE"
                  ? "no_skill"
                  : target.skill.draftRevisionId
                    ? "draft_snapshot"
                    : "skill_version",
              versionId:
                runCase.side === "TARGET"
                  ? target.skill.version?.id ?? null
                  : baseline?.skill.version?.id ?? null,
              versionNumber:
                runCase.side === "TARGET"
                  ? target.skill.version?.sequenceNumber ?? null
                  : baseline?.skill.version?.sequenceNumber ?? null,
              evalRevisionCaseId: runCase.evalCase.id,
              externalId: runCase.evalCase.externalId,
              inputFingerprint: runCase.inputFingerprint,
              participantExecutionFingerprint:
                runCase.participantExecutionFingerprint,
              phase: "orchestration",
            },
          )
        }
      })
      return this.getDetail(input.id)
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(
          input.targetSelection.workspaceId,
          input.idempotencyKey,
        )
        if (existing) {
          if (existing.requestHash !== input.requestHash) {
            throw new DomainError({
              code: "TEST_RUN_IDEMPOTENCY_CONFLICT",
              message:
                "The idempotency key was already used with a different test run selection.",
              kind: "conflict",
            })
          }
          return this.getDetail(existing.id)
        }
        throw new DomainError({
          code: "TEST_RUN_ALREADY_ACTIVE",
          message:
            "This Skill workbench already has an active test run.",
          kind: "conflict",
        })
      }
      throw error
    }
  }

  async get(runId: string): Promise<TestRunView> {
    return mapRun(await this.getRunRecord(runId))
  }

  async getDetail(runId: string): Promise<TestRunDetailView> {
    const [runRecord, cases, scoreReport] = await Promise.all([
      this.getRunRecord(runId),
      this.database
        .select()
        .from(skillTestRunCases)
        .where(eq(skillTestRunCases.runId, runId))
        .orderBy(asc(skillTestRunCases.executionOrder)),
      this.database
        .select()
        .from(skillTestRunScoreReports)
        .where(eq(skillTestRunScoreReports.runId, runId))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ])
    const caseIds = cases.map((runCase) => runCase.id)
    const [artifacts, assertions] =
      caseIds.length === 0
        ? [[], []]
        : await Promise.all([
            this.database
              .select()
              .from(skillTestArtifacts)
              .where(inArray(skillTestArtifacts.caseId, caseIds))
              .orderBy(asc(skillTestArtifacts.relativePath)),
            runRecord.run.protocolVersion === "skill-test-run-agent-chain-v6"
              ? Promise.resolve([])
              : this.database
                  .select()
                  .from(assertionResults)
                  .where(inArray(assertionResults.caseId, caseIds))
                  .orderBy(asc(assertionResults.assertionIndex)),
          ])
    const artifactsByCase = groupByCaseId(artifacts)
    const assertionsByCase = groupByCaseId(assertions)

    return {
      ...mapRun(runRecord),
      cases: cases.map((runCase) =>
        mapCase(
          runId,
          runCase,
          artifactsByCase.get(runCase.id) ?? [],
          assertionsByCase.get(runCase.id) ?? [],
        ),
      ),
      skillScoreReport: scoreReport ? mapSkillScoreReport(scoreReport) : null,
    }
  }

  async list(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<TestRunPage> {
    const offset = (page - 1) * pageSize
    const [records, totals] = await Promise.all([
      this.baseRunQuery()
        .where(eq(skillTestRuns.workspaceId, workspaceId))
        .orderBy(desc(skillTestRuns.createdAt))
        .limit(pageSize)
        .offset(offset),
      this.database
        .select({
          total: count(),
          active: sql<number>`count(*) filter (where ${skillTestRuns.status} in ('PREPARING', 'RUNNING', 'CANCELING'))::int`,
          completed: sql<number>`count(*) filter (where ${skillTestRuns.status} = 'COMPLETED')::int`,
          interrupted: sql<number>`count(*) filter (where ${skillTestRuns.status} = 'INTERRUPTED')::int`,
          failed: sql<number>`count(*) filter (where ${skillTestRuns.status} = 'FAILED')::int`,
        })
        .from(skillTestRuns)
        .where(eq(skillTestRuns.workspaceId, workspaceId)),
    ])
    const summary = totals[0] ?? {
      total: 0,
      active: 0,
      completed: 0,
      interrupted: 0,
      failed: 0,
    }

    return {
      items: records.map(mapRun),
      pagination: {
        page,
        pageSize,
        total: summary.total,
        pageCount:
          summary.total === 0 ? 0 : Math.ceil(summary.total / pageSize),
      },
      summary,
    }
  }

  async listEvents(
    runId: string,
    afterSequence: number,
  ): Promise<readonly TestRunEvent[]> {
    await this.get(runId)
    return (
      await this.database
        .select()
        .from(skillTestRunEvents)
        .where(
          and(
            eq(skillTestRunEvents.runId, runId),
            gt(skillTestRunEvents.sequence, afterSequence),
          ),
        )
        .orderBy(asc(skillTestRunEvents.sequence))
    ).map(mapEvent)
  }

  async listLogs(
    runId: string,
    query: TestRunLogQuery,
  ): Promise<TestRunLogPage> {
    await this.get(runId)
    const phaseCondition = query.phase
      ? query.phase === "execution"
        ? sql<boolean>`(${skillTestRunEvents.type} like 'execution.%'
            or ${skillTestRunEvents.type} like 'case.execution.%')`
        : query.phase === "assertion"
          ? sql<boolean>`(${skillTestRunEvents.type} like 'assertion.%'
              or ${skillTestRunEvents.type} like 'case.assertion.%')`
          : sql<boolean>`(${skillTestRunEvents.type} not like 'execution.%'
              and ${skillTestRunEvents.type} not like 'case.execution.%'
              and ${skillTestRunEvents.type} not like 'assertion.%'
              and ${skillTestRunEvents.type} not like 'case.assertion.%')`
      : undefined
    const rows = await this.database
      .select({ event: skillTestRunEvents })
      .from(skillTestRunEvents)
      .leftJoin(
        skillTestRunCases,
        eq(skillTestRunCases.id, skillTestRunEvents.caseId),
      )
      .where(
        and(
          eq(skillTestRunEvents.runId, runId),
          query.beforeSequence
            ? lt(skillTestRunEvents.sequence, query.beforeSequence)
            : undefined,
          query.side ? eq(skillTestRunCases.side, query.side) : undefined,
          query.externalId
            ? eq(skillTestRunCases.externalId, query.externalId)
            : undefined,
          phaseCondition,
        ),
      )
      .orderBy(desc(skillTestRunEvents.sequence))
      .limit(query.limit + 1)
    const hasMore = rows.length > query.limit
    const items = rows
      .slice(0, query.limit)
      .map(({ event }) => mapEvent(event))
      .reverse()
    return {
      items,
      pagination: {
        limit: query.limit,
        hasMore,
        nextBeforeSequence: hasMore ? items[0]?.sequence ?? null : null,
      },
    }
  }

  async getRow(runId: string): Promise<SkillTestRunRow> {
    const [run] = await this.database
      .select()
      .from(skillTestRuns)
      .where(eq(skillTestRuns.id, runId))
      .limit(1)
    if (!run) throw runNotFound(runId)
    return run
  }

  async listCaseRows(
    runId: string,
  ): Promise<readonly SkillTestRunCaseRow[]> {
    await this.getRow(runId)
    return this.database
      .select()
      .from(skillTestRunCases)
      .where(eq(skillTestRunCases.runId, runId))
      .orderBy(asc(skillTestRunCases.executionOrder))
  }

  async getCaseRow(caseId: string): Promise<SkillTestRunCaseRow> {
    const [runCase] = await this.database
      .select()
      .from(skillTestRunCases)
      .where(eq(skillTestRunCases.id, caseId))
      .limit(1)
    if (!runCase) {
      throw new DomainError({
        code: "TEST_RUN_CASE_NOT_FOUND",
        message: "The requested Skill test run Case does not exist.",
        kind: "not_found",
        details: { caseId },
      })
    }
    return runCase
  }

  private async getCaseEventContext(
    transaction: Transaction,
    runCase: SkillTestRunCaseRow,
  ): Promise<CaseEventContext> {
    const [context] = await transaction
      .select({
        mode: skillTestRuns.mode,
        targetVersionId: skillTestRuns.skillVersionId,
        targetDraftRevisionId: skillTestRuns.skillDraftRevisionId,
        baselineVersionId: skillTestRuns.baselineSkillVersionId,
        targetVersionNumber: skillVersions.sequenceNumber,
        baselineVersionNumber: sql<
          number | null
        >`(select ${skillVersions.sequenceNumber}
            from ${skillVersions}
            where ${skillVersions.id} = ${skillTestRuns.baselineSkillVersionId})`,
      })
      .from(skillTestRuns)
      .leftJoin(
        skillVersions,
        eq(skillVersions.id, skillTestRuns.skillVersionId),
      )
      .where(eq(skillTestRuns.id, runCase.runId))
      .limit(1)
    if (!context) throw runNotFound(runCase.runId)
    if (
      runCase.side === "BASELINE" &&
      context.mode === "target_vs_no_skill"
    ) {
      return {
        mode: context.mode,
        side: runCase.side,
        subjectKind: "no_skill",
        versionId: null,
        versionNumber: null,
        evalRevisionCaseId: runCase.evalRevisionCaseId,
        externalId: runCase.externalId,
      }
    }
    const isTarget = runCase.side === "TARGET"
    return {
      mode: context.mode,
      side: runCase.side,
      subjectKind:
        isTarget && context.targetDraftRevisionId
          ? "draft_snapshot"
          : "skill_version",
      versionId: isTarget
        ? context.targetVersionId
        : context.baselineVersionId,
      versionNumber: isTarget
        ? context.targetVersionNumber
        : context.baselineVersionNumber,
      evalRevisionCaseId: runCase.evalRevisionCaseId,
      externalId: runCase.externalId,
    }
  }

  async appendOrchestrationEvent(
    runId: string,
    caseId: string | null,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<TestRunEvent> {
    return this.database.transaction((transaction) =>
      this.appendEvent(transaction, runId, caseId, type, {
        ...payload,
        schemaVersion: 2,
        phase: "orchestration",
      }),
    )
  }

  async markRunRunning(runId: string): Promise<TestRunEvent | null> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .update(skillTestRuns)
        .set({
          status: "RUNNING",
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(skillTestRuns.id, runId),
            eq(skillTestRuns.status, "PREPARING"),
          ),
        )
        .returning()
      if (!run) return null
      return this.appendEvent(transaction, runId, null, "run.started", {
        schemaVersion: 1,
        status: run.status,
      })
    })
  }

  async markCasePreparing(
    caseId: string,
    workspaceLocator: string,
  ): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (runCase.executionStatus !== "PENDING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not pending execution.",
          kind: "conflict",
          details: { caseId },
        })
      }
      const [activeRun] = await transaction
        .select({ id: skillTestRuns.id })
        .from(skillTestRuns)
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "RUNNING"),
          ),
        )
        .for("update")
      if (!activeRun) {
        throw new DomainError({
          code: "TEST_RUN_STATE_CONFLICT",
          message: "The test run is no longer accepting executions.",
          kind: "conflict",
          details: { runId: runCase.runId },
        })
      }
      const [updatedCase] = await transaction
        .update(skillTestRunCases)
        .set({
          executionStatus: "PREPARING",
          workspaceLocator,
          startedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, caseId))
        .returning()
      if (!updatedCase) throw new Error("Test Case update returned no row.")
      const context = await this.getCaseEventContext(transaction, updatedCase)
      return this.appendEvent(
        transaction,
        updatedCase.runId,
        caseId,
        "case.preparing",
        caseEventPayload(context, "orchestration"),
      )
    })
  }

  async bindExecutionSession(
    caseId: string,
    sessionId: string,
  ): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (runCase.executionStatus !== "PREPARING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not ready to start execution.",
          kind: "conflict",
          details: { caseId },
        })
      }
      const [activeRun] = await transaction
        .select({ id: skillTestRuns.id })
        .from(skillTestRuns)
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "RUNNING"),
          ),
        )
        .for("update")
      if (!activeRun) {
        throw new DomainError({
          code: "TEST_RUN_STATE_CONFLICT",
          message: "The test run is no longer accepting executions.",
          kind: "conflict",
          details: { runId: runCase.runId },
        })
      }
      const [updatedCase] = await transaction
        .update(skillTestRunCases)
        .set({
          executionStatus: "RUNNING",
          executionAgentSessionId: sessionId,
          updatedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, caseId))
        .returning()
      if (!updatedCase) throw new Error("Test Case update returned no row.")
      const context = await this.getCaseEventContext(transaction, updatedCase)
      return this.appendEvent(
        transaction,
        updatedCase.runId,
        caseId,
        "case.execution.started",
        caseEventPayload(context, "execution"),
      )
    })
  }

  async recordAgentEvent(input: {
    readonly runId: string
    readonly caseId: string
    readonly sessionId: string
    readonly sourceSequence: number
    readonly phase: "execution" | "assertion"
    readonly mode: "target_vs_no_skill" | "version_vs_version"
    readonly side: "TARGET" | "BASELINE"
    readonly subjectKind: "no_skill" | "skill_version" | "draft_snapshot"
    readonly versionId: string | null
    readonly versionNumber: number | null
    readonly evalRevisionCaseId: string
    readonly externalId: number
    readonly type: string
    readonly payload: Readonly<Record<string, unknown>>
  }): Promise<TestRunEvent | null> {
    try {
      return await this.database.transaction(async (transaction) => {
        const event = await this.appendEvent(
          transaction,
          input.runId,
          input.caseId,
          `${input.phase}.${input.type}`,
          {
            ...(sanitizeTestRunPublicValue(input.payload) as Readonly<
              Record<string, unknown>
            >),
            schemaVersion: 2,
            mode: input.mode,
            side: input.side,
            subjectKind: input.subjectKind,
            versionId: input.versionId,
            versionNumber: input.versionNumber,
            evalRevisionCaseId: input.evalRevisionCaseId,
            externalId: input.externalId,
            phase: input.phase,
          },
        )
        await transaction
          .update(skillTestRunEvents)
          .set({
            sourceAgentSessionId: input.sessionId,
            sourceAgentSequence: input.sourceSequence,
          })
          .where(
            and(
              eq(skillTestRunEvents.runId, input.runId),
              eq(skillTestRunEvents.sequence, event.sequence),
            ),
          )
        return event
      })
    } catch (error) {
      if (this.isUniqueViolation(error)) return null
      throw error
    }
  }

  async completeExecution(input: {
    readonly caseId: string
    readonly finalOutput: string
    readonly usage: StoredTestRunUsage
    readonly skillInvocationObserved:
      | "OBSERVED"
      | "NOT_OBSERVED"
      | "NOT_APPLICABLE"
    readonly skillToolCallCount: number
    readonly bundledScriptUses: readonly {
      readonly relativePath: string
      readonly count: number
      readonly evidenceSequences: readonly number[]
    }[]
    readonly artifacts: readonly CollectedArtifactInput[]
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, input.caseId)
      if (runCase.executionStatus !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not running.",
          kind: "conflict",
          details: {
            caseId: input.caseId,
            executionStatus: runCase.executionStatus,
          },
        })
      }
      if (input.artifacts.length > 0) {
        await transaction.insert(skillTestArtifacts).values(
          input.artifacts.map((artifact) => ({
            ...artifact,
            caseId: input.caseId,
          })),
        )
      }
      await transaction
        .update(skillTestRunCases)
        .set({
          executionStatus: "COMPLETED",
          finalOutput: input.finalOutput,
          usage: input.usage,
          skillInvocationObserved: input.skillInvocationObserved,
          skillToolCallCount: input.skillToolCallCount,
          bundledScriptUses: input.bundledScriptUses,
          updatedAt: new Date(),
          executionCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      const context = await this.getCaseEventContext(transaction, runCase)
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        "case.execution.completed",
        caseEventPayload(context, "execution", {
          artifactCount: input.artifacts.length,
          usage: input.usage,
        }),
      )
    })
  }

  async failExecution(input: {
    readonly caseId: string
    readonly status: "FAILED" | "CANCELED" | "INTERRUPTED"
    readonly code: string
    readonly message: string
    readonly usage?: StoredTestRunUsage | null
    readonly observations?: {
      readonly skillInvocationObserved:
        | "OBSERVED"
        | "NOT_OBSERVED"
        | "NOT_APPLICABLE"
      readonly skillToolCallCount: number
      readonly bundledScriptUses: readonly {
        readonly relativePath: string
        readonly count: number
        readonly evidenceSequences: readonly number[]
      }[]
    }
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, input.caseId)
      const safeMessage = String(sanitizeTestRunPublicValue(input.message))
      if (
        ["COMPLETED", "FAILED", "CANCELED", "INTERRUPTED"].includes(
          runCase.executionStatus,
        )
      ) {
        const existing = await this.latestEventForCase(
          transaction,
          runCase.runId,
          input.caseId,
        )
        if (existing) return existing
      }
      await transaction
        .update(skillTestRunCases)
        .set({
          executionStatus: input.status,
          assessmentStatus: "NOT_EVALUATED",
          ...(input.usage !== undefined ? { usage: input.usage } : {}),
          ...(input.observations
            ? {
                skillInvocationObserved:
                  input.observations.skillInvocationObserved,
                skillToolCallCount: input.observations.skillToolCallCount,
                bundledScriptUses: input.observations.bundledScriptUses,
              }
            : {}),
          executionErrorCode: input.code,
          executionErrorMessage: safeMessage,
          assessmentErrorCode: input.code,
          assessmentErrorMessage:
            "Assertions were not evaluated because execution did not complete.",
          updatedAt: new Date(),
          executionCompletedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      await this.incrementCompletedCases(transaction, runCase.runId)
      const context = await this.getCaseEventContext(transaction, runCase)
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        `case.execution.${input.status.toLowerCase()}`,
        caseEventPayload(context, "execution", {
          error: { code: input.code, message: safeMessage },
          ...(input.usage !== undefined ? { usage: input.usage } : {}),
        }),
      )
    })
  }

  async beginAssertion(caseId: string): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (
        runCase.executionStatus !== "COMPLETED" ||
        runCase.assessmentStatus !== "PENDING"
      ) {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not ready for assertion.",
          kind: "conflict",
          details: {
            caseId,
            executionStatus: runCase.executionStatus,
            assessmentStatus: runCase.assessmentStatus,
          },
        })
      }
      const [activeRun] = await transaction
        .select({ id: skillTestRuns.id })
        .from(skillTestRuns)
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "RUNNING"),
          ),
        )
        .for("update")
      if (!activeRun) {
        throw new DomainError({
          code: "TEST_RUN_STATE_CONFLICT",
          message: "The test run is no longer accepting assessments.",
          kind: "conflict",
          details: { runId: runCase.runId },
        })
      }
      await transaction
        .update(skillTestRunCases)
        .set({ assessmentStatus: "RUNNING", updatedAt: new Date() })
        .where(eq(skillTestRunCases.id, caseId))
      const context = await this.getCaseEventContext(transaction, runCase)
      return this.appendEvent(
        transaction,
        runCase.runId,
        caseId,
        "case.assertion.started",
        caseEventPayload(context, "assertion"),
      )
    })
  }

  async bindAssertionSession(
    caseId: string,
    sessionId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (runCase.assessmentStatus !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not ready to bind an assertion Agent.",
          kind: "conflict",
          details: { caseId },
        })
      }
      const [activeRun] = await transaction
        .select({ id: skillTestRuns.id })
        .from(skillTestRuns)
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "RUNNING"),
          ),
        )
        .for("update")
      if (!activeRun) {
        throw new DomainError({
          code: "TEST_RUN_STATE_CONFLICT",
          message: "The test run is no longer accepting assessments.",
          kind: "conflict",
          details: { runId: runCase.runId },
        })
      }
      await transaction
        .update(skillTestRunCases)
        .set({ assertionAgentSessionId: sessionId, updatedAt: new Date() })
        .where(eq(skillTestRunCases.id, caseId))
    })
  }

  async completeAssertion(input: {
    readonly caseId: string
    readonly rawResponse: string
    readonly parsedJson: unknown | null
    readonly parseError: string | null
    readonly usage: StoredTestRunUsage | null
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, input.caseId)
      if (runCase.assessmentStatus !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case assertion is not running.",
          kind: "conflict",
          details: { caseId: input.caseId, assessmentStatus: runCase.assessmentStatus },
        })
      }
      await transaction
        .update(skillTestRunCases)
        .set({
          assessmentStatus: "COMPLETED",
          gradingUsage: input.usage,
          assertionAgentRawResponse: input.rawResponse,
          assertionAgentJson: input.parsedJson,
          assertionJsonParseError: input.parseError,
          assessmentErrorCode: null,
          assessmentErrorMessage: null,
          updatedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      await this.incrementCompletedCases(transaction, runCase.runId)
      const context = await this.getCaseEventContext(transaction, runCase)
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        "case.assertion.completed",
        caseEventPayload(context, "assertion", {
          usage: input.usage,
          jsonParsed: input.parsedJson !== null,
          ...(input.parseError ? { jsonParseError: input.parseError } : {}),
        }),
      )
    })
  }

  async failAssertion(input: {
    readonly caseId: string
    readonly code: string
    readonly message: string
    readonly usage?: StoredTestRunUsage | null
    readonly rawResponse?: string | null
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, input.caseId)
      const safeMessage = String(sanitizeTestRunPublicValue(input.message))
      if (runCase.assessmentStatus !== "RUNNING") {
        const existing = await this.latestEventForCase(
          transaction,
          runCase.runId,
          input.caseId,
        )
        if (existing) return existing
      }
      await transaction
        .update(skillTestRunCases)
        .set({
          assessmentStatus: "FAILED",
          ...(input.usage !== undefined ? { gradingUsage: input.usage } : {}),
          ...(input.rawResponse !== undefined
            ? { assertionAgentRawResponse: input.rawResponse }
            : {}),
          assertionAgentJson: null,
          assertionJsonParseError: null,
          assessmentErrorCode: input.code,
          assessmentErrorMessage: safeMessage,
          updatedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      await this.incrementCompletedCases(transaction, runCase.runId)
      const context = await this.getCaseEventContext(transaction, runCase)
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        "case.assertion.failed",
        caseEventPayload(context, "assertion", {
          ...(input.usage !== undefined ? { usage: input.usage } : {}),
          error: { code: input.code, message: safeMessage },
        }),
      )
    })
  }

  async beginSkillScoreReport(reportId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [report] = await transaction
        .select()
        .from(skillTestRunScoreReports)
        .where(eq(skillTestRunScoreReports.id, reportId))
        .for("update")
      if (!report) throw skillScoreReportNotFound(reportId)
      if (report.status !== "PENDING") {
        throw new DomainError({
          code: "TEST_RUN_SKILL_SCORE_STATE_CONFLICT",
          message: "The Skill score report is not pending.",
          kind: "conflict",
          details: { reportId, status: report.status },
        })
      }
      await transaction
        .update(skillTestRunScoreReports)
        .set({ status: "RUNNING", startedAt: new Date() })
        .where(eq(skillTestRunScoreReports.id, reportId))
      await this.appendScoreReportEvent(
        transaction,
        reportId,
        "skill-score-report.analysis.started",
        { runId: report.runId },
      )
    })
  }

  async bindSkillScoreReportSession(
    reportId: string,
    sessionId: string,
  ): Promise<void> {
    const [updated] = await this.database
      .update(skillTestRunScoreReports)
      .set({ agentSessionId: sessionId })
      .where(
        and(
          eq(skillTestRunScoreReports.id, reportId),
          eq(skillTestRunScoreReports.status, "RUNNING"),
        ),
      )
      .returning({ id: skillTestRunScoreReports.id })
    if (!updated) {
      throw new DomainError({
        code: "TEST_RUN_SKILL_SCORE_STATE_CONFLICT",
        message: "The Skill score report is not ready to bind its Agent Session.",
        kind: "conflict",
        details: { reportId },
      })
    }
  }

  async completeSkillScoreReport(
    reportId: string,
    html: string,
  ): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const [report] = await transaction
        .select()
        .from(skillTestRunScoreReports)
        .where(eq(skillTestRunScoreReports.id, reportId))
        .for("update")
      if (!report) throw skillScoreReportNotFound(reportId)
      if (report.status !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_SKILL_SCORE_STATE_CONFLICT",
          message: "The Skill score report is not running.",
          kind: "conflict",
          details: { reportId, status: report.status },
        })
      }
      await transaction
        .update(skillTestRunScoreReports)
        .set({
          status: "AVAILABLE",
          html,
          rawResponse: html,
          errorCode: null,
          errorMessage: null,
          completedAt: new Date(),
        })
        .where(eq(skillTestRunScoreReports.id, reportId))
      await this.appendScoreReportEvent(
        transaction,
        reportId,
        "skill-score-report.analysis.completed",
        { runId: report.runId },
      )
    })
  }

  async failSkillScoreReport(input: {
    readonly reportId: string
    readonly code: string
    readonly message: string
  }): Promise<void> {
    return this.database.transaction(async (transaction) => {
      const [report] = await transaction
        .select()
        .from(skillTestRunScoreReports)
        .where(eq(skillTestRunScoreReports.id, input.reportId))
        .for("update")
      if (!report) throw skillScoreReportNotFound(input.reportId)
      if (["AVAILABLE", "FAILED"].includes(report.status)) return
      const message = String(sanitizeTestRunPublicValue(input.message))
      await transaction
        .update(skillTestRunScoreReports)
        .set({
          status: "FAILED",
          errorCode: input.code,
          errorMessage: message,
          completedAt: new Date(),
        })
        .where(eq(skillTestRunScoreReports.id, input.reportId))
      await this.appendScoreReportEvent(
        transaction,
        input.reportId,
        "skill-score-report.analysis.failed",
        { runId: report.runId, error: { code: input.code, message } },
      )
    })
  }

  async getSkillScoreReportHtml(reportId: string): Promise<string> {
    const [report] = await this.database
      .select({ status: skillTestRunScoreReports.status, html: skillTestRunScoreReports.html })
      .from(skillTestRunScoreReports)
      .where(eq(skillTestRunScoreReports.id, reportId))
      .limit(1)
    if (!report) throw skillScoreReportNotFound(reportId)
    if (report.status !== "AVAILABLE" || report.html === null) {
      throw new DomainError({
        code: "TEST_RUN_SKILL_SCORE_UNAVAILABLE",
        message: "The Skill score report is not available.",
        kind: "conflict",
        details: { reportId, status: report.status },
      })
    }
    return report.html
  }

  async listSkillScoreReports(
    workspaceId: string,
    input: {
      readonly page: number
      readonly pageSize: number
      readonly status?: "PENDING" | "RUNNING" | "AVAILABLE" | "FAILED"
    },
  ): Promise<SkillScoreReportPage> {
    const where = input.status
      ? and(
          eq(skillTestRuns.workspaceId, workspaceId),
          eq(skillTestRunScoreReports.status, input.status),
        )
      : eq(skillTestRuns.workspaceId, workspaceId)
    const offset = (input.page - 1) * input.pageSize
    const [rows, totalRow] = await Promise.all([
      this.database
        .select({ report: skillTestRunScoreReports, workspaceId: skillTestRuns.workspaceId })
        .from(skillTestRunScoreReports)
        .innerJoin(skillTestRuns, eq(skillTestRunScoreReports.runId, skillTestRuns.id))
        .where(where)
        .orderBy(desc(skillTestRunScoreReports.createdAt), desc(skillTestRunScoreReports.id))
        .limit(input.pageSize)
        .offset(offset),
      this.database
        .select({ total: count() })
        .from(skillTestRunScoreReports)
        .innerJoin(skillTestRuns, eq(skillTestRunScoreReports.runId, skillTestRuns.id))
        .where(where),
    ])
    const total = Number(totalRow[0]?.total ?? 0)
    return {
      items: rows.map((row) => mapScoreReport(row.report, row.workspaceId)),
      pagination: {
        page: input.page,
        pageSize: input.pageSize,
        total,
        pageCount: Math.ceil(total / input.pageSize),
      },
    }
  }

  async getSkillScoreReport(
    reportId: string,
  ): Promise<SkillScoreReportDetailView> {
    const [row] = await this.database
      .select({ report: skillTestRunScoreReports, workspaceId: skillTestRuns.workspaceId })
      .from(skillTestRunScoreReports)
      .innerJoin(skillTestRuns, eq(skillTestRunScoreReports.runId, skillTestRuns.id))
      .where(eq(skillTestRunScoreReports.id, reportId))
      .limit(1)
    if (!row) throw skillScoreReportNotFound(reportId)
    return {
      ...mapScoreReport(row.report, row.workspaceId),
      metrics: await this.getSkillScoreMetrics(row.report.runId),
    }
  }

  async getSkillScoreMetrics(
    runId: string,
    existingCases?: readonly SkillTestRunCaseRow[],
  ): Promise<SkillScoreMetricsV1> {
    const [runRecord, cases] = await Promise.all([
      this.getRunRecord(runId),
      existingCases
        ? Promise.resolve(existingCases)
        : this.database
            .select({
              side: skillTestRunCases.side,
              usage: skillTestRunCases.usage,
              gradingUsage: skillTestRunCases.gradingUsage,
            })
            .from(skillTestRunCases)
            .where(eq(skillTestRunCases.runId, runId)),
    ])
    const run = mapRun(runRecord)
    return buildSkillScoreMetrics({
      mode: run.mode,
      target: run.target,
      baseline: run.baseline,
      cases,
    })
  }

  async listSkillScoreReportEvents(
    reportId: string,
    input: { readonly beforeSequence?: number; readonly limit: number },
  ): Promise<SkillScoreReportEventPage> {
    const [report] = await this.database
      .select({ id: skillTestRunScoreReports.id })
      .from(skillTestRunScoreReports)
      .where(eq(skillTestRunScoreReports.id, reportId))
      .limit(1)
    if (!report) throw skillScoreReportNotFound(reportId)
    const where = input.beforeSequence
      ? and(
          eq(skillTestRunScoreReportEvents.reportId, reportId),
          lt(skillTestRunScoreReportEvents.sequence, input.beforeSequence),
        )
      : eq(skillTestRunScoreReportEvents.reportId, reportId)
    const rows = await this.database
      .select()
      .from(skillTestRunScoreReportEvents)
      .where(where)
      .orderBy(desc(skillTestRunScoreReportEvents.sequence))
      .limit(input.limit + 1)
    const visible = rows.slice(0, input.limit)
    return {
      items: visible.reverse().map(mapScoreReportEvent),
      pagination: {
        limit: input.limit,
        hasMore: rows.length > input.limit,
        nextBeforeSequence:
          rows.length > input.limit ? visible.at(-1)?.sequence ?? null : null,
      },
    }
  }

  async completeRunAndCreateSkillScoreReport(input: {
    readonly runId: string
  }): Promise<{
    readonly runEvent: TestRunEvent
    readonly reportId: string
  }> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(skillTestRuns)
        .where(eq(skillTestRuns.id, input.runId))
        .for("update")
      if (!run) throw runNotFound(input.runId)
      if (run.status !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_STATE_CONFLICT",
          message: "The test run is no longer ready to complete.",
          kind: "conflict",
          details: { runId: input.runId, status: run.status },
        })
      }
      if (run.completedCaseCount !== run.totalCaseCount) {
        throw new DomainError({
          code: "TEST_RUN_CASES_INCOMPLETE",
          message: "The test run cannot complete before every Case ends.",
          kind: "conflict",
          details: {
            completed: run.completedCaseCount,
            total: run.totalCaseCount,
          },
        })
      }
      await transaction
        .update(skillTestRuns)
        .set({
          status: "COMPLETED",
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(skillTestRuns.id, input.runId))
      const [report] = await transaction
        .insert(skillTestRunScoreReports)
        .values({ runId: input.runId, status: "PENDING" })
        .returning({ id: skillTestRunScoreReports.id })
      if (!report) throw new Error("Skill score report insert returned no row.")
      await this.appendScoreReportEvent(
        transaction,
        report.id,
        "skill-score-report.created",
        { runId: input.runId },
      )
      const runEvent = await this.appendEvent(
        transaction,
        input.runId,
        null,
        "run.completed",
        { schemaVersion: 1 },
      )
      return { runEvent, reportId: report.id }
    })
  }

  async markCanceling(runId: string): Promise<TestRunEvent | null> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .update(skillTestRuns)
        .set({ status: "CANCELING", updatedAt: new Date() })
        .where(
          and(
            eq(skillTestRuns.id, runId),
            inArray(skillTestRuns.status, [
              "PREPARING",
              "RUNNING",
            ]),
          ),
        )
        .returning()
      if (!run) return null
      return this.appendEvent(
        transaction,
        runId,
        null,
        "run.canceling",
        { schemaVersion: 1 },
      )
    })
  }

  async finalizeCanceled(runId: string): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(skillTestRuns)
        .where(eq(skillTestRuns.id, runId))
        .for("update")
      if (!run) throw runNotFound(runId)
      if (run.status === "CANCELED") {
        const existing = await this.latestEventForRun(transaction, runId)
        if (existing) return existing
      }
      if (run.status !== "CANCELING") {
        throw new DomainError({
          code: "TEST_RUN_STATE_CONFLICT",
          message: "The test run is not waiting to be canceled.",
          kind: "conflict",
          details: { runId, status: run.status },
        })
      }
      return this.finalizeCanceledInTransaction(transaction, runId)
    })
  }

  async failRun(
    runId: string,
    code: string,
    message: string,
  ): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const safeMessage = String(sanitizeTestRunPublicValue(message))
      const [run] = await transaction
        .select()
        .from(skillTestRuns)
        .where(eq(skillTestRuns.id, runId))
        .for("update")
      if (!run) throw runNotFound(runId)
      if (
        ["COMPLETED", "CANCELED", "INTERRUPTED", "FAILED"].includes(
          run.status,
        )
      ) {
        const existing = await this.latestEventForRun(transaction, runId)
        if (existing) return existing
      }
      if (run.status === "CANCELING") {
        return this.finalizeCanceledInTransaction(transaction, runId)
      }

      const unfinished = await transaction
        .select()
        .from(skillTestRunCases)
        .where(
          and(
            eq(skillTestRunCases.runId, runId),
            inArray(skillTestRunCases.assessmentStatus, [
              "PENDING",
              "RUNNING",
            ]),
          ),
        )
      for (const runCase of unfinished) {
        const executionFinished = [
          "COMPLETED",
          "FAILED",
          "CANCELED",
          "INTERRUPTED",
        ].includes(runCase.executionStatus)
        await transaction
          .update(skillTestRunCases)
          .set({
            ...(executionFinished
              ? {}
              : {
                  executionStatus: "FAILED" as const,
                  executionErrorCode: code,
                  executionErrorMessage: safeMessage,
                  executionCompletedAt: new Date(),
                }),
            assessmentStatus: "NOT_EVALUATED",
            assessmentErrorCode: code,
            assessmentErrorMessage:
              "Assertions were not evaluated because the run failed.",
            updatedAt: new Date(),
            assessmentCompletedAt: new Date(),
          })
          .where(eq(skillTestRunCases.id, runCase.id))
        await this.insertNotEvaluatedAssertions(
          transaction,
          runCase,
          code,
          safeMessage,
        )
      }
      await transaction
        .update(skillTestRuns)
        .set({
          status: "FAILED",
          completedCaseCount: run.totalCaseCount,
          errorCode: code,
          errorMessage: safeMessage,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(skillTestRuns.id, runId))
      return this.appendEvent(transaction, runId, null, "run.failed", {
        schemaVersion: 1,
        error: { code, message: safeMessage },
      })
    })
  }

  async getArtifactRecord(runId: string, artifactId: string) {
    const [record] = await this.database
      .select({
        artifact: skillTestArtifacts,
        caseId: skillTestRunCases.id,
      })
      .from(skillTestArtifacts)
      .innerJoin(
        skillTestRunCases,
        eq(skillTestRunCases.id, skillTestArtifacts.caseId),
      )
      .where(
        and(
          eq(skillTestArtifacts.id, artifactId),
          eq(skillTestRunCases.runId, runId),
        ),
      )
      .limit(1)
    if (!record) {
      throw new DomainError({
        code: "TEST_RUN_ARTIFACT_NOT_FOUND",
        message: "The requested test run Artifact does not exist.",
        kind: "not_found",
        details: { runId, artifactId },
      })
    }
    return record
  }

  async reconcileInterruptedRuns(): Promise<readonly TestRunEvent[]> {
    return this.database.transaction(async (transaction) => {
      const active = await transaction
        .select({ id: skillTestRuns.id })
        .from(skillTestRuns)
        .where(inArray(skillTestRuns.status, [...activeStatuses]))
      const events: TestRunEvent[] = []
      for (const run of active) {
        const unfinished = await transaction
          .select()
          .from(skillTestRunCases)
          .where(
            and(
              eq(skillTestRunCases.runId, run.id),
              inArray(skillTestRunCases.assessmentStatus, [
                "PENDING",
                "RUNNING",
              ]),
            ),
          )
        for (const runCase of unfinished) {
          await this.insertNotEvaluatedAssertions(
            transaction,
            runCase,
            "TEST_RUN_SERVER_RESTARTED",
            "The Server restarted before this case completed.",
          )
        }
        await transaction
          .update(skillTestRuns)
          .set({
            status: "INTERRUPTED",
            completedCaseCount: sql`${skillTestRuns.totalCaseCount}`,
            errorCode: "TEST_RUN_SERVER_RESTARTED",
            errorMessage:
              "The Server restarted before the test run completed.",
            updatedAt: new Date(),
            completedAt: new Date(),
          })
          .where(eq(skillTestRuns.id, run.id))
        await transaction
          .update(skillTestRunCases)
          .set({
            executionStatus: "INTERRUPTED",
            assessmentStatus: "NOT_EVALUATED",
            executionErrorCode: "TEST_RUN_SERVER_RESTARTED",
            executionErrorMessage:
              "The Server restarted before this case completed.",
            updatedAt: new Date(),
            executionCompletedAt: new Date(),
            assessmentCompletedAt: new Date(),
          })
          .where(
            and(
              eq(skillTestRunCases.runId, run.id),
              inArray(skillTestRunCases.executionStatus, [
                "PENDING",
                "PREPARING",
                "RUNNING",
              ]),
            ),
          )
        await transaction
          .update(skillTestRunCases)
          .set({
            assessmentStatus: "NOT_EVALUATED",
            assessmentErrorCode: "TEST_RUN_SERVER_RESTARTED",
            assessmentErrorMessage:
              "The Server restarted before this case was assessed.",
            updatedAt: new Date(),
            assessmentCompletedAt: new Date(),
          })
          .where(
            and(
              eq(skillTestRunCases.runId, run.id),
              inArray(skillTestRunCases.assessmentStatus, [
                "PENDING",
                "RUNNING",
              ]),
            ),
          )
        events.push(
          await this.appendEvent(
            transaction,
            run.id,
            null,
            "run.interrupted",
            {
              schemaVersion: 1,
              code: "TEST_RUN_SERVER_RESTARTED",
            },
          ),
        )
      }
      return events
    })
  }

  private baseRunQuery() {
    return this.database
      .select({
        run: skillTestRuns,
        draftId: skillDrafts.id,
        draftContentRevision: skillDraftRevisions.sourceContentRevision,
        versionId: sql<string | null>`coalesce(
          ${skillVersions.id},
          (select origin_version.id
            from skill_versions origin_version
            inner join skill_snapshots origin_snapshot
              on origin_snapshot.id = origin_version.snapshot_id
            where origin_version.workspace_id = ${skillTestRuns.workspaceId}
              and origin_version.source_draft_id = ${skillDrafts.id}
              and origin_version.source_content_revision = ${skillDraftRevisions.sourceContentRevision}
              and origin_snapshot.manifest_hash = ${skillTestRuns.skillManifestHash}
            order by origin_version.published_at asc, origin_version.version_number asc
            limit 1)
        )`,
        versionName: sql<string | null>`coalesce(
          ${skillVersions.name},
          (select origin_version.name
            from skill_versions origin_version
            inner join skill_snapshots origin_snapshot
              on origin_snapshot.id = origin_version.snapshot_id
            where origin_version.workspace_id = ${skillTestRuns.workspaceId}
              and origin_version.source_draft_id = ${skillDrafts.id}
              and origin_version.source_content_revision = ${skillDraftRevisions.sourceContentRevision}
              and origin_snapshot.manifest_hash = ${skillTestRuns.skillManifestHash}
            order by origin_version.published_at asc, origin_version.version_number asc
            limit 1)
        )`,
        versionNumber: sql<number | null>`coalesce(
          ${skillVersions.sequenceNumber},
          (select origin_version.version_number
            from skill_versions origin_version
            inner join skill_snapshots origin_snapshot
              on origin_snapshot.id = origin_version.snapshot_id
            where origin_version.workspace_id = ${skillTestRuns.workspaceId}
              and origin_version.source_draft_id = ${skillDrafts.id}
              and origin_version.source_content_revision = ${skillDraftRevisions.sourceContentRevision}
              and origin_snapshot.manifest_hash = ${skillTestRuns.skillManifestHash}
            order by origin_version.published_at asc, origin_version.version_number asc
            limit 1)
        )`,
        baselineVersionName: sql<string | null>`(
          select baseline_version.name
          from skill_versions baseline_version
          where baseline_version.id = ${skillTestRuns.baselineSkillVersionId}
          limit 1
        )`,
        baselineVersionNumber: sql<number | null>`(
          select baseline_version.version_number
          from skill_versions baseline_version
          where baseline_version.id = ${skillTestRuns.baselineSkillVersionId}
          limit 1
        )`,
        revisionNumber: evalRevisions.sequenceNumber,
        evalCount: evalRevisions.evalCount,
        benchmarkTarget: runBenchmarks.target,
        benchmarkBaseline: runBenchmarks.baseline,
      })
      .from(skillTestRuns)
      .leftJoin(
        skillDraftRevisions,
        eq(skillDraftRevisions.id, skillTestRuns.skillDraftRevisionId),
      )
      .leftJoin(
        skillDrafts,
        eq(skillDrafts.id, skillDraftRevisions.draftId),
      )
      .leftJoin(
        skillVersions,
        eq(skillVersions.id, skillTestRuns.skillVersionId),
      )
      .innerJoin(
        evalRevisions,
        eq(evalRevisions.id, skillTestRuns.evalRevisionId),
      )
      .leftJoin(
        runBenchmarks,
        eq(runBenchmarks.runId, skillTestRuns.id),
      )
  }

  private async getRunRecord(runId: string): Promise<RunWithDisplay> {
    const [record] = await this.baseRunQuery()
      .where(eq(skillTestRuns.id, runId))
      .limit(1)
    if (!record) throw runNotFound(runId)
    return record
  }

  private async lockCase(
    transaction: Transaction,
    caseId: string,
  ): Promise<SkillTestRunCaseRow> {
    const [runCase] = await transaction
      .select()
      .from(skillTestRunCases)
      .where(eq(skillTestRunCases.id, caseId))
      .for("update")
    if (!runCase) {
      throw new DomainError({
        code: "TEST_RUN_CASE_NOT_FOUND",
        message: "The requested Skill test run Case does not exist.",
        kind: "not_found",
        details: { caseId },
      })
    }
    return runCase
  }

  private async latestEventForCase(
    transaction: Transaction,
    runId: string,
    caseId: string,
  ): Promise<TestRunEvent | null> {
    const [event] = await transaction
      .select()
      .from(skillTestRunEvents)
      .where(
        and(
          eq(skillTestRunEvents.runId, runId),
          eq(skillTestRunEvents.caseId, caseId),
        ),
      )
      .orderBy(desc(skillTestRunEvents.sequence))
      .limit(1)
    return event ? mapEvent(event) : null
  }

  private async latestEventForRun(
    transaction: Transaction,
    runId: string,
  ): Promise<TestRunEvent | null> {
    const [event] = await transaction
      .select()
      .from(skillTestRunEvents)
      .where(eq(skillTestRunEvents.runId, runId))
      .orderBy(desc(skillTestRunEvents.sequence))
      .limit(1)
    return event ? mapEvent(event) : null
  }

  private async finalizeCanceledInTransaction(
    transaction: Transaction,
    runId: string,
  ): Promise<TestRunEvent> {
    const unfinished = await transaction
      .select()
      .from(skillTestRunCases)
      .where(
        and(
          eq(skillTestRunCases.runId, runId),
          inArray(skillTestRunCases.assessmentStatus, [
            "PENDING",
            "RUNNING",
          ]),
        ),
      )
    for (const runCase of unfinished) {
      const executionFinished = [
        "COMPLETED",
        "FAILED",
        "CANCELED",
        "INTERRUPTED",
      ].includes(runCase.executionStatus)
      await transaction
        .update(skillTestRunCases)
        .set({
          ...(executionFinished
            ? {}
            : {
                executionStatus: "CANCELED" as const,
                executionErrorCode: "TEST_RUN_CANCELED",
                executionErrorMessage:
                  "The test run was canceled before this Case executed.",
                executionCompletedAt: new Date(),
              }),
          assessmentStatus: "NOT_EVALUATED",
          assessmentErrorCode: "TEST_RUN_CANCELED",
          assessmentErrorMessage:
            "Assertions were not evaluated because the run was canceled.",
          updatedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, runCase.id))
      await this.insertNotEvaluatedAssertions(
        transaction,
        runCase,
        "TEST_RUN_CANCELED",
        "The test run was canceled before this Case executed.",
      )
    }
    const completedCount = await transaction
      .select({ value: count() })
      .from(skillTestRunCases)
      .where(
        and(
          eq(skillTestRunCases.runId, runId),
          inArray(skillTestRunCases.assessmentStatus, [
            "COMPLETED",
            "NOT_EVALUATED",
            "FAILED",
          ]),
        ),
      )
    await transaction
      .update(skillTestRuns)
      .set({
        status: "CANCELED",
        completedCaseCount: completedCount[0]?.value ?? 0,
        errorCode: "TEST_RUN_CANCELED",
        errorMessage: "The Skill test run was canceled.",
        updatedAt: new Date(),
        completedAt: new Date(),
      })
      .where(eq(skillTestRuns.id, runId))
    return this.appendEvent(
      transaction,
      runId,
      null,
      "run.canceled",
      { schemaVersion: 1 },
    )
  }

  private async insertNotEvaluatedAssertions(
    transaction: Transaction,
    runCase: SkillTestRunCaseRow,
    code: string,
    message: string,
  ): Promise<void> {
    if (runCase.assertions.length === 0) return
    await transaction
      .insert(assertionResults)
      .values(
        runCase.assertions.map((assertion, assertionIndex) => ({
          id: randomUUID(),
          caseId: runCase.id,
          assertionIndex,
          assertion,
          status: "NOT_EVALUATED" as const,
          reason: message,
          evidence: [
            {
              source: "execution_error" as const,
              reference: code,
              excerpt: message.slice(0, 4_000),
            },
          ],
        })),
      )
      .onConflictDoNothing({
        target: [
          assertionResults.caseId,
          assertionResults.assertionIndex,
        ],
      })
  }

  private async incrementCompletedCases(
    transaction: Transaction,
    runId: string,
  ): Promise<void> {
    await transaction
      .update(skillTestRuns)
      .set({
        completedCaseCount: sql`${skillTestRuns.completedCaseCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(skillTestRuns.id, runId))
  }

  private async appendEvent(
    transaction: Transaction,
    runId: string,
    caseId: string | null,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<TestRunEvent> {
    const safePayload = sanitizeTestRunPublicValue(payload) as Readonly<
      Record<string, unknown>
    >
    const [lockedRun] = await transaction
      .select({ id: skillTestRuns.id })
      .from(skillTestRuns)
      .where(eq(skillTestRuns.id, runId))
      .for("update")
    if (!lockedRun) throw runNotFound(runId)
    const [sequenceRecord] = await transaction
      .select({
        next: sql<number>`coalesce(max(${skillTestRunEvents.sequence}), 0) + 1`,
      })
      .from(skillTestRunEvents)
      .where(eq(skillTestRunEvents.runId, runId))
    const [event] = await transaction
      .insert(skillTestRunEvents)
      .values({
        id: randomUUID(),
        runId,
        caseId,
        sequence: sequenceRecord?.next ?? 1,
        type,
        payload: safePayload,
      })
      .returning()
    if (!event) throw new Error("Test run event insert returned no row.")
    return mapEvent(event)
  }

  private async appendScoreReportEvent(
    transaction: Transaction,
    reportId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<SkillScoreReportEvent> {
    const safePayload = sanitizeTestRunPublicValue(payload) as Readonly<
      Record<string, unknown>
    >
    const [report] = await transaction
      .select({ id: skillTestRunScoreReports.id })
      .from(skillTestRunScoreReports)
      .where(eq(skillTestRunScoreReports.id, reportId))
      .for("update")
    if (!report) throw skillScoreReportNotFound(reportId)
    const [sequenceRecord] = await transaction
      .select({
        next: sql<number>`coalesce(max(${skillTestRunScoreReportEvents.sequence}), 0) + 1`,
      })
      .from(skillTestRunScoreReportEvents)
      .where(eq(skillTestRunScoreReportEvents.reportId, reportId))
    const [event] = await transaction
      .insert(skillTestRunScoreReportEvents)
      .values({
        id: randomUUID(),
        reportId,
        sequence: sequenceRecord?.next ?? 1,
        type,
        payload: safePayload,
      })
      .returning()
    if (!event) throw new Error("Skill score report event insert returned no row.")
    return mapScoreReportEvent(event)
  }

  private isUniqueViolation(error: unknown): boolean {
    return (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505"
    )
  }
}
