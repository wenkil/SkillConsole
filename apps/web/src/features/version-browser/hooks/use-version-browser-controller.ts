import { useQuery, useQueryClient } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import {
  commitDraftFolderMerge,
  createSkillVersion,
  deleteDraftFile,
  getActiveSkillDraft,
  getTargetFileDownloadUrl,
  getTargetImagePreviewUrl,
  listSkillVersions,
  listTargetFiles,
  previewDraftFolderMerge,
  readTargetTextFilePreview,
  saveDraftTextFile,
  setOnlineSkillVersion,
  updateSkillVersion,
  uploadDraftFile,
} from "@/features/version-browser/api/version-browser-api"
import {
  buildVersionFileTree,
  getDefaultFilePath,
  type CreateSkillVersionInput,
  type DraftFolderMergePreview,
  type SkillBrowserTarget,
  type SkillVersionBrowser,
  type SnapshotFile,
  type TextFilePreview,
  type VersionFileTreeNode,
  type VersionPreviewIssue,
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
  folderPreview: DraftFolderMergePreview | null
  mutationPending: boolean
  mutationError: Error | null
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
    saveText: (content: string) => Promise<void>
    uploadFile: (file: File, relativePath: string) => Promise<void>
    deleteFile: (relativePath: string) => Promise<void>
    previewFolder: (
      files: readonly File[],
      ignoreRules: readonly string[],
    ) => Promise<void>
    commitFolder: () => Promise<void>
    clearFolderPreview: () => void
    createVersion: (
      input: CreateSkillVersionInput,
    ) => Promise<SkillVersionBrowser>
    setOnline: (versionId: string) => Promise<void>
    updateVersion: (
      versionId: string,
      input: Pick<
        CreateSkillVersionInput,
        "name" | "description" | "labels"
      >,
    ) => Promise<SkillVersionBrowser>
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
  const [markdownView, setMarkdownView] = useState<"rendered" | "source">(
    "rendered",
  )
  const [mutationPending, setMutationPending] = useState(false)
  const [mutationError, setMutationError] = useState<Error | null>(null)
  const [folderPreview, setFolderPreview] =
    useState<DraftFolderMergePreview | null>(null)
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
          (target) => target.kind === "version" && target.isOnline,
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
      if (!selectedTarget) throw new Error("A file target is required.")
      return listTargetFiles(workspaceId, selectedTarget)
    },
    enabled: Boolean(selectedTarget),
  })
  const files = useMemo(
    () => filesQuery.data?.files ?? [],
    [filesQuery.data?.files],
  )
  const effectiveFilePath = selectedFilePath ?? getDefaultFilePath(files)
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
        throw new Error("A file target and selected file are required.")
      }
      return readTargetTextFilePreview(
        workspaceId,
        selectedTarget,
        selectedFile.relativePath,
      )
    },
    enabled: Boolean(selectedTarget && selectedFile && canReadText),
  })

  async function refreshAfterMutation(
    resource: Awaited<ReturnType<typeof saveDraftTextFile>>,
  ) {
    queryClient.setQueryData(
      ["skill-workspaces", workspaceId, "draft"],
      resource,
    )
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: [
          "skill-workspaces",
          workspaceId,
          "draft",
          resource.draft.id,
          "files",
        ],
      }),
      queryClient.invalidateQueries({ queryKey: ["skill-workspaces"] }),
    ])
  }

  async function runMutation(
    action: () => Promise<
      Awaited<ReturnType<typeof saveDraftTextFile>>
    >,
  ): Promise<void> {
    setMutationPending(true)
    setMutationError(null)
    try {
      await refreshAfterMutation(await action())
    } catch (error) {
      const normalized =
        error instanceof Error ? error : new Error(String(error))
      setMutationError(normalized)
      if (
        normalized instanceof SkillConsoleApiError &&
        normalized.status === 412
      ) {
        const latest = await getActiveSkillDraft(workspaceId).catch(
          () => null,
        )
        if (latest) {
          queryClient.setQueryData(
            ["skill-workspaces", workspaceId, "draft"],
            latest,
          )
        }
      }
      throw error
    } finally {
      setMutationPending(false)
    }
  }

  const imagePreviewUrl =
    selectedTarget &&
    selectedFile?.previewKind === "image" &&
    selectedFile.previewable
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
    selectedTarget?.kind === "version" &&
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
      retryPreview: () => void textPreviewQuery.refetch(),
      setSearchTerm,
      setMarkdownView,
      saveText: async (content) => {
        if (!draftQuery.data || !selectedFile) return
        await runMutation(() =>
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
        await runMutation(() =>
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
        await runMutation(() =>
          deleteDraftFile(
            workspaceId,
            draftQuery.data.etag,
            relativePath,
          ),
        )
      },
      previewFolder: async (filesToUpload, ignoreRules) => {
        if (!draftQuery.data) return
        setMutationPending(true)
        setMutationError(null)
        try {
          setFolderPreview(
            await previewDraftFolderMerge(
              workspaceId,
              draftQuery.data.etag,
              filesToUpload,
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
        await runMutation(() =>
          commitDraftFolderMerge(
            workspaceId,
            draftQuery.data.etag,
            folderPreview.operationId,
          ),
        )
        setFolderPreview(null)
      },
      clearFolderPreview: () => setFolderPreview(null),
      createVersion: async (input) => {
        setMutationPending(true)
        setMutationError(null)
        try {
          const version = await createSkillVersion(workspaceId, input)
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["skill-workspaces", workspaceId, "versions"],
            }),
            queryClient.invalidateQueries({
              queryKey: ["skill-workspaces"],
            }),
          ])
          return version
        } finally {
          setMutationPending(false)
        }
      },
      setOnline: async (versionId) => {
        setMutationPending(true)
        setMutationError(null)
        try {
          await setOnlineSkillVersion(workspaceId, versionId)
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["skill-workspaces", workspaceId, "versions"],
            }),
            queryClient.invalidateQueries({
              queryKey: ["skill-workspaces"],
            }),
          ])
        } catch (error) {
          setMutationError(
            error instanceof Error ? error : new Error(String(error)),
          )
          throw error
        } finally {
          setMutationPending(false)
        }
      },
      updateVersion: async (versionId, input) => {
        setMutationPending(true)
        setMutationError(null)
        try {
          const version = await updateSkillVersion(
            workspaceId,
            versionId,
            input,
          )
          await Promise.all([
            queryClient.invalidateQueries({
              queryKey: ["skill-workspaces", workspaceId, "versions"],
            }),
            queryClient.invalidateQueries({
              queryKey: ["skill-workspaces"],
            }),
          ])
          return version
        } finally {
          setMutationPending(false)
        }
      },
      clearMutationError: () => setMutationError(null),
    },
  }
}
