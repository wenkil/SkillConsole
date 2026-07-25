import type {
  SkillVersionBrowser,
  SnapshotFileList,
  TextFilePreview,
} from "@/features/version-browser/model/version-browser"
import { readApiError } from "@/shared/api/http"

function versionBaseUrl(workspaceId: string, versionId: string): string {
  return `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions/${encodeURIComponent(versionId)}`
}

async function readJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  })
  if (!response.ok) throw await readApiError(response)
  return (await response.json()) as T
}

export function listSkillVersions(
  workspaceId: string,
): Promise<SkillVersionBrowser[]> {
  return readJson(
    `/api/skill-workspaces/${encodeURIComponent(workspaceId)}/versions`,
  )
}

export function listVersionFiles(
  workspaceId: string,
  versionId: string,
): Promise<SnapshotFileList> {
  return readJson(`${versionBaseUrl(workspaceId, versionId)}/files`)
}

export function readTextFilePreview(
  workspaceId: string,
  versionId: string,
  relativePath: string,
): Promise<TextFilePreview> {
  const query = new URLSearchParams({ path: relativePath })
  return readJson(
    `${versionBaseUrl(workspaceId, versionId)}/files/text-preview?${query}`,
  )
}

export function getImagePreviewUrl(
  workspaceId: string,
  versionId: string,
  relativePath: string,
): string {
  const query = new URLSearchParams({ path: relativePath })
  return `${versionBaseUrl(workspaceId, versionId)}/files/image-preview?${query}`
}

export function getFileDownloadUrl(
  workspaceId: string,
  versionId: string,
  relativePath: string,
): string {
  const query = new URLSearchParams({ path: relativePath })
  return `${versionBaseUrl(workspaceId, versionId)}/files/download?${query}`
}
