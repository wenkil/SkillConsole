import { randomUUID } from "node:crypto"

import {
  and,
  asc,
  count,
  desc,
  eq,
  gt,
  inArray,
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
  skillTestRunCases,
  skillTestRunEvents,
  skillTestRuns,
  skillVersions,
  type AssertionResultRow,
  type Database,
  type EvalRevisionCaseRow,
  type EvalRevisionFileRow,
  type SkillTestArtifactRow,
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
  TestRunPage,
  TestRunTraceability,
  TestRunView,
} from "./test-run.domain.js"

const activeStatuses: readonly TestRunStatus[] = [
  "PREPARING",
  "RUNNING",
  "SCORING",
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
    readonly skillCreatorCommit: string
    readonly skillCreatorTreeHash: string
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
}

interface CreateRunInput {
  readonly id: string
  readonly selection: FrozenTestRunSelection
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

export interface StoredAssertionResultInput {
  readonly id: string
  readonly assertionIndex: number
  readonly assertion: string
  readonly status:
    | "PASSED"
    | "FAILED"
    | "INSUFFICIENT_EVIDENCE"
    | "NOT_EVALUATED"
  readonly reason: string
  readonly evidence: readonly StoredAssertionEvidence[]
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
    payload: row.payload,
  }
}

function mapRun(record: RunWithDisplay): TestRunView {
  const { run } = record
  return {
    id: run.id,
    workspaceId: run.workspaceId,
    mode: run.mode,
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
    traceability: {
      protocolVersion: run.protocolVersion,
      sdkVersion: run.sdkVersion,
      skillCreatorCommit: run.skillCreatorCommit,
      skillCreatorTreeHash: run.skillCreatorTreeHash,
      configurationFingerprint: run.configurationFingerprint,
      environmentFingerprint: run.environmentFingerprint,
      skillManifestHash: run.skillManifestHash,
      evalManifestHash: run.evalManifestHash,
      comparabilityFingerprint: run.comparabilityFingerprint,
      runInputFingerprint: run.runInputFingerprint,
    },
    progress: {
      totalCases: run.totalCaseCount,
      completedCases: run.completedCaseCount,
    },
    benchmark:
      record.benchmarkTarget && record.benchmarkBaseline
        ? {
            target: record.benchmarkTarget,
            baseline: record.benchmarkBaseline,
          }
        : null,
    error:
      run.errorCode && run.errorMessage
        ? {
            code: run.errorCode,
            message: run.errorMessage,
            details: run.errorDetails ?? null,
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

function mapAssertion(
  row: AssertionResultRow,
): TestRunAssertionResultView {
  return {
    id: row.id,
    assertionIndex: row.assertionIndex,
    assertion: row.assertion,
    status: row.status,
    reason: row.reason,
    evidence: row.evidence,
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
    executionStatus: row.executionStatus,
    assessmentStatus: row.assessmentStatus,
    finalOutput: row.finalOutput,
    usage: row.usage,
    executionError:
      row.executionErrorCode && row.executionErrorMessage
        ? {
            code: row.executionErrorCode,
            message: row.executionErrorMessage,
          }
        : null,
    assessmentError:
      row.assessmentErrorCode && row.assessmentErrorMessage
        ? {
            code: row.assessmentErrorCode,
            message: row.assessmentErrorMessage,
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
        skillCreatorCommit: revision.skillCreatorCommit,
        skillCreatorTreeHash: revision.skillCreatorTreeHash,
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
        skillCreatorCommit: evalRevisions.skillCreatorCommit,
        skillCreatorTreeHash: evalRevisions.skillCreatorTreeHash,
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
        await transaction.insert(skillTestRuns).values({
          id: input.id,
          workspaceId: input.selection.workspaceId,
          skillVersionId: input.selection.skill.version?.id ?? null,
          skillDraftRevisionId: input.selection.skill.draftRevisionId,
          skillSnapshotId: input.selection.skill.snapshotId,
          evalRevisionId: input.selection.revision.id,
          mode: "target_vs_no_skill",
          status: "PREPARING",
          protocolVersion: input.traceability.protocolVersion,
          sdkVersion: input.traceability.sdkVersion,
          skillCreatorCommit: input.traceability.skillCreatorCommit,
          skillCreatorTreeHash:
            input.traceability.skillCreatorTreeHash,
          configurationFingerprint:
            input.traceability.configurationFingerprint,
          environmentFingerprint:
            input.traceability.environmentFingerprint,
          skillManifestHash: input.traceability.skillManifestHash,
          evalManifestHash: input.traceability.evalManifestHash,
          comparabilityFingerprint:
            input.traceability.comparabilityFingerprint,
          runInputFingerprint:
            input.traceability.runInputFingerprint,
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
            executionStatus: "PENDING" as const,
            assessmentStatus: "PENDING" as const,
          })),
        )
        await this.appendEvent(transaction, input.id, null, "run.created", {
          schemaVersion: 1,
          mode: "target_vs_no_skill",
          draftRevisionId: input.selection.skill.draftRevisionId,
          draftContentRevision: input.selection.skill.contentRevision,
          skillVersionId: input.selection.skill.version?.id ?? null,
          evalRevisionId: input.selection.revision.id,
          totalCases: input.cases.length,
          comparabilityFingerprint:
            input.traceability.comparabilityFingerprint,
        })
      })
      return this.getDetail(input.id)
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(
          input.selection.workspaceId,
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
    const [runRecord, cases] = await Promise.all([
      this.getRunRecord(runId),
      this.database
        .select()
        .from(skillTestRunCases)
        .where(eq(skillTestRunCases.runId, runId))
        .orderBy(asc(skillTestRunCases.executionOrder)),
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
            this.database
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
          active: sql<number>`count(*) filter (where ${skillTestRuns.status} in ('PREPARING', 'RUNNING', 'SCORING', 'CANCELING'))::int`,
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
      return this.appendEvent(
        transaction,
        updatedCase.runId,
        caseId,
        "case.preparing",
        {
          schemaVersion: 1,
          side: updatedCase.side,
          externalId: updatedCase.externalId,
        },
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
      return this.appendEvent(
        transaction,
        updatedCase.runId,
        caseId,
        "case.execution.started",
        {
          schemaVersion: 1,
          side: updatedCase.side,
        },
      )
    })
  }

  async recordAgentEvent(input: {
    readonly runId: string
    readonly caseId: string
    readonly sessionId: string
    readonly sourceSequence: number
    readonly phase: "execution" | "grading"
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
            ...input.payload,
            schemaVersion: 1,
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
          updatedAt: new Date(),
          executionCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        "case.execution.completed",
        {
          schemaVersion: 1,
          side: runCase.side,
          artifactCount: input.artifacts.length,
          usage: input.usage,
        },
      )
    })
  }

  async failExecution(input: {
    readonly caseId: string
    readonly status: "FAILED" | "CANCELED" | "INTERRUPTED"
    readonly code: string
    readonly message: string
    readonly usage?: StoredTestRunUsage | null
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, input.caseId)
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
          executionErrorCode: input.code,
          executionErrorMessage: input.message,
          assessmentErrorCode: input.code,
          assessmentErrorMessage:
            "Assertions were not evaluated because execution did not complete.",
          updatedAt: new Date(),
          executionCompletedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      await this.insertNotEvaluatedAssertions(
        transaction,
        runCase,
        input.code,
        input.message,
      )
      await this.incrementCompletedCases(transaction, runCase.runId)
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        `case.execution.${input.status.toLowerCase()}`,
        {
          schemaVersion: 1,
          side: runCase.side,
          error: { code: input.code, message: input.message },
          ...(input.usage !== undefined ? { usage: input.usage } : {}),
        },
      )
    })
  }

  async beginAssessment(caseId: string): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (
        runCase.executionStatus !== "COMPLETED" ||
        runCase.assessmentStatus !== "PENDING"
      ) {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not ready for assessment.",
          kind: "conflict",
          details: {
            caseId,
            executionStatus: runCase.executionStatus,
            assessmentStatus: runCase.assessmentStatus,
          },
        })
      }
      const [activeRun] = await transaction
        .update(skillTestRuns)
        .set({ status: "SCORING", updatedAt: new Date() })
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "RUNNING"),
          ),
        )
        .returning({ id: skillTestRuns.id })
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
      return this.appendEvent(
        transaction,
        runCase.runId,
        caseId,
        "case.assessment.started",
        { schemaVersion: 1, side: runCase.side },
      )
    })
  }

  async bindGraderSession(
    caseId: string,
    sessionId: string,
  ): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (runCase.assessmentStatus !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case is not ready to bind a grader.",
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
            eq(skillTestRuns.status, "SCORING"),
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
        .set({ graderAgentSessionId: sessionId, updatedAt: new Date() })
        .where(eq(skillTestRunCases.id, caseId))
    })
  }

  async completeAssessment(
    caseId: string,
    results: readonly StoredAssertionResultInput[],
  ): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, caseId)
      if (runCase.assessmentStatus !== "RUNNING") {
        throw new DomainError({
          code: "TEST_RUN_CASE_STATE_CONFLICT",
          message: "The test Case assessment is not running.",
          kind: "conflict",
          details: { caseId, assessmentStatus: runCase.assessmentStatus },
        })
      }
      await transaction.insert(assertionResults).values(
        results.map((result) => ({ ...result, caseId })),
      )
      await transaction
        .update(skillTestRunCases)
        .set({
          assessmentStatus: "COMPLETED",
          updatedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, caseId))
      await this.incrementCompletedCases(transaction, runCase.runId)
      await transaction
        .update(skillTestRuns)
        .set({ status: "RUNNING", updatedAt: new Date() })
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "SCORING"),
          ),
        )
      return this.appendEvent(
        transaction,
        runCase.runId,
        caseId,
        "case.assessment.completed",
        {
          schemaVersion: 1,
          side: runCase.side,
          results: results.map((result) => ({
            assertionIndex: result.assertionIndex,
            status: result.status,
          })),
        },
      )
    })
  }

  async failAssessment(input: {
    readonly caseId: string
    readonly code: string
    readonly message: string
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const runCase = await this.lockCase(transaction, input.caseId)
      if (runCase.assessmentStatus !== "RUNNING") {
        const existing = await this.latestEventForCase(
          transaction,
          runCase.runId,
          input.caseId,
        )
        if (existing) return existing
      }
      await this.insertNotEvaluatedAssertions(
        transaction,
        runCase,
        input.code,
        input.message,
      )
      await transaction
        .update(skillTestRunCases)
        .set({
          assessmentStatus: "FAILED",
          assessmentErrorCode: input.code,
          assessmentErrorMessage: input.message,
          updatedAt: new Date(),
          assessmentCompletedAt: new Date(),
        })
        .where(eq(skillTestRunCases.id, input.caseId))
      await this.incrementCompletedCases(transaction, runCase.runId)
      await transaction
        .update(skillTestRuns)
        .set({ status: "RUNNING", updatedAt: new Date() })
        .where(
          and(
            eq(skillTestRuns.id, runCase.runId),
            eq(skillTestRuns.status, "SCORING"),
          ),
        )
      return this.appendEvent(
        transaction,
        runCase.runId,
        input.caseId,
        "case.assessment.failed",
        {
          schemaVersion: 1,
          side: runCase.side,
          error: { code: input.code, message: input.message },
        },
      )
    })
  }

  async completeRun(input: {
    readonly runId: string
    readonly target: StoredBenchmarkSide
    readonly baseline: StoredBenchmarkSide
  }): Promise<TestRunEvent> {
    return this.database.transaction(async (transaction) => {
      const [run] = await transaction
        .select()
        .from(skillTestRuns)
        .where(eq(skillTestRuns.id, input.runId))
        .for("update")
      if (!run) throw runNotFound(input.runId)
      if (!["RUNNING", "SCORING"].includes(run.status)) {
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
      await transaction.insert(runBenchmarks).values({
        id: randomUUID(),
        runId: input.runId,
        target: input.target,
        baseline: input.baseline,
      })
      await transaction
        .update(skillTestRuns)
        .set({
          status: "COMPLETED",
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(skillTestRuns.id, input.runId))
      return this.appendEvent(
        transaction,
        input.runId,
        null,
        "run.completed",
        {
          schemaVersion: 1,
          benchmark: {
            target: input.target,
            baseline: input.baseline,
          },
        },
      )
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
              "SCORING",
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
                  executionErrorMessage: message,
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
          message,
        )
      }
      await transaction
        .update(skillTestRuns)
        .set({
          status: "FAILED",
          completedCaseCount: run.totalCaseCount,
          errorCode: code,
          errorMessage: message,
          updatedAt: new Date(),
          completedAt: new Date(),
        })
        .where(eq(skillTestRuns.id, runId))
      return this.appendEvent(transaction, runId, null, "run.failed", {
        schemaVersion: 1,
        error: { code, message },
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
        payload,
      })
      .returning()
    if (!event) throw new Error("Test run event insert returned no row.")
    return mapEvent(event)
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
