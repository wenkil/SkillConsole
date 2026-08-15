export type EvalGenerationStatus =
  | "PREPARING"
  | "RUNNING"
  | "VALIDATING"
  | "SUCCEEDED"
  | "CANCELING"
  | "CANCELED"
  | "INTERRUPTED"
  | "FAILED"

export interface EvalGenerationTask {
  id: string
  suiteId: string
  workspaceId: string
  status: EvalGenerationStatus
  target: {
    sourceKind: "DRAFT_REVISION" | "SKILL_VERSION"
    snapshotId: string
    versionId: string | null
    draftRevisionId: string | null
    skillName: string
    displayVersion: string
  }
  maxEvalCount: number
  generationBrief: string | null
  error: {
    code: string
    message: string
    details: Record<string, unknown> | null
  } | null
  usage: Record<string, number> | null
  draftId: string | null
  draftStatus: "READY" | "PUBLISHED" | "DISCARDED" | null
  evalCount: number | null
  fileCount: number | null
  revisionNumber: number | null
  createdAt: string
  updatedAt: string
  startedAt: string | null
  completedAt: string | null
}

export interface EvalGenerationTaskPage {
  items: EvalGenerationTask[]
  pagination: {
    page: number
    pageSize: number
    total: number
    pageCount: number
  }
  summary: {
    total: number
    running: number
    awaitingReview: number
    published: number
    failed: number
  }
}

export interface EvalCase {
  externalId: number
  name: string
  prompt: string
  expectedOutput: string
  assertions: string[]
  files: string[]
}

export interface EvalFile {
  relativePath: string
  sha256: string
  byteSize: number
  mediaTypeHint: string
  contentKind: "text" | "binary"
}

export interface EvalGenerationDraft {
  id: string
  taskId: string
  status: "READY" | "PUBLISHED" | "DISCARDED"
  sourceSchemaVariant: "assertions" | "expectations" | "mixed"
  rawEvalsSha256: string
  manifestHash: string
  evalCount: number
  fileCount: number
  totalBytes: number
  cases: EvalCase[]
  files: EvalFile[]
  createdAt: string
  updatedAt: string
}

export interface EvalRevision {
  id: string
  suiteId: string
  sequenceNumber: number
  skillName: string
  sourceGenerationTaskId: string
  sourceSnapshotId: string
  manifestHash: string
  rawEvalsSha256: string
  evalCount: number
  fileCount: number
  totalBytes: number
  createdAt: string
}

export interface EvalGenerationEvent {
  sequence: number
  type: string
  taskId: string
  occurredAt: string
  payload: Record<string, unknown>
}

export type EvalGenerationTarget =
  | {
      kind: "draft"
      draftId: string
      contentRevision: number
    }
  | {
      kind: "version"
      versionId: string
    }

export interface StartEvalGenerationInput {
  target: EvalGenerationTarget
  maxEvalCount: number
  generationBrief?: string | null
}

export interface SaveEvalRevisionResult {
  replayed: boolean
  revision: EvalRevision
}

export const activeEvalGenerationStatuses: readonly EvalGenerationStatus[] = [
  "PREPARING",
  "RUNNING",
  "VALIDATING",
  "CANCELING",
]

export function isActiveEvalGeneration(
  status: EvalGenerationStatus,
): boolean {
  return activeEvalGenerationStatuses.includes(status)
}
