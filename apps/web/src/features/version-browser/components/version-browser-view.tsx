import {
  AlertTriangle,
  CheckCircle2,
  GitCompareArrows,
  History,
  LoaderCircle,
  LockKeyhole,
  PackageOpen,
  PencilLine,
  RotateCcw,
} from "lucide-react"
import { useTranslation } from "react-i18next"
import { Link } from "react-router-dom"

import { CreateVersionDialog } from "@/features/version-browser/components/create-version-dialog"
import { DraftFileEditor } from "@/features/version-browser/components/draft-file-editor"
import { DraftUploadMenu } from "@/features/version-browser/components/draft-upload-menu"
import { VersionFilePreview } from "@/features/version-browser/components/version-file-preview"
import { VersionFileTree } from "@/features/version-browser/components/version-file-tree"
import { VersionMetadataDialog } from "@/features/version-browser/components/version-metadata-dialog"
import { useVersionBrowserController } from "@/features/version-browser/hooks/use-version-browser-controller"
import type { SkillBrowserTarget } from "@/features/version-browser/model/version-browser"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

interface VersionBrowserViewProps {
  workspace: SkillWorkspace
  selectedVersionId: string | null
  selectedFilePath: string | null
  onTargetSelect: (target: Pick<SkillBrowserTarget, "kind" | "id">) => void
  onFileSelect: (relativePath: string) => void
}

