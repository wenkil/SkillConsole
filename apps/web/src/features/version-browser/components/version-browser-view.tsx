import {
  Baseline,
  CheckCircle2,
  History,
  LoaderCircle,
  LockKeyhole,
  PackageOpen,
  PencilLine,
  RotateCcw,
} from "lucide-react"

import { VersionFilePreview } from "@/features/version-browser/components/version-file-preview"
import { DraftFileEditor } from "@/features/version-browser/components/draft-file-editor"
import { DraftChangePanel } from "@/features/version-browser/components/draft-change-panel"
import { VersionFileTree } from "@/features/version-browser/components/version-file-tree"
import { VersionMetadataPanel } from "@/features/version-browser/components/version-metadata-panel"
import { useVersionBrowserController } from "@/features/version-browser/hooks/use-version-browser-controller"
import type { SkillBrowserTarget } from "@/features/version-browser/model/version-browser"
import type { SkillWorkspace } from "@/features/workbench-home/model/workbench"
import { Button } from "@/shared/components/ui/button"

interface VersionBrowserViewProps {
  workspace: SkillWorkspace
  locale: string
  selectedVersionId: string | null
  selectedFilePath: string | null
  onDraftAbandoned: () => void
  onTargetSelect: (target: Pick<SkillBrowserTarget, "kind" | "id">) => void
  onFileSelect: (relativePath: string) => void
}

