import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  getFileDownloadUrl,
  getImagePreviewUrl,
  listSkillVersions,
  listVersionFiles,
  readTextFilePreview,
} from "@/features/version-browser/api/version-browser-api"
import {
  buildVersionFileTree,
  getDefaultFilePath,
  type SkillVersionBrowser,
  type SnapshotFile,
  type TextFilePreview,
  type VersionPreviewIssue,
  type VersionFileTreeNode,
} from "@/features/version-browser/model/version-browser"
import {
  getVersionBrowserCopy,
  type VersionBrowserCopy,
} from "@/features/version-browser/model/version-browser-copy"
import { SkillConsoleApiError } from "@/shared/api/http"

interface UseVersionBrowserControllerOptions {
  workspaceId: string
  selectedVersionId: string | null
  selectedFilePath: string | null
}

export interface VersionBrowserController {
  copy: VersionBrowserCopy
  versions: SkillVersionBrowser[]
  selectedVersion: SkillVersionBrowser | null
  tree: VersionFileTreeNode[]
  files: SnapshotFile[]
  selectedFile: SnapshotFile | null
  selectedFilePath: string | null
  textPreview: TextFilePreview | null
  imagePreviewUrl: string | null
  downloadUrl: string | null
  searchTerm: string
  markdownView: "rendered" | "source"
  loading: boolean
  filesLoading: boolean
  previewLoading: boolean
  error: boolean
  previewIssue: VersionPreviewIssue | null
  actions: {
    retry: () => void
    retryPreview: () => void
    setSearchTerm: (value: string) => void
    setMarkdownView: (value: "rendered" | "source") => void
  }
}

export function useVersionBrowserController({
  workspaceId,
  selectedVersionId,
  selectedFilePath,
}: UseVersionBrowserControllerOptions): VersionBrowserController {
  const { t } = useTranslation("versionBrowser")
  const [searchTerm, setSearchTerm] = useState("")
  const [markdownView, setMarkdownView] = useState<
    "rendered" | "source"
  >("rendered")
  const copy = useMemo(() => getVersionBrowserCopy(t), [t])
  const versionsQuery = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "versions"],
    queryFn: () => listSkillVersions(workspaceId),
  })
  const versions = versionsQuery.data ?? []
  const selectedVersion =
    versions.find((version) => version.id === selectedVersionId) ??
    (selectedVersionId
      ? null
      : (versions.find((version) => version.isCurrent) ?? versions[0] ?? null))

  const filesQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspaceId,
      "versions",
      selectedVersion?.id,
      "files",
    ],
    queryFn: () => listVersionFiles(workspaceId, selectedVersion!.id),
    enabled: Boolean(selectedVersion),
  })
  const files = useMemo(
    () => filesQuery.data?.files ?? [],
    [filesQuery.data?.files],
  )
  const effectiveFilePath =
    selectedFilePath ?? getDefaultFilePath(files)
  const selectedFile =
    files.find((file) => file.relativePath === effectiveFilePath) ?? null
  const tree = useMemo(() => buildVersionFileTree(files), [files])
  const canReadText =
    selectedFile?.previewable === true &&
    selectedFile.previewKind !== "image" &&
    selectedFile.previewKind !== "binary"

  const textPreviewQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspaceId,
      "versions",
      selectedVersion?.id,
      "text-preview",
      selectedFile?.relativePath,
    ],
    queryFn: () =>
      readTextFilePreview(
        workspaceId,
        selectedVersion!.id,
        selectedFile!.relativePath,
      ),
    enabled: Boolean(selectedVersion && selectedFile && canReadText),
  })

  const imagePreviewUrl =
    selectedVersion &&
    selectedFile?.previewable &&
    selectedFile.previewKind === "image"
      ? getImagePreviewUrl(
          workspaceId,
          selectedVersion.id,
          selectedFile.relativePath,
        )
      : null
  const downloadUrl =
    selectedVersion && selectedFile
      ? getFileDownloadUrl(
          workspaceId,
          selectedVersion.id,
          selectedFile.relativePath,
        )
      : null
  let previewIssue: VersionPreviewIssue | null = null

  if (selectedFilePath && filesQuery.isSuccess && !selectedFile) {
    previewIssue = "missing"
  } else if (
    selectedVersion &&
    selectedVersion.snapshot.state !== "READY"
  ) {
    previewIssue = "snapshot_unavailable"
  } else if (textPreviewQuery.error instanceof SkillConsoleApiError) {
    previewIssue =
      textPreviewQuery.error.code === "SNAPSHOT_FILE_CORRUPTED"
        ? "corrupted"
        : textPreviewQuery.error.code === "FILE_UTF8_INVALID"
          ? "invalid_utf8"
          : textPreviewQuery.error.code === "SNAPSHOT_NOT_READY"
            ? "snapshot_unavailable"
            : textPreviewQuery.error.code === "SNAPSHOT_FILE_NOT_FOUND"
              ? "missing"
              : "unavailable"
  } else if (selectedFile && !selectedFile.previewable) {
    previewIssue =
      selectedFile.previewKind === "binary" ? "binary" : "too_large"
  }

  return {
    copy,
    versions,
    selectedVersion,
    tree,
    files,
    selectedFile,
    selectedFilePath: effectiveFilePath,
    textPreview: textPreviewQuery.data ?? null,
    imagePreviewUrl,
    downloadUrl,
    searchTerm,
    markdownView,
    loading: versionsQuery.isPending,
    filesLoading: filesQuery.isPending && Boolean(selectedVersion),
    previewLoading: textPreviewQuery.isPending && canReadText,
    error:
      versionsQuery.isError ||
      (Boolean(selectedVersion) && filesQuery.isError) ||
      (!versionsQuery.isPending &&
        Boolean(selectedVersionId) &&
        !selectedVersion),
    previewIssue,
    actions: {
      retry: () => {
        void versionsQuery.refetch()
        if (selectedVersion) void filesQuery.refetch()
      },
      retryPreview: () => {
        void textPreviewQuery.refetch()
      },
      setSearchTerm,
      setMarkdownView,
    },
  }
}
