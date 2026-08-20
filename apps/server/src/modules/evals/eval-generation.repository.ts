import { randomUUID } from "node:crypto"

import {
  and,
  count,
  desc,
  eq,
  gt,
  inArray,
  max,
  sql,
} from "drizzle-orm"

import { DomainError } from "../../core/errors/domain-error.js"
import {
  evalGenerationDrafts,
  evalGenerationEvents,
  evalGenerationTasks,
  evalRevisions,
  evalSuites,
  skillDraftRevisions,
  skillSnapshots,
  skillVersions,
  type Database,
  type EvalGenerationDraftRow,
  type EvalGenerationStatus,
  type EvalGenerationTaskRow,
  type StoredEvalCase,
  type StoredEvalFile,
} from "../../infrastructure/database/index.js"
import type { FrozenEvalTarget } from "../skill-workspaces/eval-target.domain.js"
import type {
  EvalGenerationDraftView,
  EvalGenerationEvent,
  EvalGenerationTaskPage,
  EvalGenerationTaskView,
} from "./eval-generation.domain.js"

const activeStatuses: readonly EvalGenerationStatus[] = [
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "CANCELING",
]

interface CreateTaskInput {
  readonly id: string
  readonly workspaceId: string
  readonly target: FrozenEvalTarget
  readonly maxEvalCount: number
  readonly generationBrief: string | null
  readonly promptContractVersion: string
  readonly configurationFingerprint: string
  readonly idempotencyKey: string
  readonly requestHash: string
}

export interface RetryableEvalGeneration {
  readonly workspaceId: string
  readonly maxEvalCount: number
  readonly generationBrief: string | null
  readonly target: FrozenEvalTarget
}

type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0]

function notFound(taskId: string): DomainError {
  return new DomainError({
    code: "EVAL_GENERATION_NOT_FOUND",
    message: "The requested Evals generation task does not exist.",
    kind: "not_found",
    details: { taskId },
  })
}

function mapDraft(row: EvalGenerationDraftRow): EvalGenerationDraftView {
  return {
    id: row.id,
    taskId: row.taskId,
    status: row.status,
    sourceSchemaVariant: row.sourceSchemaVariant as
      | "assertions"
      | "expectations"
      | "mixed",
    rawEvalsSha256: row.rawEvalsSha256,
    manifestHash: row.manifestHash,
    evalCount: row.evalCount,
    fileCount: row.fileCount,
    totalBytes: row.totalBytes,
    cases: row.cases,
    files: row.files,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  }
}

function mapEvent(
  row: typeof evalGenerationEvents.$inferSelect,
): EvalGenerationEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    taskId: row.taskId,
    occurredAt: row.occurredAt.toISOString(),
    payload: row.payload,
  }
}

export class EvalGenerationRepository {
  constructor(private readonly database: Database) {}

  async ensureSuite(workspaceId: string): Promise<string> {
    return this.database.transaction(async (transaction) => {
      await transaction
        .insert(evalSuites)
        .values({ id: randomUUID(), workspaceId })
        .onConflictDoNothing({ target: evalSuites.workspaceId })
      const [suite] = await transaction
        .select({ id: evalSuites.id })
        .from(evalSuites)
        .where(eq(evalSuites.workspaceId, workspaceId))
        .limit(1)
      if (!suite) {
        throw new Error("Evals suite creation returned no database row.")
      }
      return suite.id
    })
  }

