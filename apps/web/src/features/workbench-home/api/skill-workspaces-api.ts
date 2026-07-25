import {
  getUploadPath,
  type CreateSkillWorkspaceResponse,
  type CreateWorkbenchDraft,
  type SkillWorkspace,
  type UploadFolderIgnorePolicy,
} from "@/features/workbench-home/model/workbench"
import { readApiError } from "@/shared/api/http"

export async function listSkillWorkspaces(): Promise<SkillWorkspace[]> {
  const response = await fetch("/api/skill-workspaces", {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as SkillWorkspace[]
}

export async function getUploadFolderIgnorePolicy(): Promise<UploadFolderIgnorePolicy> {
  const response = await fetch("/api/skill-workspace-upload-policy", {
    headers: {
      Accept: "application/json",
    },
  })

  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as UploadFolderIgnorePolicy
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