export function VersionBrowserView({
  workspace,
  locale,
  selectedVersionId,
  selectedFilePath,
  onDraftAbandoned,
  onTargetSelect,
  onFileSelect,
}: VersionBrowserViewProps) {
  const controller = useVersionBrowserController({
    workspaceId: workspace.id,
    activeDraftId: workspace.activeDraft?.id ?? null,
    selectedVersionId,
    selectedFilePath,
  })
  const { copy, selectedTarget } = controller

  if (controller.loading) {
    return (
      <main className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-10 py-9">
        <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground uppercase">
          <LoaderCircle aria-hidden="true" className="size-4 animate-spin" />
          {copy.loading}
        </div>
      </main>
    )
  }

  if (controller.error || !selectedTarget) {
    return (
      <main className="flex h-full min-h-0 min-w-0 items-center justify-center overflow-hidden px-10 py-9">
        <div className="max-w-md border border-destructive/50 bg-paper-raised p-7 text-center">
          <PackageOpen
            aria-hidden="true"
            className="mx-auto mb-3 size-8 text-destructive"
          />
          <strong className="block">{copy.loadError}</strong>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {copy.workspaceUnavailable}
          </p>
          <Button
            className="mt-4 rounded-none"
            onClick={controller.actions.retry}
            type="button"
            variant="outline"
          >
            <RotateCcw aria-hidden="true" data-icon="inline-start" />
            {copy.retry}
          </Button>
        </div>
      </main>
    )
  }

  return (
    <main className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
      <header className="shrink-0 border-b border-foreground bg-background px-7 pt-5 pb-4">
        <div className="flex items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="mb-1.5 flex items-center gap-2 font-mono text-[10px] font-bold tracking-[0.08em] text-signal-dark uppercase">
              {selectedTarget.kind === "draft" ? (
                <PencilLine aria-hidden="true" className="size-3.5" />
              ) : selectedTarget.isCurrent ? (
                <CheckCircle2 aria-hidden="true" className="size-3.5" />
              ) : (
                <History aria-hidden="true" className="size-3.5" />
              )}
              {copy.eyebrow} /{" "}
              {selectedTarget.kind === "draft"
                ? copy.initialCandidate
                : `V${selectedTarget.versionNumber}`}
            </div>
            <h1 className="truncate text-[clamp(1.75rem,2.4vw,2.5rem)] leading-none font-[780] tracking-[-0.035em]">
              {workspace.name}
            </h1>
          </div>

          <div className="flex shrink-0 items-end gap-3">
            <label className="grid gap-1 font-mono text-[9px] tracking-[0.04em] text-muted-foreground uppercase">
              {copy.versionPicker}
              <select
                aria-label={copy.versionPicker}
                className="h-9 min-w-44 border border-foreground bg-paper-raised px-3 font-mono text-xs text-foreground outline-none focus:border-primary"
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
                      ? copy.initialCandidate
                      : `V${target.versionNumber}${target.isCurrent ? ` · ${copy.currentVersion}` : ""}`}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex h-9 items-center gap-2 border border-rule bg-paper-raised px-3 font-mono text-[10px]">
              {selectedTarget.kind === "draft" ? (
                <>
                  <PencilLine aria-hidden="true" className="size-3.5 text-primary" />
                  {copy.candidateState}
                </>
              ) : selectedTarget.isCurrent ? (
                <>
                  <CheckCircle2 aria-hidden="true" className="size-3.5 text-signal-dark" />
                  {copy.currentVersion}
                </>
              ) : (
                <>
                  <History aria-hidden="true" className="size-3.5 text-muted-foreground" />
                  {copy.historicalVersion}
                </>
              )}
            </div>
            {selectedTarget.kind === "version" &&
            selectedTarget.isDefaultBaseline ? (
              <div className="flex h-9 items-center gap-2 border border-rule bg-paper-raised px-3 font-mono text-[10px]">
                <Baseline aria-hidden="true" className="size-3.5 text-technical" />
                {copy.defaultBaseline}
              </div>
            ) : null}
            <div className="flex h-9 items-center border border-rule bg-paper-muted px-3 font-mono text-[10px] text-muted-foreground">
              {copy.notTested}
            </div>
            {selectedTarget.kind === "version" &&
            selectedTarget.isCurrent &&
            !controller.targets.some((target) => target.kind === "draft") ? (
              <Button
                className="h-9 rounded-none"
                disabled={controller.mutationPending}
                onClick={() => {
                  void controller.actions
                    .createDraft()
                    .then((draftId) => {
                      if (draftId) {
                        onTargetSelect({ kind: "draft", id: draftId })
                      }
                    })
                    .catch(() => undefined)
                }}
                type="button"
              >
                <PencilLine aria-hidden="true" data-icon="inline-start" />
                {copy.newVersionDraft}
              </Button>
            ) : null}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-3 border border-technical/55 bg-technical/5 px-3.5 py-2 text-xs text-technical-foreground">
          {selectedTarget.kind === "draft" ? (
            <PencilLine aria-hidden="true" className="size-4 shrink-0" />
          ) : (
            <LockKeyhole aria-hidden="true" className="size-4 shrink-0" />
          )}
          <strong>
            {selectedTarget.kind === "draft"
              ? copy.candidateTitle
              : copy.immutableTitle}
          </strong>
          <span className="text-muted-foreground">
            {selectedTarget.kind === "draft"
              ? copy.candidateDescription
              : copy.immutableDescription}
          </span>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(14rem,17rem)_minmax(24rem,1fr)_minmax(14rem,17rem)] overflow-hidden">
        <VersionFileTree
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
            basePreview={controller.baseTextPreview}
            conflict={controller.conflict}
            conflictServerPreview={controller.conflictServerPreview}
            diffEntry={
              controller.draftDiff?.entries.find(
                (entry) =>
                  entry.relativePath ===
                  controller.selectedFile?.relativePath,
              ) ?? null
            }
            errorMessage={controller.mutationError?.message ?? null}
            file={controller.selectedFile}
            key={controller.selectedFile.relativePath}
            onClearError={controller.actions.clearMutationError}
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
        {selectedTarget.kind === "draft" ? (
          <DraftChangePanel
            diff={controller.draftDiff}
            draft={selectedTarget}
            errorMessage={controller.mutationError?.message ?? null}
            file={controller.selectedFile}
            folderPreview={controller.folderPreview}
            onAbandon={async () => {
              await controller.actions.abandonDraft()
              onDraftAbandoned()
            }}
            onClearFolderPreview={controller.actions.clearFolderPreview}
            onCommitFolder={controller.actions.commitFolder}
            onDeleteFile={async (relativePath) => {
              await controller.actions.deleteFile(relativePath)
              const fallback = controller.files.find(
                (candidate) => candidate.relativePath !== relativePath,
              )
              if (fallback) onFileSelect(fallback.relativePath)
            }}
            onMoveFile={async (fromPath, toPath) => {
              await controller.actions.moveFile(fromPath, toPath)
              onFileSelect(toPath)
            }}
            onPreviewFolder={controller.actions.previewFolder}
            onSelectPath={onFileSelect}
            onUploadFile={async (file, relativePath) => {
              await controller.actions.uploadFile(file, relativePath)
              onFileSelect(relativePath)
            }}
            pending={controller.mutationPending}
          />
        ) : (
          <VersionMetadataPanel
            copy={copy}
            file={controller.selectedFile}
            locale={locale}
            target={selectedTarget}
          />
        )}
      </div>
    </main>
  )
}
