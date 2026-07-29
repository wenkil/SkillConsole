import type {
  CreateSkillVersionInput,
  DraftFolderMergePreview,
  DraftResource,
  SkillBrowserTarget,
  SkillDraftBrowser,
  SkillVersionBrowser,
  SnapshotFileList,
  TextFilePreview,
  VersionComparison,
} from "@/features/version-browser/model/version-browser"
import { readApiError } from "@/shared/api/http"

function versionBaseUrl(workspaceId: string, versionId: string): string {
  return `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions/${encodeURIComponent(versionId)}`
}

function draftBaseUrl(workspaceId: string): string {
  return `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/draft`
}

function targetBaseUrl(
  workspaceId: string,
  target: Pick<SkillBrowserTarget, "kind" | "id">,
): string {
  return target.kind === "draft"
    ? draftBaseUrl(workspaceId)
    : versionBaseUrl(workspaceId, target.id)
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as T
}

export function getActiveSkillDraft(
  workspaceId: string,
): Promise<DraftResource> {
  return readDraftResource(draftBaseUrl(workspaceId))
}

async function readDraftResource(
  url: string,
  init?: RequestInit,
): Promise<DraftResource> {
  const response = await fetch(url, {
    ...init,
    headers: {
      Accept: "application/json",
      ...init?.headers,
    },
  })
  if (!response.ok) throw await readApiError(response)
  const etag = response.headers.get("ETag")
  if (!etag) {
    throw new Error("The Draft response did not include an ETag.")
  }
  const body = (await response.json()) as
    | SkillDraftBrowser
    | { draft: SkillDraftBrowser }
  return {
    draft: "draft" in body ? body.draft : body,
    etag,
  }
}

function draftWriteHeaders(etag: string): HeadersInit {
  return {
    "Content-Type": "application/json",
    "If-Match": etag,
    "Idempotency-Key": crypto.randomUUID(),
  }
}

export function createSkillDraft(workspaceId: string): Promise<DraftResource> {
  return readDraftResource(draftBaseUrl(workspaceId), { method: "POST" })
}

export function saveDraftTextFile(
  workspaceId: string,
  etag: string,
  relativePath: string,
  content: string,
): Promise<DraftResource> {
  return readDraftResource(`${draftBaseUrl(workspaceId)}/files/text`, {
    method: "PUT",
    headers: draftWriteHeaders(etag),
    body: JSON.stringify({ path: relativePath, content }),
  })
}

export function uploadDraftFile(
  workspaceId: string,
  etag: string,
  relativePath: string,
  file: File,
): Promise<DraftResource> {
  const body = new FormData()
  body.append("path", relativePath)
  body.append("file", file, file.name)
  return readDraftResource(`${draftBaseUrl(workspaceId)}/files`, {
    method: "POST",
    headers: {
      "If-Match": etag,
      "Idempotency-Key": crypto.randomUUID(),
    },
    body,
  })
}

export function deleteDraftFile(
  workspaceId: string,
  etag: string,
  relativePath: string,
): Promise<DraftResource> {
  const query = new URLSearchParams({ path: relativePath })
  return readDraftResource(
    `${draftBaseUrl(workspaceId)}/files?${query}`,
    {
      method: "DELETE",
      headers: draftWriteHeaders(etag),
    },
  )
}

export async function previewDraftFolderMerge(
  workspaceId: string,
  etag: string,
  files: readonly File[],
  ignoreRules: readonly string[],
): Promise<DraftFolderMergePreview> {
  const body = new FormData()
  body.append("operationId", crypto.randomUUID())
  body.append(
    "sourceName",
    files[0]?.webkitRelativePath.split("/")[0] || "Skill folder",
  )
  body.append("ignoreRules", JSON.stringify(ignoreRules))
  for (const file of files) {
    body.append("files", file, file.webkitRelativePath || file.name)
  }
  const response = await fetch(
    `${draftBaseUrl(workspaceId)}/folder-merges`,
    {
      method: "POST",
      headers: { Accept: "application/json", "If-Match": etag },
      body,
    },
  )
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as DraftFolderMergePreview
}

export function commitDraftFolderMerge(
  workspaceId: string,
  etag: string,
  operationId: string,
): Promise<DraftResource> {
  return readDraftResource(
    `${draftBaseUrl(workspaceId)}/folder-merges/${encodeURIComponent(operationId)}/commit`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "If-Match": etag,
        "Idempotency-Key": `folder-merge-${operationId}`,
      },
      body: JSON.stringify({}),
    },
  )
}

export function listSkillVersions(
  workspaceId: string,
): Promise<SkillVersionBrowser[]> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions`,
  )
}

export async function createSkillVersion(
  workspaceId: string,
  input: CreateSkillVersionInput,
): Promise<SkillVersionBrowser> {
  const response = await fetch(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(input),
    },
  )
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as SkillVersionBrowser
}

export async function updateSkillVersion(
  workspaceId: string,
  versionId: string,
  input: Pick<
    CreateSkillVersionInput,
    "name" | "description" | "labels"
  >,
): Promise<SkillVersionBrowser> {
  const response = await fetch(versionBaseUrl(workspaceId, versionId), {
    method: "PATCH",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(input),
  })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as SkillVersionBrowser
}

export async function setOnlineSkillVersion(
  workspaceId: string,
  versionId: string,
): Promise<SkillVersionBrowser> {
  const response = await fetch(
    `${versionBaseUrl(workspaceId, versionId)}/online`,
    {
      method: "PUT",
      headers: { Accept: "application/json" },
    },
  )
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as SkillVersionBrowser
}

export function compareSkillVersions(
  workspaceId: string,
  leftVersionId: string,
  rightVersionId: string,
): Promise<VersionComparison> {
  const query = new URLSearchParams({ leftVersionId, rightVersionId })
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions/compare?${query}`,
  )
}

export function listTargetFiles(
  workspaceId: string,
  target: Pick<SkillBrowserTarget, "kind" | "id">,
): Promise<SnapshotFileList> {
  return readJson(`${targetBaseUrl(workspaceId, target)}/files`)
}

export function readTargetTextFilePreview(
  workspaceId: string,
  target: Pick<SkillBrowserTarget, "kind" | "id">,
  relativePath: string,
): Promise<TextFilePreview> {
  const query = new URLSearchParams({ path: relativePath })
  return readJson(
    `${targetBaseUrl(workspaceId, target)}/files/text-preview?${query}`,
  )
}

export function getTargetImagePreviewUrl(
  workspaceId: string,
  target: Pick<SkillBrowserTarget, "kind" | "id">,
  relativePath: string,
): string {
  const query = new URLSearchParams({ path: relativePath })
  return `${targetBaseUrl(workspaceId, target)}/files/image-preview?${query}`
}

export function getTargetFileDownloadUrl(
  workspaceId: string,
  target: Pick<SkillBrowserTarget, "kind" | "id">,
  relativePath: string,
): string {
  const query = new URLSearchParams({ path: relativePath })
  return `${targetBaseUrl(workspaceId, target)}/files/download?${query}`
}
