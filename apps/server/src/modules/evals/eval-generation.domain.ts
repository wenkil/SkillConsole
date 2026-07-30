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
  readonly createdAt: string
  readonly updatedAt: string
  readonly startedAt: string | null
  readonly completedAt: string | null
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
