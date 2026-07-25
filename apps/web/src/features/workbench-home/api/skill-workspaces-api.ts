import {
  getUploadPath,
  type CreateSkillWorkspaceResponse,
  type CreateWorkbenchDraft,
  type SkillWorkspace,
} from "@/features/workbench-home/model/workbench"

interface ApiErrorResponse {
  error?: {
    code?: string
    message?: string
    requestId?: string
    details?: Record<string, unknown>
  }
}

export class SkillConsoleApiError extends Error {
  readonly code: string
  readonly requestId: string | undefined
  readonly details: Record<string, unknown> | undefined
  readonly status: number

  constructor(
    status: number,
    response: ApiErrorResponse,
  ) {
    super(response.error?.message || "The request could not be completed.")
    this.name = "SkillConsoleApiError"
    this.status = status
    this.code = response.error?.code || "REQUEST_FAILED"
    this.requestId = response.error?.requestId
    this.details = response.error?.details
  }
}

async function readApiError(response: Response): Promise<SkillConsoleApiError> {
  let body: ApiErrorResponse = {}
  try {
    body = (await response.json()) as ApiErrorResponse
  } catch {
    // The shared fallback below keeps proxy and network failures readable.
  }

  return new SkillConsoleApiError(response.status, body)
}

export async function listSkillWorkspaces(): Promise<SkillWorkspace[]> {
  const response = await fetch("/api/skill-workspaces", {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as SkillWorkspace[]
}

export async function createSkillWorkspace(
  draft: CreateWorkbenchDraft,
  operationId: string,
): Promise<CreateSkillWorkspaceResponse> {
  if (!draft.source) {
    throw new Error("A Skill source is required before creating a workbench.")
  }

  const formData = new FormData()
  formData.append("operationId", operationId)
  formData.append("name", draft.name.trim())
  formData.append("sourceType", draft.sourceKind)

  for (const file of draft.source.files) {
    formData.append("files", file, getUploadPath(draft.sourceKind, file))
  }

  const response = await fetch("/api/skill-workspaces", {
    method: "POST",
    body: formData,
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as CreateSkillWorkspaceResponse
}
