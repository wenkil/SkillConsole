import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  abandonSkillDraft,
  commitDraftFolderMerge,
  createSkillDraft,
  deleteDraftFile,
  getActiveSkillDraft,
  getTargetFileDownloadUrl,
  getTargetImagePreviewUrl,
  listSkillVersions,
  listTargetFiles,
  moveDraftFile,
  previewDraftFolderMerge,
  readDraftBaseTextFile,
  readDraftDiff,
  readTargetTextFilePreview,
  saveDraftTextFile,
  uploadDraftFile,
} from "@/features/version-browser/api/version-browser-api"
import {
  buildVersionFileTree,
  getDefaultFilePath,
  type SkillBrowserTarget,
  type SkillVersionBrowser,
  type DraftDiff,
  type DraftFolderMergePreview,
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
  draftEtag: string | null
  draftDiff: DraftDiff | null
  baseTextPreview: TextFilePreview | null
  conflictServerPreview: TextFilePreview | null
  folderPreview: DraftFolderMergePreview | null
  mutationPending: boolean
  mutationError: SkillConsoleApiError | Error | null
  conflict: boolean
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
    createDraft: () => Promise<string | null>
    saveText: (content: string) => Promise<void>
    uploadFile: (file: File, relativePath: string) => Promise<void>
    deleteFile: (relativePath: string) => Promise<void>
    moveFile: (fromPath: string, toPath: string) => Promise<void>
    previewFolder: (
      files: readonly File[],
      ignoreRules: readonly string[],
    ) => Promise<void>
    commitFolder: () => Promise<void>
    clearFolderPreview: () => void
    abandonDraft: () => Promise<void>
    clearMutationError: () => void
  }
}