export function VersionBrowserView({
  workspace,
  selectedVersionId,
  selectedFilePath,
  onTargetSelect,
  onFileSelect,
}: VersionBrowserViewProps) {
  const { t } = useTranslation("versionBrowser")
  const controller = useVersionBrowserController({
    workspaceId: workspace.id,
    activeDraftId: workspace.activeDraft?.id ?? null,
    selectedVersionId,
    selectedFilePath,
  })
  const { copy, selectedTarget } = controller

  if (controller.loading) {
    return (
      <main className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden">
        <LoaderCircle className="size-4 animate-spin" />
      </main>
    )
  }

  if (controller.error || !selectedTarget) {
    return (
      <main className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-10 py-9">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <PackageOpen className="mx-auto mb-3 size-8 text-destructive" />
          <strong className="block">{copy.loadError}</strong>
          <p className="mt-2 text-sm text-muted-foreground">
            {copy.workspaceUnavailable}
          </p>
          <Button
            className="mt-4 rounded-none"
            onClick={controller.actions.retry}
            type="button"
            variant="outline"
          >
            <RotateCcw data-icon="inline-start" />
            {copy.retry}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground bg-background px-6 py-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
              {selectedTarget.kind === "draft" ? (
                <PencilLine className="size-3.5" />
              ) : selectedTarget.isOnline ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <History className="size-3.5" />
              )}
              Skill 版本 /{" "}
              {selectedTarget.kind === "draft"
                ? "工作副本"
                : selectedTarget.name}
            </div>
            <h1 className="truncate text-3xl leading-none font-[780] tracking-[-0.035em]">
              {workspace.name}
            </h1>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="grid gap-1 font-mono text-[9px] text-muted-foreground uppercase">
              查看目标
              <select
                className="h-9 min-w-48 border border-foreground bg-paper-raised px-3 font-mono text-xs outline-none focus:border-primary"
                onChange={(event) => {
                  const target = controller.targets.find(
                    (item) =>
                      `${item.kind}:${item.id}` === event.target.value,
                  )
                  if (target) onTargetSelect(target)
                }}
                value={`${selectedTarget.kind}:${selectedTarget.id}`}
              >
                {controller.targets.map((target) => (
                  <option
                    key={`${target.kind}:${target.id}`}
                    value={`${target.kind}:${target.id}`}
                  >
                    {target.kind === "draft"
                      ? `工作副本 · Revision ${target.contentRevision}`
                      : `${target.name}${target.isOnline ? " · 当前上线" : ""}`}
                  </option>
                ))}
              </select>
            </label>
            {controller.versions.length >= 2 ? (
              <Button asChild className="h-9 rounded-none" variant="outline">
                <Link to={`/workbenches/${workspace.id}/versions/compare`}>
                  <GitCompareArrows data-icon="inline-start" />
                  版本对比
                </Link>
              </Button>
            ) : null}
            {selectedTarget.kind === "draft" ? (
              <CreateVersionDialog
                onCreate={controller.actions.createVersion}
                onCreated={(version) =>
                  onTargetSelect({ kind: "version", id: version.id })
                }
                pending={controller.mutationPending}
                suggestedName={`V${controller.versions.length + 1}`}
              />
            ) : !selectedTarget.isOnline ? (
              <>
                <VersionMetadataDialog
                  onSave={controller.actions.updateVersion}
                  pending={controller.mutationPending}
                  version={selectedTarget}
                />
                <Button
                  className="h-9 rounded-none"
                  disabled={controller.mutationPending}
                  onClick={() => {
                    void controller.actions
                      .setOnline(selectedTarget.id)
                      .catch(() => undefined)
                  }}
                  type="button"
                >
                  <CheckCircle2 data-icon="inline-start" />
                  标记为当前上线
                </Button>
              </>
            ) : (
              <VersionMetadataDialog
                onSave={controller.actions.updateVersion}
                pending={controller.mutationPending}
                version={selectedTarget}
              />
            )}
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 border border-technical/55 bg-technical/5 px-3.5 py-2 text-xs">
          {selectedTarget.kind === "draft" ? (
            <PencilLine className="size-4 shrink-0 text-technical" />
          ) : (
            <LockKeyhole className="size-4 shrink-0 text-technical" />
          )}
          <strong>
            {selectedTarget.kind === "draft"
              ? "可持续编辑的工作副本"
              : "内容已冻结的测试版本"}
          </strong>
          <span className="text-muted-foreground">
            {selectedTarget.kind === "draft"
              ? `${selectedTarget.workingCopy.fileCount} 个文件 · 保存时只写入变化文件`
              : `${selectedTarget.snapshot.fileCount} 个文件 · ${selectedTarget.labels.join("、") || "暂无标签"}`}
          </span>
          {selectedTarget.kind === "version" && selectedTarget.isOnline ? (
            <span className="ml-auto border border-technical/50 bg-technical/10 px-2 py-1 font-mono text-[10px] font-bold text-technical-foreground">
              当前上线
            </span>
          ) : null}
        </div>
      </header>

      {controller.mutationError ? (
        <div
          className="flex shrink-0 items-center justify-between gap-4 border-b border-destructive/60 bg-destructive/5 px-4 py-2 text-xs"
          role="alert"
        >
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4 text-destructive" />
            {controller.mutationError.message}
          </span>
          <button
            className="font-mono text-[10px] underline"
            onClick={controller.actions.clearMutationError}
            type="button"
          >
            {t("draft.close")}
          </button>
        </div>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(15rem,18rem)_minmax(0,1fr)] overflow-hidden">
        <VersionFileTree
          actions={
            selectedTarget.kind === "draft" ? (
              <DraftUploadMenu
                draft={selectedTarget}
                folderPreview={controller.folderPreview}
                onClearFolderPreview={controller.actions.clearFolderPreview}
                onCommitFolder={controller.actions.commitFolder}
                onPreviewFolder={controller.actions.previewFolder}
                onUploadFile={async (file, relativePath) => {
                  await controller.actions.uploadFile(file, relativePath)
                  onFileSelect(relativePath)
                }}
                pending={controller.mutationPending}
              />
            ) : null
          }
          copy={copy}
          fileCount={controller.files.length}
          onFileSelect={onFileSelect}
          onSearchTermChange={controller.actions.setSearchTerm}
          searchTerm={controller.searchTerm}
          selectedPath={controller.selectedFilePath}
          tree={controller.tree}
        />
        {selectedTarget.kind === "draft" &&
        controller.selectedFile &&
        controller.textPreview &&
        controller.selectedFile.contentKind === "text" ? (
          <DraftFileEditor
            conflict={controller.conflict}
            errorMessage={controller.mutationError?.message ?? null}
            file={controller.selectedFile}
            key={controller.selectedFile.relativePath}
            onClearError={controller.actions.clearMutationError}
            onDelete={async () => {
              const path = controller.selectedFile?.relativePath
              if (!path) return
              await controller.actions.deleteFile(path)
              const fallback = controller.files.find(
                (candidate) => candidate.relativePath !== path,
              )
              if (fallback) onFileSelect(fallback.relativePath)
            }}
            onSave={controller.actions.saveText}
            preview={controller.textPreview}
            saving={controller.mutationPending}
          />
        ) : (
          <VersionFilePreview
            copy={copy}
            downloadUrl={controller.downloadUrl}
            file={controller.selectedFile}
            imagePreviewUrl={controller.imagePreviewUrl}
            loading={controller.filesLoading || controller.previewLoading}
            markdownView={controller.markdownView}
            onMarkdownViewChange={controller.actions.setMarkdownView}
            onPathSelect={onFileSelect}
            onRetry={controller.actions.retryPreview}
            previewIssue={controller.previewIssue}
            textPreview={controller.textPreview}
          />
        )}
      </div>
    </main>
  )
}
