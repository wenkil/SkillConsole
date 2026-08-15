import type {
  EvalGenerationStatus,
  StoredEvalCase,
  StoredEvalFile,
} from "../../infrastructure/database/index.js"

export interface EvalGenerationEvent {
  readonly sequence: number
  readonly type: string
  readonly taskId: string
  readonly occurredAt: string
  readonly payload: Readonly<Record<string, unknown>>
}

export interface EvalGenerationTaskView {
  readonly id: string
  readonly suiteId: string
  readonly workspaceId: string
  readonly status: EvalGenerationStatus
  readonly target: {
    readonly sourceKind: "DRAFT_REVISION" | "SKILL_VERSION"
    readonly snapshotId: string
    readonly versionId: string | null
    readonly draftRevisionId: string | null
    readonly skillName: string
    readonly displayVersion: string
  }
  readonly maxEvalCount: number
  readonly generationBrief: string | null
  readonly error: {
    readonly code: string
    readonly message: string
    readonly details: Readonly<Record<string, unknown>> | null
  } | null
  readonly usage: Readonly<Record<string, number>> | null
  readonly draftId: string | null
  readonly draftStatus: "READY" | "PUBLISHED" | "DISCARDED" | null
  readonly evalCount: number | null
  readonly fileCount: number | null
  readonly revisionNumber: number | null
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
}

export interface EvalGenerationTaskPage {
  readonly items: readonly EvalGenerationTaskView[]
  readonly pagination: {
    readonly page: number
    readonly pageSize: number
    readonly total: number
    readonly pageCount: number
  }
  readonly summary: {
    readonly total: number
    readonly running: number
    readonly awaitingReview: number
    readonly published: number
    readonly failed: number
  }
}

export interface EvalGenerationDraftView {
  readonly id: string
  readonly taskId: string
  readonly status: "READY" | "PUBLISHED" | "DISCARDED"
  readonly sourceSchemaVariant: "assertions" | "expectations" | "mixed"
  readonly rawEvalsSha256: string
  readonly manifestHash: string
  readonly evalCount: number
  readonly fileCount: number
  readonly totalBytes: number
  readonly cases: readonly StoredEvalCase[]
  readonly files: readonly StoredEvalFile[]
  readonly createdAt: string
  readonly updatedAt: string
}

export interface EvalGenerationFailureSummaryView {
  readonly evalsJsonState: "MISSING" | "INVALID_JSON" | "ROOT_INVALID" | "VALID"
  readonly evalCount: number | null
  readonly incompleteCaseIndexes: number[]
  readonly ignoredFiles: string[]
}

export interface EvalRevisionView {
  readonly id: string
  readonly suiteId: string
  readonly sequenceNumber: number
  readonly skillName: string
  readonly sourceGenerationTaskId: string
  readonly sourceSnapshotId: string
  readonly manifestHash: string
  readonly rawEvalsSha256: string
  readonly evalCount: number
  readonly fileCount: number
  readonly totalBytes: number
  readonly createdAt: string
}

export interface PublishEvalRevisionResult {
  readonly replayed: boolean
  readonly revision: EvalRevisionView
}
