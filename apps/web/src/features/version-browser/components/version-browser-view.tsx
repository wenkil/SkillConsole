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
import { StatusBanner } from "@/shared/components/ui/status-banner"

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
  const { i18n, t } = useTranslation("versionBrowser")
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
        <div className="max-w-md rounded-2xl border border-destructive/30 bg-destructive/5 p-7 text-center shadow-[var(--surface-shadow)]">
          <PackageOpen className="mx-auto mb-3 size-8 text-destructive" />
          <strong className="block">{copy.loadError}</strong>
          <p className="mt-2 text-sm text-muted-foreground">
            {copy.workspaceUnavailable}
          </p>
          <Button
            className="mt-4 rounded-xl"
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
      <header className="shrink-0 border-b border-border bg-background px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="min-w-0">
            <div className="ui-label mb-1.5 flex items-center gap-2 text-signal-dark">
              {selectedTarget.kind === "draft" ? (
                <PencilLine className="size-3.5" />
              ) : selectedTarget.isOnline ? (
                <CheckCircle2 className="size-3.5" />
              ) : (
                <History className="size-3.5" />
              )}
              {copy.versionPrefix} /{" "}
              {selectedTarget.kind === "draft"
                ? copy.initialCandidate
                : selectedTarget.name}
            </div>
            <h1 className="font-display truncate text-[clamp(2rem,3vw,2.75rem)] leading-[1.08] font-semibold tracking-[-0.035em]">
              {workspace.name}
            </h1>
          </div>

          <div className="flex flex-wrap items-end gap-2">
            <label className="ui-label grid gap-1">
              {copy.versionPicker}
              <select
                className="h-10 min-w-48 rounded-[10px] border border-border-default bg-paper-raised px-3 font-mono text-sm outline-none transition-colors focus:border-focus-ring focus:ring-2 focus:ring-ring/15"
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
                      ? copy.draftTarget(target.contentRevision)
                      : copy.versionTarget(target.name, target.isOnline)}
                  </option>
                ))}
              </select>
            </label>
            {controller.versions.length >= 2 ? (
              <Button asChild className="h-9 rounded-xl" variant="outline">
                <Link to={`/workbenches/${workspace.id}/versions/compare`}>
                  <GitCompareArrows data-icon="inline-start" />
                  {copy.compareVersions}
                </Link>
              </Button>
            ) : null}
            {selectedTarget.kind === "draft" ? (
              <CreateVersionDialog
                copy={copy}
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
                  className="h-9 rounded-xl"
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

        <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl border border-technical/25 bg-technical/5 px-3.5 py-3 text-sm">
          {selectedTarget.kind === "draft" ? (
            <PencilLine className="size-4 shrink-0 text-technical" />
          ) : (
            <LockKeyhole className="size-4 shrink-0 text-technical" />
          )}
          <strong>
            {selectedTarget.kind === "draft"
              ? copy.candidateTitle
              : copy.frozenVersionTitle}
          </strong>
          <span className="text-muted-foreground">
            {selectedTarget.kind === "draft"
              ? copy.candidateFilesSummary(selectedTarget.workingCopy.fileCount)
              : copy.versionFilesSummary(
                  selectedTarget.snapshot.fileCount,
                  selectedTarget.labels.length
                    ? new Intl.ListFormat(i18n.resolvedLanguage ?? "en", {
                        style: "short",
                        type: "conjunction",
                      }).format(selectedTarget.labels)
                    : copy.noLabels,
                )}
          </span>
          {selectedTarget.kind === "version" && selectedTarget.isOnline ? (
            <span className="ml-auto rounded-lg border border-technical/30 bg-technical/10 px-2 py-1 font-mono text-xs font-bold text-technical-foreground">
              {copy.currentOnlineBadge}
            </span>
          ) : null}
        </div>
      </header>

      {controller.mutationError ? (
        <StatusBanner
          action={
            <button
              className="font-mono text-xs underline underline-offset-2"
              onClick={controller.actions.clearMutationError}
              type="button"
            >
              {t("draft.close")}
            </button>
          }
          icon={AlertTriangle}
          variant="error"
        >
          {controller.mutationError.message}
        </StatusBanner>
      ) : null}

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(15rem,17rem)_minmax(0,1fr)] overflow-hidden">
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