export function useVersionBrowserController({
  workspaceId,
  activeDraftId,
  selectedVersionId,
  selectedFilePath,
}: UseVersionBrowserControllerOptions): VersionBrowserController {
  const { t } = useTranslation("versionBrowser")
  const queryClient = useQueryClient()
  const [searchTerm, setSearchTerm] = useState("")
  const [markdownView, setMarkdownView] = useState<
    "rendered" | "source"
  >("rendered")
  const [mutationPending, setMutationPending] = useState(false)
  const [mutationError, setMutationError] = useState<
    SkillConsoleApiError | Error | null
  >(null)
  const [folderPreview, setFolderPreview] =
    useState<DraftFolderMergePreview | null>(null)
  const [conflictServerPreview, setConflictServerPreview] =
    useState<TextFilePreview | null>(null)
  const copy = useMemo(() => getVersionBrowserCopy(t), [t])
  const versionsQuery = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "versions"],
    queryFn: () => listSkillVersions(workspaceId),
  })
  const draftQuery = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "draft"],
    queryFn: () => getActiveSkillDraft(workspaceId),
    enabled: Boolean(activeDraftId),
  })
  const versions = useMemo(
    () => versionsQuery.data ?? [],
    [versionsQuery.data],
  )
  const targets = useMemo<SkillBrowserTarget[]>(() => {
    const draftTargets: SkillBrowserTarget[] = draftQuery.data
      ? [{ ...draftQuery.data.draft, kind: "draft" }]
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
  const draftDiffQuery = useQuery({
    queryKey: ["skill-workspaces", workspaceId, "draft", "diff"],
    queryFn: () => readDraftDiff(workspaceId),
    enabled: selectedTarget?.kind === "draft",
  })
  const selectedDiffEntry =
    draftDiffQuery.data?.entries.find(
      (entry) => entry.relativePath === selectedFile?.relativePath,
    ) ?? null
  const baseTextPreviewQuery = useQuery({
    queryKey: [
      "skill-workspaces",
      workspaceId,
      "draft",
      "diff",
      "base-text",
      selectedFile?.relativePath,
    ],
    queryFn: () => {
      if (!selectedFile) {
        throw new Error("A Draft file is required for comparison.")
      }
      return readDraftBaseTextFile(workspaceId, selectedFile.relativePath)
    },
    enabled:
      selectedTarget?.kind === "draft" &&
      Boolean(selectedFile && canReadText && selectedDiffEntry?.base),
  })

  async function refreshAfterMutation(
    resource: Awaited<ReturnType<typeof saveDraftTextFile>>,
  ) {
    queryClient.setQueryData(
      ["skill-workspaces", workspaceId, "draft"],
      resource,
    )
    await queryClient.invalidateQueries({
      queryKey: ["skill-workspaces", workspaceId],
    })
    await queryClient.invalidateQueries({
      queryKey: ["skill-workspaces"],
    })
  }

  async function runDraftMutation(
    action: () => Promise<
      Awaited<ReturnType<typeof saveDraftTextFile>>
    >,
  ): Promise<void> {
    setMutationPending(true)
    setMutationError(null)
    setConflictServerPreview(null)
    try {
      await refreshAfterMutation(await action())
    } catch (error) {
      const normalizedError =
        error instanceof Error ? error : new Error(String(error))
      setMutationError(normalizedError)
      if (
        normalizedError instanceof SkillConsoleApiError &&
        normalizedError.status === 412 &&
        selectedFile
      ) {
        try {
          const latest = await getActiveSkillDraft(workspaceId)
          queryClient.setQueryData(
            ["skill-workspaces", workspaceId, "draft"],
            latest,
          )
          const [serverPreview, latestDiff] = await Promise.all([
            readTargetTextFilePreview(
              workspaceId,
              { kind: "draft", id: latest.draft.id },
              selectedFile.relativePath,
            ),
            readDraftDiff(workspaceId),
          ])
          setConflictServerPreview(serverPreview)
          queryClient.setQueryData(
            ["skill-workspaces", workspaceId, "draft", "diff"],
            latestDiff,
          )
        } catch {
          // The original 412 remains the actionable error.
        }
      }
      throw error
    } finally {
      setMutationPending(false)
    }
  }

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
    draftEtag: draftQuery.data?.etag ?? null,
    draftDiff: draftDiffQuery.data ?? null,
    baseTextPreview: baseTextPreviewQuery.data ?? null,
    conflictServerPreview,
    folderPreview,
    mutationPending,
    mutationError,
    conflict:
      mutationError instanceof SkillConsoleApiError &&
      mutationError.status === 412,
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
      createDraft: async () => {
        setMutationPending(true)
        setMutationError(null)
        try {
          const resource = await createSkillDraft(workspaceId)
          queryClient.setQueryData(
            ["skill-workspaces", workspaceId, "draft"],
            resource,
          )
          await queryClient.invalidateQueries({
            queryKey: ["skill-workspaces"],
          })
          return resource.draft.id
        } catch (error) {
          setMutationError(
            error instanceof Error ? error : new Error(String(error)),
          )
          throw error
        } finally {
          setMutationPending(false)
        }
      },
      saveText: async (content) => {
        if (!draftQuery.data || !selectedFile) return
        await runDraftMutation(() =>
          saveDraftTextFile(
            workspaceId,
            draftQuery.data.etag,
            selectedFile.relativePath,
            content,
          ),
        )
      },
      uploadFile: async (file, relativePath) => {
        if (!draftQuery.data) return
        await runDraftMutation(() =>
          uploadDraftFile(
            workspaceId,
            draftQuery.data.etag,
            relativePath,
            file,
          ),
        )
      },
      deleteFile: async (relativePath) => {
        if (!draftQuery.data) return
        await runDraftMutation(() =>
          deleteDraftFile(
            workspaceId,
            draftQuery.data.etag,
            relativePath,
          ),
        )
      },
      moveFile: async (fromPath, toPath) => {
        if (!draftQuery.data) return
        await runDraftMutation(() =>
          moveDraftFile(
            workspaceId,
            draftQuery.data.etag,
            fromPath,
            toPath,
          ),
        )
      },
      previewFolder: async (files, ignoreRules) => {
        if (!draftQuery.data) return
        setMutationPending(true)
        setMutationError(null)
        try {
          setFolderPreview(
            await previewDraftFolderMerge(
              workspaceId,
              draftQuery.data.etag,
              files,
              ignoreRules,
            ),
          )
        } catch (error) {
          setMutationError(
            error instanceof Error ? error : new Error(String(error)),
          )
          throw error
        } finally {
          setMutationPending(false)
        }
      },
      commitFolder: async () => {
        if (!draftQuery.data || !folderPreview) return
        await runDraftMutation(() =>
          commitDraftFolderMerge(
            workspaceId,
            draftQuery.data.etag,
            folderPreview.operationId,
          ),
        )
        setFolderPreview(null)
      },
      clearFolderPreview: () => setFolderPreview(null),
      abandonDraft: async () => {
        if (!draftQuery.data) return
        setMutationPending(true)
        setMutationError(null)
        try {
          await abandonSkillDraft(workspaceId, draftQuery.data.etag)
          queryClient.setQueryData(
            ["skill-workspaces", workspaceId, "draft"],
            undefined,
          )
          await queryClient.invalidateQueries({
            queryKey: ["skill-workspaces"],
          })
        } catch (error) {
          setMutationError(
            error instanceof Error ? error : new Error(String(error)),
          )
          throw error
        } finally {
          setMutationPending(false)
        }
      },
      clearMutationError: () => {
        setMutationError(null)
        setConflictServerPreview(null)
      },
    },
  }
}
