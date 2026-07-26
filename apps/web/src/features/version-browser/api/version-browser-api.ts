import type {
  SkillBrowserTarget,
  SkillDraftBrowser,
  SkillVersionBrowser,
  SnapshotFileList,
  TextFilePreview,
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
): Promise<SkillDraftBrowser> {
  return readJson(draftBaseUrl(workspaceId))
}

export function listSkillVersions(
  workspaceId: string,
): Promise<SkillVersionBrowser[]> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions`,
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
