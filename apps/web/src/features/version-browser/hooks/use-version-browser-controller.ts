import { useQuery } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  getActiveSkillDraft,
  getTargetFileDownloadUrl,
  getTargetImagePreviewUrl,
  listSkillVersions,
  listTargetFiles,
  readTargetTextFilePreview,
} from "@/features/version-browser/api/version-browser-api"
import {
  buildVersionFileTree,
  getDefaultFilePath,
  type SkillBrowserTarget,
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
  activeDraftId: string | null
  selectedVersionId: string | null
  selectedFilePath: string | null
}

export interface VersionBrowserController {
  copy: VersionBrowserCopy
  versions: SkillVersionBrowser[]
  targets: SkillBrowserTarget[]
  selectedTarget: SkillBrowserTarget | null
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
  activeDraftId,
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
  const draftQuery = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "draft", activeDraftId],
    queryFn: () => getActiveSkillDraft(workspaceId),
    enabled: Boolean(activeDraftId),
  })
  const versions = useMemo(
    () => versionsQuery.data ?? [],
    [versionsQuery.data],
  )
  const targets = useMemo<SkillBrowserTarget[]>(() => {
    const draftTargets: SkillBrowserTarget[] = draftQuery.data
      ? [{ ...draftQuery.data, kind: "draft" }]
      : []
    return [
      ...draftTargets,
      ...versions.map(
        (version): SkillBrowserTarget => ({ ...version, kind: "version" }),
      ),
    ]
  }, [draftQuery.data, versions])
  const selectedTarget =
    targets.find(
      (target) =>
        target.kind === "version" && target.id === selectedVersionId,
    ) ??
    (selectedVersionId
      ? null
      : (targets.find((target) => target.kind === "draft") ??
        targets.find(
          (target) => target.kind === "version" && target.isCurrent,
        ) ??
        targets[0] ??
        null))

  const filesQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspaceId,
      selectedTarget?.kind,
      selectedTarget?.id,
      "files",
    ],
    queryFn: () => {
      if (!selectedTarget) {
        throw new Error("A browser target is required to list files.")
      }
      return listTargetFiles(workspaceId, selectedTarget)
    },
    enabled: Boolean(selectedTarget),
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
      selectedTarget?.kind,
      selectedTarget?.id,
      "text-preview",
      selectedFile?.relativePath,
    ],
    queryFn: () => {
      if (!selectedTarget || !selectedFile) {
        throw new Error("A browser target and file are required for preview.")
      }
      return readTargetTextFilePreview(
        workspaceId,
        selectedTarget,
        selectedFile.relativePath,
      )
    },
    enabled: Boolean(selectedTarget && selectedFile && canReadText),
  })

  const imagePreviewUrl =
    selectedTarget &&
    selectedFile?.previewable &&
    selectedFile.previewKind === "image"
      ? getTargetImagePreviewUrl(
          workspaceId,
          selectedTarget,
          selectedFile.relativePath,
        )
      : null
  const downloadUrl =
    selectedTarget && selectedFile
      ? getTargetFileDownloadUrl(
          workspaceId,
          selectedTarget,
          selectedFile.relativePath,
        )
      : null
  let previewIssue: VersionPreviewIssue | null = null

  if (selectedFilePath && filesQuery.isSuccess && !selectedFile) {
    previewIssue = "missing"
  } else if (
    selectedTarget &&
    selectedTarget.snapshot.state !== "READY"
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
    previewIssue = "binary"
  }

  return {
    copy,
    versions,
    targets,
    selectedTarget,
    tree,
    files,
    selectedFile,
    selectedFilePath: effectiveFilePath,
    textPreview: textPreviewQuery.data ?? null,
    imagePreviewUrl,
    downloadUrl,
    searchTerm,
    markdownView,
    loading:
      versionsQuery.isPending ||
      (Boolean(activeDraftId) && draftQuery.isPending),
    filesLoading: filesQuery.isPending && Boolean(selectedTarget),
    previewLoading: textPreviewQuery.isPending && canReadText,
    error:
      versionsQuery.isError ||
      (Boolean(activeDraftId) && draftQuery.isError) ||
      (Boolean(selectedTarget) && filesQuery.isError) ||
      (!versionsQuery.isPending &&
        Boolean(selectedVersionId) &&
        !selectedTarget),
    previewIssue,
    actions: {
      retry: () => {
        void versionsQuery.refetch()
        if (activeDraftId) void draftQuery.refetch()
        if (selectedTarget) void filesQuery.refetch()
      },
      retryPreview: () => {
        void textPreviewQuery.refetch()
      },
      setSearchTerm,
      setMarkdownView,
    },
  }
}