  async findByIdempotencyKey(
    suiteId: string,
    idempotencyKey: string,
  ): Promise<EvalGenerationTaskRow | null> {
    const [task] = await this.database
      .select()
      .from(evalGenerationTasks)
      .where(
        and(
          eq(evalGenerationTasks.suiteId, suiteId),
          eq(evalGenerationTasks.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1)
    return task ?? null
  }

  async createTask(
    suiteId: string,
    input: CreateTaskInput,
  ): Promise<EvalGenerationTaskView> {
    try {
      const taskId = await this.database.transaction(async (transaction) => {
        const [task] = await transaction
          .insert(evalGenerationTasks)
          .values({
            id: input.id,
            suiteId,
            targetSnapshotId: input.target.snapshotId,
            targetSourceKind: input.target.sourceKind,
            targetVersionId: input.target.versionId,
            targetDraftRevisionId: input.target.draftRevisionId,
            skillName: input.target.skillName,
            status: "PREPARING",
            maxEvalCount: input.maxEvalCount,
            generationBrief: input.generationBrief,
            promptContractVersion: input.promptContractVersion,
            configurationFingerprint: input.configurationFingerprint,
            idempotencyKey: input.idempotencyKey,
            requestHash: input.requestHash,
          })
          .returning()
        if (!task) {
          throw new Error("Evals task creation returned no database row.")
        }
        await this.appendEvent(transaction, task.id, "task.created", {
          schemaVersion: 1,
          status: task.status,
        })
        return task.id
      })
      return this.get(taskId)
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const existing = await this.findByIdempotencyKey(
          suiteId,
          input.idempotencyKey,
        )
        if (existing) {
          if (existing.requestHash !== input.requestHash) {
            throw new DomainError({
              code: "EVAL_IDEMPOTENCY_CONFLICT",
              message:
                "The idempotency key was already used with a different request.",
              kind: "conflict",
            })
          }
          return this.get(existing.id)
        }
        throw new DomainError({
          code: "EVAL_GENERATION_ALREADY_ACTIVE",
          message:
            "This Skill workbench already has an active Evals generation task.",
          kind: "conflict",
        })
      }
      throw error
    }
  }

  async get(taskId: string): Promise<EvalGenerationTaskView> {
    const [record] = await this.database
      .select({
        task: evalGenerationTasks,
        workspaceId: evalSuites.workspaceId,
        draftId: evalGenerationDrafts.id,
        draftStatus: evalGenerationDrafts.status,
        evalCount: evalGenerationDrafts.evalCount,
        fileCount: evalGenerationDrafts.fileCount,
        revisionNumber: evalRevisions.sequenceNumber,
        versionName: skillVersions.name,
        draftSourceRevision: skillDraftRevisions.sourceContentRevision,
      })
      .from(evalGenerationTasks)
      .innerJoin(evalSuites, eq(evalSuites.id, evalGenerationTasks.suiteId))
      .leftJoin(
        evalGenerationDrafts,
        eq(evalGenerationDrafts.taskId, evalGenerationTasks.id),
      )
      .leftJoin(
        skillVersions,
        eq(skillVersions.id, evalGenerationTasks.targetVersionId),
      )
      .leftJoin(
        skillDraftRevisions,
        eq(
          skillDraftRevisions.id,
          evalGenerationTasks.targetDraftRevisionId,
        ),
      )
      .leftJoin(
        evalRevisions,
        eq(evalRevisions.sourceGenerationTaskId, evalGenerationTasks.id),
      )
      .where(eq(evalGenerationTasks.id, taskId))
      .limit(1)
    if (!record) throw notFound(taskId)
    return this.mapTask(record.task, record.workspaceId, record)
  }

  async list(
    workspaceId: string,
    page: number,
    pageSize: number,
  ): Promise<EvalGenerationTaskPage> {
    const records = await this.database
      .select({
        task: evalGenerationTasks,
        workspaceId: evalSuites.workspaceId,
        draftId: evalGenerationDrafts.id,
        draftStatus: evalGenerationDrafts.status,
        evalCount: evalGenerationDrafts.evalCount,
        fileCount: evalGenerationDrafts.fileCount,
        revisionNumber: evalRevisions.sequenceNumber,
        versionName: skillVersions.name,
        draftSourceRevision: skillDraftRevisions.sourceContentRevision,
      })
      .from(evalGenerationTasks)
      .innerJoin(evalSuites, eq(evalSuites.id, evalGenerationTasks.suiteId))
      .leftJoin(
        evalGenerationDrafts,
        eq(evalGenerationDrafts.taskId, evalGenerationTasks.id),
      )
      .leftJoin(
        skillVersions,
        eq(skillVersions.id, evalGenerationTasks.targetVersionId),
      )
      .leftJoin(
        skillDraftRevisions,
        eq(
          skillDraftRevisions.id,
          evalGenerationTasks.targetDraftRevisionId,
        ),
      )
      .leftJoin(
        evalRevisions,
        eq(evalRevisions.sourceGenerationTaskId, evalGenerationTasks.id),
      )
      .where(eq(evalSuites.workspaceId, workspaceId))
      .orderBy(
        desc(evalGenerationTasks.createdAt),
        desc(evalGenerationTasks.id),
      )
      .limit(pageSize)
      .offset((page - 1) * pageSize)

    const [summary] = await this.database
      .select({
        total: count(),
        running: count(
          sql`case when ${evalGenerationTasks.status} in ('PREPARING', 'RUNNING', 'VALIDATING', 'CANCELING') then 1 end`,
        ),
        awaitingReview: count(
          sql`case when ${evalGenerationDrafts.status} = 'READY' then 1 end`,
        ),
        published: count(
          sql`case when ${evalGenerationDrafts.status} = 'PUBLISHED' then 1 end`,
        ),
        failed: count(
          sql`case when ${evalGenerationTasks.status} = 'FAILED' then 1 end`,
        ),
      })
      .from(evalGenerationTasks)
      .innerJoin(evalSuites, eq(evalSuites.id, evalGenerationTasks.suiteId))
      .leftJoin(
        evalGenerationDrafts,
        eq(evalGenerationDrafts.taskId, evalGenerationTasks.id),
      )
      .where(eq(evalSuites.workspaceId, workspaceId))

    const total = summary?.total ?? 0
    return {
      items: records.map((record) =>
        this.mapTask(record.task, record.workspaceId, record),
      ),
      pagination: {
        page,
        pageSize,
        total,
        pageCount: Math.ceil(total / pageSize),
      },
      summary: {
        total,
        running: summary?.running ?? 0,
        awaitingReview: summary?.awaitingReview ?? 0,
        published: summary?.published ?? 0,
        failed: summary?.failed ?? 0,
      },
    }
  }

  async getRow(taskId: string): Promise<EvalGenerationTaskRow> {
    const [task] = await this.database
      .select()
      .from(evalGenerationTasks)
      .where(eq(evalGenerationTasks.id, taskId))
      .limit(1)
    if (!task) throw notFound(taskId)
    return task
  }

  async getRetryableGeneration(
    taskId: string,
  ): Promise<RetryableEvalGeneration> {
    const [record] = await this.database
      .select({
        task: evalGenerationTasks,
        workspaceId: evalSuites.workspaceId,
        snapshot: skillSnapshots,
      })
      .from(evalGenerationTasks)
      .innerJoin(evalSuites, eq(evalSuites.id, evalGenerationTasks.suiteId))
      .innerJoin(
        skillSnapshots,
        eq(skillSnapshots.id, evalGenerationTasks.targetSnapshotId),
      )
      .where(eq(evalGenerationTasks.id, taskId))
      .limit(1)
    if (!record) throw notFound(taskId)
    if (record.task.status !== "FAILED") {
      throw new DomainError({
        code: "EVAL_GENERATION_RETRY_UNAVAILABLE",
        message: "Only failed Evals generation tasks can be retried.",
        kind: "conflict",
        details: { taskId, status: record.task.status },
      })
    }
    if (record.snapshot.state !== "READY") {
      throw new DomainError({
        code: "EVAL_TARGET_SNAPSHOT_UNAVAILABLE",
        message: "The failed task's frozen Skill Snapshot is unavailable.",
        kind: "conflict",
        details: { taskId, snapshotId: record.snapshot.id },
      })
    }
    const target =
      record.task.targetSourceKind === "SKILL_VERSION" &&
      record.task.targetVersionId
        ? {
            sourceKind: "SKILL_VERSION" as const,
            versionId: record.task.targetVersionId,
            draftRevisionId: null,
            snapshotId: record.snapshot.id,
            skillName: record.task.skillName,
            manifestHash: record.snapshot.manifestHash,
            fileCount: record.snapshot.fileCount,
            totalBytes: record.snapshot.totalBytes,
          }
        : record.task.targetSourceKind === "DRAFT_REVISION" &&
            record.task.targetDraftRevisionId
          ? {
              sourceKind: "DRAFT_REVISION" as const,
              versionId: null,
              draftRevisionId: record.task.targetDraftRevisionId,
              snapshotId: record.snapshot.id,
              skillName: record.task.skillName,
              manifestHash: record.snapshot.manifestHash,
              fileCount: record.snapshot.fileCount,
              totalBytes: record.snapshot.totalBytes,
            }
          : null
    if (!target) {
      throw new Error("The failed Evals task has an invalid frozen target.")
    }
    return {
      workspaceId: record.workspaceId,
      maxEvalCount: record.task.maxEvalCount,
      generationBrief: record.task.generationBrief,
      target,
    }
  }

  async findByAgentSession(
    agentSessionId: string,
  ): Promise<EvalGenerationTaskRow | null> {
    const [task] = await this.database
      .select()
      .from(evalGenerationTasks)
      .where(eq(evalGenerationTasks.agentSessionId, agentSessionId))
      .limit(1)
    return task ?? null
  }

  async markRunning(
    taskId: string,
    agentSessionId: string,
  ): Promise<boolean> {
    return this.transition(taskId, ["PREPARING"], "RUNNING", {
      agentSessionId,
      startedAt: new Date(),
    })
  }

  async markValidating(taskId: string): Promise<boolean> {
    return this.transition(taskId, ["RUNNING"], "VALIDATING")
  }

  async markCanceling(taskId: string): Promise<boolean> {
    return this.transition(
      taskId,
      ["PREPARING", "RUNNING", "VALIDATING"],
      "CANCELING",
    )
  }

  async completeWithDraft(
    taskId: string,
    input: {
      readonly storageLocator: string
      readonly sourceSchemaVariant: "assertions" | "expectations" | "mixed"
      readonly rawEvalsSha256: string
      readonly manifestHash: string
      readonly cases: readonly StoredEvalCase[]
      readonly files: readonly StoredEvalFile[]
      readonly totalBytes: number
    },
  ): Promise<EvalGenerationDraftView> {
    return this.database.transaction(async (transaction) => {
      const [task] = await transaction
        .select()
        .from(evalGenerationTasks)
        .where(eq(evalGenerationTasks.id, taskId))
        .for("update")
      if (!task) throw notFound(taskId)
      if (task.status !== "VALIDATING") {
        throw new DomainError({
          code: "EVAL_GENERATION_STATE_CONFLICT",
          message:
            "The Evals generation task is no longer awaiting validation.",
          kind: "conflict",
          details: { taskId, status: task.status },
        })
      }
      const now = new Date()
      const [draft] = await transaction
        .insert(evalGenerationDrafts)
        .values({
          id: randomUUID(),
          taskId,
          status: "READY",
          storageLocator: input.storageLocator,
          sourceSchemaVariant: input.sourceSchemaVariant,
          rawEvalsSha256: input.rawEvalsSha256,
          manifestHash: input.manifestHash,
          evalCount: input.cases.length,
          fileCount: input.files.length,
          totalBytes: input.totalBytes,
          cases: input.cases,
          files: input.files,
          createdAt: now,
          updatedAt: now,
        })
        .returning()
      if (!draft) {
        throw new Error("Evals draft creation returned no database row.")
      }
      await transaction
        .update(evalGenerationTasks)
        .set({
          status: "SUCCEEDED",
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(evalGenerationTasks.id, taskId))
      await this.appendEvent(transaction, taskId, "task.succeeded", {
        schemaVersion: 1,
        draftId: draft.id,
      })
      return mapDraft(draft)
    })
  }

  async completeWithoutDraft(taskId: string): Promise<void> {
    await this.database.transaction(async (transaction) => {
      const [task] = await transaction
        .select()
        .from(evalGenerationTasks)
        .where(eq(evalGenerationTasks.id, taskId))
        .for("update")
      if (!task) throw notFound(taskId)
      if (task.status !== "VALIDATING") {
        throw new DomainError({
          code: "EVAL_GENERATION_STATE_CONFLICT",
          message: "The Evals generation task is no longer being finalized.",
          kind: "conflict",
          details: { taskId, status: task.status },
        })
      }
      const now = new Date()
      await transaction
        .update(evalGenerationTasks)
        .set({
          status: "SUCCEEDED",
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(evalGenerationTasks.id, taskId))
      await this.appendEvent(transaction, taskId, "task.succeeded", {
        schemaVersion: 1,
        draftId: null,
      })
    })
  }

  async fail(
    taskId: string,
    status: "FAILED" | "INTERRUPTED" | "CANCELED",
    error: {
      readonly code: string
      readonly message: string
      readonly details?: Readonly<Record<string, unknown>>
    },
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [task] = await transaction
        .select()
        .from(evalGenerationTasks)
        .where(eq(evalGenerationTasks.id, taskId))
        .for("update")
      if (!task) throw notFound(taskId)
      if (!activeStatuses.includes(task.status)) return false
      const now = new Date()
      await transaction
        .update(evalGenerationTasks)
        .set({
          status,
          errorCode: error.code,
          errorMessage: error.message,
          errorDetails: error.details ?? null,
          completedAt: now,
          updatedAt: now,
        })
        .where(eq(evalGenerationTasks.id, taskId))
      await this.appendEvent(
        transaction,
        taskId,
        `task.${status.toLowerCase()}`,
        {
          schemaVersion: 1,
          error,
        },
      )
      return true
    })
  }

  async recordAgentEvent(
    taskId: string,
    sourceSequence: number,
    type: string,
    payload: Readonly<Record<string, unknown>>,
  ): Promise<EvalGenerationEvent | null> {
    return this.database.transaction(async (transaction) => {
      const [duplicate] = await transaction
        .select({ id: evalGenerationEvents.id })
        .from(evalGenerationEvents)
        .where(
          and(
            eq(evalGenerationEvents.taskId, taskId),
            eq(
              evalGenerationEvents.sourceAgentSequence,
              sourceSequence,
            ),
          ),
        )
        .limit(1)
      if (duplicate) return null
      if (type === "agent.usage") {
        const usage =
          payload.usage &&
          typeof payload.usage === "object" &&
          !Array.isArray(payload.usage)
            ? (payload.usage as Readonly<Record<string, number>>)
            : null
        await transaction
          .update(evalGenerationTasks)
          .set({ usage, updatedAt: new Date() })
          .where(eq(evalGenerationTasks.id, taskId))
      }
      return this.appendEvent(
        transaction,
        taskId,
        type,
        payload,
        sourceSequence,
      )
    })
  }

  async listEvents(
    taskId: string,
    afterSequence: number,
  ): Promise<readonly EvalGenerationEvent[]> {
    await this.getRow(taskId)
    return (
      await this.database
        .select()
        .from(evalGenerationEvents)
        .where(
          and(
            eq(evalGenerationEvents.taskId, taskId),
            gt(evalGenerationEvents.sequence, afterSequence),
          ),
        )
        .orderBy(evalGenerationEvents.sequence)
    ).map(mapEvent)
  }

  async getDraft(taskId: string): Promise<EvalGenerationDraftView> {
    const [draft] = await this.database
      .select()
      .from(evalGenerationDrafts)
      .where(eq(evalGenerationDrafts.taskId, taskId))
      .limit(1)
    if (!draft) {
      throw new DomainError({
        code: "EVAL_GENERATION_DRAFT_NOT_FOUND",
        message: "The Evals generation task has no reviewable draft.",
        kind: "not_found",
      })
    }
    return mapDraft(draft)
  }

  async discardDraft(taskId: string): Promise<EvalGenerationDraftView> {
    return this.database.transaction(async (transaction) => {
      const [draft] = await transaction
        .select()
        .from(evalGenerationDrafts)
        .where(eq(evalGenerationDrafts.taskId, taskId))
        .for("update")
        .limit(1)
      if (!draft) {
        throw new DomainError({
          code: "EVAL_GENERATION_DRAFT_NOT_FOUND",
          message: "The Evals generation task has no reviewable draft.",
          kind: "not_found",
        })
      }
      if (draft.status === "PUBLISHED") {
        throw new DomainError({
          code: "EVAL_DRAFT_ALREADY_PUBLISHED",
          message: "A published Evals draft cannot be discarded.",
          kind: "conflict",
        })
      }
      if (draft.status === "DISCARDED") return mapDraft(draft)
      const [updated] = await transaction
        .update(evalGenerationDrafts)
        .set({ status: "DISCARDED", updatedAt: new Date() })
        .where(
          and(
            eq(evalGenerationDrafts.id, draft.id),
            eq(evalGenerationDrafts.status, "READY"),
          ),
        )
        .returning()
      if (!updated) {
        throw new DomainError({
          code: "EVAL_DRAFT_STATE_CONFLICT",
          message: "The Evals draft changed state before it was discarded.",
          kind: "conflict",
        })
      }
      await this.appendEvent(
        transaction,
        taskId,
        "draft.discarded",
        { schemaVersion: 1, draftId: updated.id },
      )
      return mapDraft(updated)
    })
  }

  async reconcileInterruptedTasks(): Promise<number> {
    const tasks = await this.database
      .select({ id: evalGenerationTasks.id })
      .from(evalGenerationTasks)
      .where(inArray(evalGenerationTasks.status, activeStatuses))
    let reconciled = 0
    for (const task of tasks) {
      if (
        await this.fail(task.id, "INTERRUPTED", {
          code: "EVAL_SERVER_RESTARTED",
          message:
            "The Evals generation task was interrupted by a server restart.",
        })
      ) {
        reconciled += 1
      }
    }
    return reconciled
  }

  async listAllTaskIds(): Promise<readonly string[]> {
    return (
      await this.database
        .select({ id: evalGenerationTasks.id })
        .from(evalGenerationTasks)
    ).map((task) => task.id)
  }

  private async transition(
    taskId: string,
    expected: readonly EvalGenerationStatus[],
    status: EvalGenerationStatus,
    values: Partial<{
      readonly agentSessionId: string
      readonly startedAt: Date
    }> = {},
  ): Promise<boolean> {
    return this.database.transaction(async (transaction) => {
      const [updated] = await transaction
        .update(evalGenerationTasks)
        .set({ status, ...values, updatedAt: new Date() })
        .where(
          and(
            eq(evalGenerationTasks.id, taskId),
            inArray(evalGenerationTasks.status, expected),
          ),
        )
        .returning({ id: evalGenerationTasks.id })
      if (!updated) return false
      await this.appendEvent(
        transaction,
        taskId,
        `task.${status.toLowerCase()}`,
        { schemaVersion: 1, status },
      )
      return true
    })
  }

  private async appendEvent(
    transaction: Transaction,
    taskId: string,
    type: string,
    payload: Readonly<Record<string, unknown>>,
    sourceAgentSequence: number | null = null,
  ): Promise<EvalGenerationEvent> {
    const [task] = await transaction
      .select({ id: evalGenerationTasks.id })
      .from(evalGenerationTasks)
      .where(eq(evalGenerationTasks.id, taskId))
      .for("update")
    if (!task) throw notFound(taskId)
    const [sequence] = await transaction
      .select({ value: max(evalGenerationEvents.sequence) })
      .from(evalGenerationEvents)
      .where(eq(evalGenerationEvents.taskId, taskId))
    const [event] = await transaction
      .insert(evalGenerationEvents)
      .values({
        id: randomUUID(),
        taskId,
        sequence: (sequence?.value ?? 0) + 1,
        type,
        payload,
        sourceAgentSequence,
      })
      .returning()
    if (!event) {
      throw new Error("Evals event insertion returned no database row.")
    }
    return mapEvent(event)
  }

  private mapTask(
    task: EvalGenerationTaskRow,
    workspaceId: string,
    related: {
      readonly draftId: string | null
      readonly draftStatus: "READY" | "PUBLISHED" | "DISCARDED" | null
      readonly evalCount: number | null
      readonly fileCount: number | null
      readonly revisionNumber: number | null
      readonly versionName: string | null
      readonly draftSourceRevision: number | null
    },
  ): EvalGenerationTaskView {
    return {
      id: task.id,
      suiteId: task.suiteId,
      workspaceId,
      status: task.status,
      target: {
        sourceKind: task.targetSourceKind,
        snapshotId: task.targetSnapshotId,
        versionId: task.targetVersionId,
        draftRevisionId: task.targetDraftRevisionId,
        skillName: task.skillName,
        displayVersion:
          task.targetSourceKind === "SKILL_VERSION"
            ? related.versionName ?? task.targetVersionId ?? task.targetSnapshotId
            : `R${related.draftSourceRevision ?? "?"}`,
      },
      maxEvalCount: task.maxEvalCount,
      generationBrief: task.generationBrief,
      error:
        task.errorCode && task.errorMessage
          ? {
              code: task.errorCode,
              message: task.errorMessage,
              details: task.errorDetails ?? null,
            }
          : null,
      usage: task.usage,
      draftId: related.draftId,
      draftStatus: related.draftStatus,
      evalCount: related.evalCount,
      fileCount: related.fileCount,
      revisionNumber: related.revisionNumber,
      createdAt: task.createdAt.toISOString(),
      updatedAt: task.updatedAt.toISOString(),
      startedAt: task.startedAt?.toISOString() ?? null,
      completedAt: task.completedAt?.toISOString() ?? null,
    }
  }

  private isUniqueViolation(error: unknown): boolean {
    let current: unknown = error
    for (let depth = 0; depth < 4; depth += 1) {
      if (
        current &&
        typeof current === "object" &&
        "code" in current &&
        current.code === "23505"
      ) {
        return true
      }
      current =
        current && typeof current === "object" && "cause" in current
          ? current.cause
          : null
    }
    return false
  }
}
